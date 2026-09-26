import bcrypt from 'bcryptjs';
import httpStatus from 'http-status';
import config from '../../configs/config';
import logger from '../../configs/logger';
import { userStatusTypes, userTypes } from '../../configs/constantTypes';
import { IUser, OrganizationCountry, Profile, User, UserToken } from '../../models';
import { ApiError, apiErrorWithData } from '../../utils';
import { generateAuthTokens } from '../common/token.service';
import { sendEmailVerification, sendForgotPasswordOTP } from '../common/email.service';
import { createOrganizationForOwner, listMemberships, resolveOrgContext } from '../org/context';
import { orgOnboardingState } from '../org/onboardingState';
import { checkCode, issueCode } from './codes';
import { LIMITS, hit } from './rateLimit';

// Auth for the rebuilt app (Phase 8): signup as Business or Agency (user + organization + owner
// membership), email verification, login, forgot / reset password. Codes are stored hashed with an
// expiry and attempt limit; every endpoint is rate-limited; logs carry user ids only (never emails,
// codes, passwords or tokens). The legacy /user/auth routes stay until Phase 10.

export interface Mailer {
	sendVerification: (to: string, code: string) => Promise<boolean>;
	sendReset: (to: string, code: string) => Promise<boolean>;
}

export interface AuthDeps {
	mailer?: Mailer;
	now?: () => Date;
}

export interface RequestMeta {
	ip: string;
}

export interface SignupInput {
	account_type: 'business' | 'agency';
	name: string;
	email: string;
	password: string;
	organization_name: string;
	country: OrganizationCountry;
}

const PENDING_STATUSES = [userStatusTypes.PENDING, userStatusTypes.REVIEWING];
const BLOCKED_STATUSES = [userStatusTypes.REJECTED, userStatusTypes.BLOCKED, userStatusTypes.SUSPENDED, userStatusTypes.DEACTIVATED, userStatusTypes.INACTIVE];
/** Compared against when the email is unknown, so both answers take about as long. */
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

const defaultMailer: Mailer = { sendVerification: sendEmailVerification, sendReset: sendForgotPasswordOTP };

const normaliseEmail = (email: string): string => email.trim().toLowerCase();

const codeError = (reason: 'invalid_code' | 'code_expired', attemptsLeft: number) =>
	apiErrorWithData(
		httpStatus.BAD_REQUEST,
		reason === 'invalid_code' ? 'The code is not correct.' : 'The code has expired or was used up. Ask for a new one.',
		{ reason, attempts_left: attemptsLeft },
	);

/** What the app needs after verify / login: tokens, the user, their organizations and onboarding. */
export const sessionFor = async (user: IUser) => {
	const tokens = await generateAuthTokens(user);
	delete tokens.refresh.id;
	const profile = await Profile.findOne({ user_id: user._id }).select({ name: 1 }).lean<{ name?: string }>();
	const memberships = await listMemberships(user._id);
	let onboarding = null;
	let current: string | null = null;
	if (memberships.length) {
		const ctx = await resolveOrgContext(user._id);
		current = String(ctx.organization._id);
		onboarding = (await orgOnboardingState(ctx)).organization;
	}
	return {
		tokens,
		user: { id: String(user._id), email: user.email, name: profile?.name ?? null, user_type: user.user_type ?? null },
		organizations: memberships.map((m) => ({ organization_id: String(m.organization._id), name: m.organization.name, type: m.organization.type, role: m.membership.role })),
		current_organization_id: current,
		onboarding,
	};
};

export const createAuthService = (deps: AuthDeps = {}) => {
	const mailer = deps.mailer ?? defaultMailer;
	const now = deps.now ?? (() => new Date());

	const signup = async (input: SignupInput, meta: RequestMeta) => {
		await hit(LIMITS.signupPerIp, [meta.ip], now());
		const email = normaliseEmail(input.email);
		if (await User.exists({ email })) {
			throw apiErrorWithData(httpStatus.CONFLICT, 'An account with this email already exists.', { reason: 'email_taken' });
		}
		const user = await User.create({
			email,
			password: bcrypt.hashSync(input.password, 10),
			role_id: config.roles.user,
			user_type: input.account_type === 'agency' ? userTypes.agency : userTypes.business,
			status: userStatusTypes.PENDING,
		});
		await Profile.create({ user_id: user._id, name: input.name, business_name: input.organization_name, country: input.country });
		const organization = await createOrganizationForOwner(user._id, { name: input.organization_name, type: input.account_type, country: input.country });
		const code = await issueCode(user._id, 'verify_email', now());
		const sent = await mailer.sendVerification(email, code);
		logger.info(`auth: signup user ${String(user._id)} organization ${String(organization._id)} (${input.account_type}) verification_sent=${sent}`);
		return { user_id: String(user._id), organization_id: String(organization._id), email_verification: sent ? 'sent' : 'failed' };
	};

	const verifyEmail = async (input: { email: string; code: string }) => {
		const email = normaliseEmail(input.email);
		await hit(LIMITS.verifyPerEmail, [email], now());
		const user = await User.findOne({ email });
		if (!user) throw codeError('code_expired', 0);
		if (!PENDING_STATUSES.includes(user.status)) {
			throw apiErrorWithData(httpStatus.BAD_REQUEST, 'This email is already verified. Log in instead.', { reason: 'already_verified' });
		}
		const check = await checkCode(user._id, 'verify_email', input.code, now());
		if ('reason' in check) throw codeError(check.reason, check.attempts_left);
		user.status = userStatusTypes.ACCEPTED;
		await user.save();
		logger.info(`auth: user ${String(user._id)} verified their email`);
		return { verified: true, ...(await sessionFor(user)) };
	};

	/** Always answers the same, whether or not the account exists or is pending. */
	const resendVerification = async (input: { email: string }) => {
		const email = normaliseEmail(input.email);
		await hit(LIMITS.resendPerEmail, [email], now());
		const user = await User.findOne({ email });
		if (user && PENDING_STATUSES.includes(user.status)) {
			const code = await issueCode(user._id, 'verify_email', now());
			await mailer.sendVerification(email, code);
			logger.info(`auth: verification code re-sent for user ${String(user._id)}`);
		}
		return { email_verification: 'sent_if_pending' };
	};

	const login = async (input: { email: string; password: string }, meta: RequestMeta) => {
		const email = normaliseEmail(input.email);
		await hit(LIMITS.loginPerEmailIp, [email, meta.ip], now());
		const user = await User.findOne({ email });
		const match = await bcrypt.compare(input.password, user?.password ?? DUMMY_HASH);
		if (!user || !match) throw new ApiError(httpStatus.UNAUTHORIZED, 'Incorrect email or password.');
		if (PENDING_STATUSES.includes(user.status)) {
			throw apiErrorWithData(httpStatus.FORBIDDEN, 'Please verify your email first.', { reason: 'email_not_verified' });
		}
		if (!user.is_active || BLOCKED_STATUSES.includes(user.status)) {
			throw apiErrorWithData(httpStatus.FORBIDDEN, 'This account is disabled.', { reason: 'account_disabled' });
		}
		logger.info(`auth: user ${String(user._id)} logged in`);
		return sessionFor(user);
	};

	/** Always answers the same (no account enumeration). */
	const forgotPassword = async (input: { email: string }, meta: RequestMeta) => {
		const email = normaliseEmail(input.email);
		await hit(LIMITS.forgotPerIp, [meta.ip], now());
		await hit(LIMITS.forgotPerEmail, [email], now());
		const user = await User.findOne({ email });
		if (user && user.is_active && !BLOCKED_STATUSES.includes(user.status)) {
			const code = await issueCode(user._id, 'reset_password', now());
			await mailer.sendReset(email, code);
			logger.info(`auth: password reset code sent for user ${String(user._id)}`);
		}
		return { reset: 'sent_if_account_exists' };
	};

	/** Sets a new password with a reset code, and signs out every session (refresh tokens revoked). */
	const resetPassword = async (input: { email: string; code: string; password: string }) => {
		const email = normaliseEmail(input.email);
		await hit(LIMITS.resetPerEmail, [email], now());
		const user = await User.findOne({ email });
		if (!user) throw codeError('code_expired', 0);
		const check = await checkCode(user._id, 'reset_password', input.code, now());
		if ('reason' in check) throw codeError(check.reason, check.attempts_left);
		user.password = bcrypt.hashSync(input.password, 10);
		// A reset code proves the mailbox, so a still-pending account counts as verified.
		if (PENDING_STATUSES.includes(user.status)) user.status = userStatusTypes.ACCEPTED;
		await user.save();
		const revoked = await UserToken.deleteMany({ user_id: user._id });
		logger.info(`auth: user ${String(user._id)} reset their password (sessions revoked: ${revoked.deletedCount})`);
		return { reset: true };
	};

	return { signup, verifyEmail, resendVerification, login, forgotPassword, resetPassword };
};

export const authService = createAuthService();
