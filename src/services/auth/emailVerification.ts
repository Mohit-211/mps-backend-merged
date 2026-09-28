import crypto from 'crypto';
import httpStatus from 'http-status';
import { Types } from 'mongoose';
import config from '../../configs/config';
import logger from '../../configs/logger';
import { userStatusTypes } from '../../configs/constantTypes';
import { AuthCode, Client, IAuthCode, Invitation, Location, Membership, Organization, Profile, User, UserToken } from '../../models';
import { apiErrorWithData } from '../../utils';

// Email verification by link (Phase 8.1). The link carries a random 32-byte token; only its SHA-256 is
// stored (AuthCode, purpose verify_email, one row per user), so issuing a new link replaces the old
// one. A signup gets a deadline (EMAIL_VERIFICATION_TTL_HOURS); an account still unverified after it is
// deleted by the unverified-cleanup job. Only signups carry a deadline, so invited accounts (verified
// through the invitation) can never be deleted here.

type UserId = Types.ObjectId | string;

const HOUR_MS = 3_600_000;
/** A used link row is kept this long so a second click answers "already verified". */
const USED_LINK_KEEP_MS = 7 * 24 * HOUR_MS;
const PENDING_STATUSES = [userStatusTypes.PENDING, userStatusTypes.REVIEWING];

export const ttlMs = (): number => config.auth.emailVerificationTtlHours * HOUR_MS;

/** Login (new and legacy) for an unverified account: 403 email_not_verified, with where to ask for a new link. */
export const emailNotVerifiedError = () =>
	apiErrorWithData(httpStatus.FORBIDDEN, 'Please verify your email first. We can send you a new link.', {
		reason: 'email_not_verified',
		resend: '/api/v1/auth/resend-verification',
	});

export const hashLinkToken = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');

export const verificationLink = (token: string): string =>
	`${(config.auth.frontendUrl || 'http://localhost:3000').replace(/\/$/, '')}/verify-email?token=${token}`;

/** Issues a new link token (replacing any older one). It expires at the account's deadline, else after the TTL. */
export const issueLinkToken = async (userId: UserId, deadline: Date | null | undefined, now: Date = new Date()): Promise<string> => {
	const token = crypto.randomBytes(32).toString('base64url');
	const expires = deadline ?? new Date(now.getTime() + ttlMs());
	await AuthCode.findOneAndUpdate(
		{ user_id: userId, purpose: 'verify_email' },
		{ $set: { code_hash: hashLinkToken(token), expires_at: expires, attempts: 0, max_attempts: 1, consumed_at: null } },
		{ upsert: true, setDefaultsOnInsert: true },
	);
	return token;
};

export type LinkCheck =
	| { ok: true; userId: Types.ObjectId; alreadyVerified: boolean }
	| { ok: false; reason: 'link_invalid' | 'link_expired' };

/** Marks a user verified: email_verified_at, no deadline, and PENDING → ACCEPTED (the token middleware needs it). */
export const markVerified = async (userId: UserId, now: Date = new Date()): Promise<void> => {
	await User.updateOne({ _id: userId, email_verified_at: null }, { $set: { email_verified_at: now, verification_deadline: null } });
	await User.updateOne({ _id: userId, status: { $in: PENDING_STATUSES } }, { $set: { status: userStatusTypes.ACCEPTED } });
};

/** Checks a link token and, the first time, consumes it and marks the email verified. */
export const consumeLinkToken = async (token: string, now: Date = new Date()): Promise<LinkCheck> => {
	const row = await AuthCode.findOne({ purpose: 'verify_email', code_hash: hashLinkToken(token) }).lean<IAuthCode>();
	if (!row) return { ok: false, reason: 'link_invalid' };
	if (row.consumed_at) return { ok: true, userId: row.user_id, alreadyVerified: true };
	if (row.expires_at.getTime() <= now.getTime()) return { ok: false, reason: 'link_expired' };
	// Consume atomically: of two parallel clicks, one verifies and the other sees "already verified".
	const claimed = await AuthCode.findOneAndUpdate(
		{ _id: row._id, consumed_at: null },
		{ $set: { consumed_at: now, expires_at: new Date(now.getTime() + USED_LINK_KEEP_MS) } },
		{ new: true },
	).lean();
	if (!claimed) return { ok: true, userId: row.user_id, alreadyVerified: true };
	await markVerified(row.user_id, now);
	return { ok: true, userId: row.user_id, alreadyVerified: false };
};

export interface CleanupResult {
	users: number;
	organizations: number;
	organizations_kept: number;
}

/**
 * Deletes one unverified signup and what signup created: profile, codes, tokens, memberships, the
 * invitations they sent, and each organization they own that has no other members and no locations
 * (with its invitations and clients). An organization with other members or locations is kept.
 * Returns false (and deletes nothing) unless the user is still unverified and past its deadline.
 */
export const deleteUnverifiedAccount = async (userId: UserId, now: Date = new Date()): Promise<{ deleted: boolean; organizations: number; organizations_kept: number }> => {
	const user = await User.findOne({ _id: userId, email_verified_at: null, verification_deadline: { $lte: now } }).select({ _id: 1, email: 1 }).lean();
	if (!user) return { deleted: false, organizations: 0, organizations_kept: 0 };
	let organizations = 0;
	let kept = 0;
	const owned = await Organization.find({ owner_user_id: user._id }).select({ _id: 1 }).lean();
	for (const org of owned) {
		const others = await Membership.exists({ organization_id: org._id, user_id: { $ne: user._id }, status: 'active' });
		const locations = await Location.collection.countDocuments({ organization_id: org._id }, { limit: 1 });
		if (others || locations > 0) {
			kept += 1;
			continue;
		}
		await Invitation.deleteMany({ organization_id: org._id });
		await Client.collection.deleteMany({ organization_id: org._id });
		await Membership.deleteMany({ organization_id: org._id });
		await Organization.deleteOne({ _id: org._id });
		organizations += 1;
	}
	await Invitation.deleteMany({ invited_by: user._id, status: 'pending' });
	await Membership.deleteMany({ user_id: user._id });
	await AuthCode.deleteMany({ user_id: user._id });
	await UserToken.deleteMany({ user_id: user._id });
	await Profile.deleteMany({ user_id: user._id });
	// A hard delete, so the email can sign up again. The filter repeats the conditions (a verify racing the job wins).
	const res = await User.collection.deleteOne({ _id: user._id, email_verified_at: null, verification_deadline: { $lte: now } });
	return { deleted: res.deletedCount === 1, organizations, organizations_kept: kept };
};

/** The unverified-cleanup job body: every signup past its deadline, in batches. Logs counts only. */
export const cleanupUnverifiedAccounts = async (now: Date = new Date(), batchSize = 200): Promise<CleanupResult> => {
	const result: CleanupResult = { users: 0, organizations: 0, organizations_kept: 0 };
	for (;;) {
		const due = await User.find({ email_verified_at: null, verification_deadline: { $lte: now } })
			.select({ _id: 1 })
			.sort({ verification_deadline: 1 })
			.limit(batchSize)
			.lean();
		if (!due.length) break;
		let progressed = false;
		for (const u of due) {
			const r = await deleteUnverifiedAccount(u._id, now);
			if (r.deleted) {
				result.users += 1;
				progressed = true;
			}
			result.organizations += r.organizations;
			result.organizations_kept += r.organizations_kept;
		}
		if (!progressed || due.length < batchSize) break;
	}
	if (result.users || result.organizations_kept) {
		logger.info(`auth: unverified-cleanup deleted ${result.users} account(s), ${result.organizations} organization(s); kept ${result.organizations_kept} organization(s) with other members or locations`);
	}
	return result;
};
