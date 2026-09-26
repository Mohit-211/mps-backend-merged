import crypto from 'crypto';
import { Types } from 'mongoose';
import config from '../../configs/config';
import { AuthCode, AuthCodePurpose, IAuthCode } from '../../models';

// One-time 6-digit codes (Phase 8): email verification and password reset. Only an HMAC-SHA256 of the
// code (keyed from JWT_SECRET, so a database copy can't be brute-forced offline) is stored. A code
// expires after AUTH_CODE_TTL_MINUTES, allows MAX_ATTEMPTS wrong tries and works once. Issuing a new
// code replaces the previous one.

export const MAX_ATTEMPTS = 5;
const key = crypto.createHash('sha256').update(`mps-auth-codes:${config.constants.jwt.secret}`).digest();

export const hashCode = (code: string): string => crypto.createHmac('sha256', key).update(code).digest('hex');

export const newCode = (): string => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

type UserId = Types.ObjectId | string;

export const issueCode = async (userId: UserId, purpose: AuthCodePurpose, now: Date = new Date()): Promise<string> => {
	const code = newCode();
	await AuthCode.findOneAndUpdate(
		{ user_id: userId, purpose },
		{
			$set: {
				code_hash: hashCode(code),
				expires_at: new Date(now.getTime() + config.auth.codeTtlMinutes * 60_000),
				attempts: 0,
				max_attempts: MAX_ATTEMPTS,
				consumed_at: null,
			},
		},
		{ upsert: true, setDefaultsOnInsert: true },
	);
	return code;
};

export type CodeCheck = { ok: true } | { ok: false; reason: 'invalid_code' | 'code_expired'; attempts_left: number };

const sameHash = (a: string, b: string): boolean => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Checks and consumes a code. Wrong codes count against the attempts; used-up or expired codes fail. */
export const checkCode = async (userId: UserId, purpose: AuthCodePurpose, code: string, now: Date = new Date()): Promise<CodeCheck> => {
	const row = await AuthCode.findOne({ user_id: userId, purpose }).lean<IAuthCode>();
	if (!row || row.consumed_at || row.expires_at.getTime() <= now.getTime() || row.attempts >= row.max_attempts) {
		return { ok: false, reason: 'code_expired', attempts_left: 0 };
	}
	if (!/^\d{6}$/.test(code) || !sameHash(hashCode(code), row.code_hash)) {
		const updated = await AuthCode.findOneAndUpdate({ _id: row._id, consumed_at: null }, { $inc: { attempts: 1 } }, { new: true }).lean<IAuthCode>();
		const left = Math.max(0, (updated?.max_attempts ?? MAX_ATTEMPTS) - (updated?.attempts ?? MAX_ATTEMPTS));
		return left > 0 ? { ok: false, reason: 'invalid_code', attempts_left: left } : { ok: false, reason: 'code_expired', attempts_left: 0 };
	}
	// Consume atomically: a code works once even with parallel requests.
	const consumed = await AuthCode.findOneAndUpdate(
		{ _id: row._id, consumed_at: null, attempts: { $lt: row.max_attempts } },
		{ $set: { consumed_at: now } },
		{ new: true },
	).lean();
	return consumed ? { ok: true } : { ok: false, reason: 'code_expired', attempts_left: 0 };
};
