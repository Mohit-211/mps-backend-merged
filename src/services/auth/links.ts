import crypto from 'crypto';
import httpStatus from 'http-status';
import { Types } from 'mongoose';
import config from '../../configs/config';
import { AuthLink, AuthLinkPurpose, AuthLinkSubject, IAuthLink } from '../../models';
import { apiErrorWithData } from '../../utils';

// One-time links (13b): email verification, password reset (users and admins) and an admin's first
// password. See models/authLink.model.ts. Tokens are 32 random bytes (base64url); only a SHA-256 is stored.

const DAY_MS = 86_400_000;
/** Rows stay this long after they expire or are used, so old links answer link_expired / already used. */
const KEEP_MS = 7 * DAY_MS;

type Id = Types.ObjectId | string;

export const hashLinkToken = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');

/** `${base}/${page}?token=…` (base: FRONTEND_URL or ADMIN_FRONTEND_URL, with a local default). */
export const linkUrl = (base: string, page: string, token: string): string =>
	`${(base || 'http://localhost:3000').replace(/\/$/, '')}/${page}?token=${token}`;

export const userLinkUrl = (page: string, token: string): string => linkUrl(config.auth.frontendUrl, page, token);
export const adminLinkUrl = (page: string, token: string): string => linkUrl(config.auth.adminFrontendUrl, page, token);

/** Issues a new link, replacing (invalidating) any older one of the same subject and purpose. Returns the token. */
export const issueLink = async (subject: AuthLinkSubject, subjectId: Id, purpose: AuthLinkPurpose, expiresAt: Date): Promise<string> => {
	const token = crypto.randomBytes(32).toString('base64url');
	await AuthLink.findOneAndUpdate(
		{ subject_kind: subject, subject_id: subjectId, purpose },
		{ $set: { token_hash: hashLinkToken(token), expires_at: expiresAt, consumed_at: null, purge_at: new Date(expiresAt.getTime() + KEEP_MS) } },
		{ upsert: true, setDefaultsOnInsert: true },
	);
	return token;
};

export type LinkLookup =
	| { ok: true; link: IAuthLink }
	| { ok: false; reason: 'link_invalid' | 'link_expired' | 'link_used'; link: IAuthLink | null };

/** Finds a link by token without using it. Unknown or replaced → link_invalid; used → link_used; past expiry → link_expired. */
export const findLink = async (purposes: AuthLinkPurpose[], token: string, now: Date = new Date()): Promise<LinkLookup> => {
	if (!/^[A-Za-z0-9_-]{20,128}$/.test(token)) return { ok: false, reason: 'link_invalid', link: null };
	const link = await AuthLink.findOne({ purpose: { $in: purposes }, token_hash: hashLinkToken(token) }).lean<IAuthLink>();
	if (!link) return { ok: false, reason: 'link_invalid', link: null };
	if (link.consumed_at) return { ok: false, reason: 'link_used', link };
	if (link.expires_at.getTime() <= now.getTime()) return { ok: false, reason: 'link_expired', link };
	return { ok: true, link };
};

/** Uses a link atomically: true for exactly one caller, even with parallel requests. */
export const claimLink = async (link: Pick<IAuthLink, '_id'>, now: Date = new Date()): Promise<boolean> =>
	Boolean(
		await AuthLink.findOneAndUpdate(
			{ _id: link._id, consumed_at: null, expires_at: { $gt: now } },
			{ $set: { consumed_at: now, purge_at: new Date(now.getTime() + KEEP_MS) } },
			{ new: true },
		).lean(),
	);

/** Removes every link of a subject (account deleted). */
export const deleteLinksOf = async (subject: AuthLinkSubject, subjectId: Id): Promise<void> => {
	await AuthLink.deleteMany({ subject_kind: subject, subject_id: subjectId });
};

/** 400 for a password link that can't be used: link_expired (ask for a new one), else link_invalid (unknown, replaced or used). */
export const linkError = (reason: 'link_invalid' | 'link_expired' | 'link_used') =>
	apiErrorWithData(
		httpStatus.BAD_REQUEST,
		reason === 'link_expired' ? 'This link has expired. Ask for a new one.' : 'This link is not valid any more. Ask for a new one.',
		{ reason: reason === 'link_expired' ? 'link_expired' : 'link_invalid' },
	);

export const passwordsDoNotMatch = () =>
	apiErrorWithData(httpStatus.BAD_REQUEST, 'The two passwords do not match.', { reason: 'passwords_do_not_match' });

export const passwordResetExpiry = (now: Date): Date => new Date(now.getTime() + config.auth.passwordResetTtlMinutes * 60_000);
