import crypto from 'crypto';
import httpStatus from 'http-status';
import { IRateLimit, RateLimit } from '../../models';
import { apiErrorWithData } from '../../utils';

// Fixed-window rate limits for the Phase 8 auth endpoints, counted in MongoDB (shared by every pm2
// process). Keys are hashed, so no email or IP is stored in clear. IP-based limits only see the real
// client IP once `trust proxy` is set (Phase 10, AUDIT S5); the email-keyed limits work now.

export interface Limit {
	name: string;
	max: number;
	windowSeconds: number;
}

export const LIMITS = {
	signupPerIp: { name: 'signup:ip', max: 5, windowSeconds: 3600 },
	loginPerEmailIp: { name: 'login:email+ip', max: 10, windowSeconds: 900 },
	verifyPerEmail: { name: 'verify:email', max: 10, windowSeconds: 900 },
	resendPerEmail: { name: 'resend:email', max: 3, windowSeconds: 3600 },
	// Phase 8.1: verification links and resends per IP.
	resendPerIp: { name: 'resend:ip', max: 10, windowSeconds: 3600 },
	verifyLinkPerIp: { name: 'verify-link:ip', max: 30, windowSeconds: 900 },
	forgotPerEmail: { name: 'forgot:email', max: 3, windowSeconds: 3600 },
	forgotPerIp: { name: 'forgot:ip', max: 20, windowSeconds: 3600 },
	resetPerEmail: { name: 'reset:email', max: 10, windowSeconds: 900 },
	invitePerOrg: { name: 'invite:organization', max: 20, windowSeconds: 3600 },
	invitationPerIp: { name: 'invitation:ip', max: 20, windowSeconds: 900 },
	// Phase 12: report emails per organization, public share-link views per IP.
	reportEmailPerOrg: { name: 'report-email:organization', max: 20, windowSeconds: 3600 },
	sharePerIp: { name: 'share:ip', max: 60, windowSeconds: 60 },
	// Phase 10: admin sign-in and OTP flows.
	adminLoginPerEmailIp: { name: 'admin-login:email+ip', max: 10, windowSeconds: 900 },
	adminOtpPerEmail: { name: 'admin-otp:email', max: 5, windowSeconds: 3600 },
	adminOtpPerIp: { name: 'admin-otp:ip', max: 20, windowSeconds: 3600 },
} satisfies Record<string, Limit>;

const keyOf = (limit: Limit, parts: string[]): string =>
	crypto.createHash('sha256').update([limit.name, ...parts.map((p) => p.toLowerCase())].join('|')).digest('hex');

/** Counts one request; throws 429 { reason: 'rate_limited', retry_after_seconds } above the limit. */
export const hit = async (limit: Limit, parts: string[], now: Date = new Date()): Promise<void> => {
	const end = new Date(now.getTime() + limit.windowSeconds * 1000);
	const open = { $gt: ['$window_ends_at', now] };
	const row = await RateLimit.findOneAndUpdate(
		{ key: keyOf(limit, parts) },
		[
			{
				$set: {
					count: { $cond: [open, { $add: ['$count', 1] }, 1] },
					window_ends_at: { $cond: [open, '$window_ends_at', end] },
				},
			},
		],
		{ upsert: true, new: true },
	).lean<IRateLimit>();
	if (row && row.count > limit.max) {
		const retryAfter = Math.max(1, Math.ceil((row.window_ends_at.getTime() - now.getTime()) / 1000));
		throw apiErrorWithData(httpStatus.TOO_MANY_REQUESTS, 'Too many attempts. Try again later.', { reason: 'rate_limited', retry_after_seconds: retryAfter });
	}
};
