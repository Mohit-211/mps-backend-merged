import crypto from 'crypto';
import httpStatus from 'http-status';
import { Types } from 'mongoose';
import config from '../../configs/config';
import logger from '../../configs/logger';
import { IReport, IReportShare, IReportSnapshot, Report, ReportShare, ReportSnapshot } from '../../models';
import { ApiError } from '../../utils';
import { LIMITS, hit } from '../auth/rateLimit';
import { OrgContext } from '../org/context';

// Report share links (Phase 12): /r/<token> shows a branded HTML view and the PDF without login.
// The token is 32 random bytes; only its SHA-256 is stored, and it is returned once, on creation.
// Optional expiry, revocable. Archived, expired or deleted reports stop working. Public views are
// rate-limited per IP and answer the same 404 for every failure, so nothing is revealed.

const DAY_MS = 86_400_000;

export const hashShareToken = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');
export const shareUrl = (token: string): string => `${config.reports.shareBaseUrl}/r/${token}`;

export class ShareNotFound extends Error {
	constructor() {
		super('share link not found');
	}
}

const view = (s: IReportShare, at: Date) => ({
	share_id: String(s._id),
	purpose: s.purpose,
	created_at: s.created_at,
	expires_at: s.expires_at,
	revoked_at: s.revoked_at,
	active: !s.revoked_at && (!s.expires_at || s.expires_at.getTime() > at.getTime()),
	views: s.views,
	last_viewed_at: s.last_viewed_at,
});

export const createShareService = (deps: { now?: () => Date } = {}) => {
	const now = deps.now ?? (() => new Date());

	/** Creates a link for a ready report (no access check: callers load the report through its scope). */
	const createFor = async (report: Pick<IReport, '_id' | 'organization_id' | 'status' | 'archived_at'>, opts: { expiresInDays: number | null; purpose: 'share' | 'email_link'; createdBy: string | null }) => {
		if (report.status !== 'ready' || report.archived_at) throw new ApiError(httpStatus.CONFLICT, 'Only ready, unarchived reports can be shared.');
		const token = crypto.randomBytes(32).toString('base64url');
		const at = now();
		const share = await ReportShare.create({
			report_id: report._id,
			organization_id: report.organization_id,
			token_hash: hashShareToken(token),
			expires_at: opts.expiresInDays ? new Date(at.getTime() + opts.expiresInDays * DAY_MS) : null,
			purpose: opts.purpose,
			created_by: opts.createdBy ? new Types.ObjectId(opts.createdBy) : null,
		});
		logger.info(`reports: share link ${String(share._id)} (${opts.purpose}) created for report ${String(report._id)}`);
		return { share_id: String(share._id), url: shareUrl(token), expires_at: share.expires_at };
	};

	const create = async (ctx: OrgContext, report: IReport, expiresInDays: number | null) =>
		createFor(report, { expiresInDays, purpose: 'share', createdBy: ctx.userId });

	const list = async (report: IReport) => {
		const at = now();
		const rows = await ReportShare.find({ report_id: report._id }).sort({ created_at: -1, _id: -1 }).limit(100).lean<IReportShare[]>();
		return rows.map((s) => view(s, at));
	};

	const revoke = async (report: IReport, shareId: string) => {
		if (!Types.ObjectId.isValid(shareId)) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid shareId');
		const share = await ReportShare.findOne({ _id: shareId, report_id: report._id });
		if (!share) throw new ApiError(httpStatus.NOT_FOUND, 'Share link not found');
		if (!share.revoked_at) await ReportShare.updateOne({ _id: share._id }, { $set: { revoked_at: now() } });
		return { revoked: true, share_id: shareId };
	};

	/** Public: the report behind a token, or ShareNotFound. Counts a view unless `countView` is false. */
	const resolve = async (token: string, ip: string, countView = true): Promise<{ report: IReport; snapshot: IReportSnapshot }> => {
		await hit(LIMITS.sharePerIp, [ip], now());
		if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw new ShareNotFound();
		const at = now();
		const share = await ReportShare.findOne({ token_hash: hashShareToken(token), revoked_at: null }).lean<IReportShare>();
		if (!share || (share.expires_at && share.expires_at.getTime() <= at.getTime())) throw new ShareNotFound();
		const report = await Report.findOne({ _id: share.report_id, status: 'ready', archived_at: null });
		if (!report) throw new ShareNotFound();
		const snapshot = await ReportSnapshot.findOne({ report_id: report._id }).lean<IReportSnapshot>();
		if (!snapshot) throw new ShareNotFound();
		if (countView) await ReportShare.updateOne({ _id: share._id }, { $inc: { views: 1 }, $set: { last_viewed_at: at } });
		return { report, snapshot };
	};

	return { create, createFor, list, revoke, resolve };
};

export const shareService = createShareService();
