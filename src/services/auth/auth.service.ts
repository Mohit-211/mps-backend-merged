import bcrypt from 'bcryptjs';
import httpStatus from 'http-status';
import config from '../../configs/config';
import logger from '../../configs/logger';
import { userStatusTypes, userTypes } from '../../configs/constantTypes';
import { IUser, OrganizationCountry, Profile, User, UserLoginTiming, UserToken } from '../../models';
import { ApiError, apiErrorWithData } from '../../utils';
import { generateAuthTokens } from '../common/token.service';
import { sendForgotPasswordOTP, sendVerificationLinkEmail } from '../common/email.service';
import { createOrganizationForOwner, listMemberships, resolveOrgContext } from '../org/context';
import { orgOnboardingState } from '../org/onboardingState';
import { checkCode, issueCode } from './codes';
import { consumeLinkToken, deleteUnverifiedAccount, emailNotVerifiedError, issueLinkToken, markVerified, ttlMs, verificationLink } from './emailVerification';
import { LIMITS, hit } from './rateLimit';

// Auth for the rebuilt app (Phase 8): signup as Business or Agency (user + organization + owner
// membership), email verification by link (Phase 8.1), login, forgot / reset password. Link tokens and
// codes are stored hashed with an expiry; every endpoint is rate-limited; logs carry user ids only
// (never emails, codes, passwords or tokens). Unverified accounts get no tokens.

export interface Mailer {
	sendVerification: (to: string, link: string) => Promise<boolean>;
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

const BLOCKED_STATUSES = [userStatusTypes.REJECTED, userStatusTypes.BLOCKED, userStatusTypes.SUSPENDED, userStatusTypes.DEACTIVATED, userStatusTypes.INACTIVE];
/** Compared against when the email is unknown, so both answers take about as long. */
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

const defaultMailer: Mailer = { sendVerification: sendVerificationLinkEmail, sendReset: sendForgotPasswordOTP };

const normaliseEmail = (email: string): string => email.trim().toLowerCase();

const codeError = (reason: 'invalid_code' | 'code_expired', attemptsLeft: number) =>
	apiErrorWithData(
		httpStatus.BAD_REQUEST,
		reason === 'invalid_code' ? 'The code is not correct.' : 'The code has expired or was used up. Ask for a new one.',
		{ reason, attempts_left: attemptsLeft },
	);

/**
 * What the app needs after verify / login: tokens, the user, their organizations and onboarding.
 * Phase 13b: with `login`, the sign-in is recorded (UserLoginTiming, keyed by the refresh token) for the
 * admin panel's "last logins".
 */
export const sessionFor = async (user: IUser, login?: { ip: string; at?: Date }) => {
	const tokens = await generateAuthTokens(user);
	if (login) {
		await UserLoginTiming.create({ user_id: user._id, token_id: tokens.refresh.id, ip_address: login.ip, login_time_utc: login.at ?? new Date(), time_zone: 'UTC' });
	}
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

	const sendLink = async (email: string, token: string): Promise<boolean> => {
		// 13b: sent or logged by the email service (EMAIL_TRANSPORT), like every other email.
		return mailer.sendVerification(email, verificationLink(token));
	};


	const signup = async (input: SignupInput, meta: RequestMeta) => {
		const at = now();
		await hit(LIMITS.signupPerIp, [meta.ip], at);
		const email = normaliseEmail(input.email);
		const existing = await User.findOne({ email }).select({ _id: 1 }).lean();
		// An unverified signup past its deadline frees the address at once (the hourly job would delete it anyway).
		if (existing && !(await deleteUnverifiedAccount(existing._id, at)).deleted) {
			throw apiErrorWithData(httpStatus.CONFLICT, 'An account with this email already exists.', { reason: 'email_taken' });
		}
		const deadline = new Date(at.getTime() + ttlMs());
		const user = await User.create({
			email,
			password: bcrypt.hashSync(input.password, 10),
			role_id: config.roles.user,
			user_type: input.account_type === 'agency' ? userTypes.agency : userTypes.business,
			status: userStatusTypes.PENDING,
			email_verified_at: null,
			verification_deadline: deadline,
		});
		await Profile.create({ user_id: user._id, name: input.name, business_name: input.organization_name, country: input.country });
		const organization = await createOrganizationForOwner(user._id, { name: input.organization_name, type: input.account_type, country: input.country });
		const sent = await sendLink(email, await issueLinkToken(user._id, deadline, at));
		logger.info(`auth: signup user ${String(user._id)} organization ${String(organization._id)} (${input.account_type}) verification_sent=${sent}`);
		return {
			user_id: String(user._id),
			organization_id: String(organization._id),
			email_verification: sent ? 'sent' : 'failed',
			verify_before: deadline.toISOString(),
		};
	};

	/**
	 * Verifies an email from the link. The first time it returns the session; an already-verified account
	 * gets { verified: true, already_verified: true } and no tokens (the page sends the user to login).
	 */
	const verifyEmail = async (input: { token: string }, meta: RequestMeta) => {
		const at = now();
		await hit(LIMITS.verifyLinkPerIp, [meta.ip], at);
		const check = await consumeLinkToken(input.token, at);
		if ('reason' in check) {
			throw apiErrorWithData(
				httpStatus.BAD_REQUEST,
				check.reason === 'link_expired' ? 'This verification link has expired. Ask for a new one.' : 'This verification link is not valid. Ask for a new one.',
				{ reason: check.reason },
			);
		}
		const user = await User.findById(check.userId);
		if (!user) throw apiErrorWithData(httpStatus.BAD_REQUEST, 'This verification link is not valid. Ask for a new one.', { reason: 'link_invalid' });
		if (check.alreadyVerified) return { verified: true, already_verified: true };
		logger.info(`auth: user ${String(user._id)} verified their email`);
		if (!user.is_active || BLOCKED_STATUSES.includes(user.status)) return { verified: true, already_verified: false };
		return { verified: true, already_verified: false, ...(await sessionFor(user)) };
	};

	/** Always answers the same, whether or not the account exists or is pending. */
	const resendVerification = async (input: { email: string }, meta: RequestMeta) => {
		const email = normaliseEmail(input.email);
		const at = now();
		await hit(LIMITS.resendPerIp, [meta.ip], at);
		await hit(LIMITS.resendPerEmail, [email], at);
		const user = await User.findOne({ email });
		const pastDeadline = user?.verification_deadline && user.verification_deadline.getTime() <= at.getTime();
		if (user && !user.email_verified_at && !pastDeadline && user.is_active && !BLOCKED_STATUSES.includes(user.status)) {
			// A new link replaces the old one, so earlier links stop working.
			await sendLink(email, await issueLinkToken(user._id, user.verification_deadline, at));
			logger.info(`auth: verification link re-sent for user ${String(user._id)}`);
		}
		return { email_verification: 'sent_if_pending' };
	};

	const login = async (input: { email: string; password: string }, meta: RequestMeta) => {
		const email = normaliseEmail(input.email);
		await hit(LIMITS.loginPerEmailIp, [email, meta.ip], now());
		const user = await User.findOne({ email });
		const match = await bcrypt.compare(input.password, user?.password ?? DUMMY_HASH);
		if (!user || !match) throw new ApiError(httpStatus.UNAUTHORIZED, 'Incorrect email or password.');
		if (!user.email_verified_at) throw emailNotVerifiedError();
		if (!user.is_active || BLOCKED_STATUSES.includes(user.status)) {
			throw apiErrorWithData(httpStatus.FORBIDDEN, 'This account is disabled.', { reason: 'account_disabled' });
		}
		logger.info(`auth: user ${String(user._id)} logged in`);
		return sessionFor(user, { ip: meta.ip, at: now() });
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
		await user.save();
		// A reset code proves the mailbox, so a still-unverified account counts as verified.
		await markVerified(user._id, now());
		// Phase 10: access tokens stop working at once too (token_version).
		await User.updateOne({ _id: user._id }, { $inc: { token_version: 1 } });
		const revoked = await UserToken.deleteMany({ user_id: user._id });
		logger.info(`auth: user ${String(user._id)} reset their password (sessions revoked: ${revoked.deletedCount})`);
		return { reset: true };
	};

	return { signup, verifyEmail, resendVerification, login, forgotPassword, resetPassword };
};

export const authService = createAuthService();
