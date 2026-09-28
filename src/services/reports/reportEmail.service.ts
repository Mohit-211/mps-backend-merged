import httpStatus from 'http-status';
import config from '../../configs/config';
import logger from '../../configs/logger';
import { IReport, IReportSnapshot, Organization, ReportSnapshot } from '../../models';
import { ApiError } from '../../utils';
import { LIMITS, hit } from '../auth/rateLimit';
import { sendReportEmail } from '../common/email.service';
import { effectiveBranding } from './branding.service';
import { renderEmailHtml, renderEmailText } from './render/html';
import { createReportService } from './report.service';
import { createShareService } from './share.service';

// Report emails (Phase 12): the PDF as an attachment, or, above REPORT_EMAIL_MAX_ATTACHMENT_MB, a
// 30-day share link. The sender name and Reply-To come from the organization's branding. Nothing is
// sent in development: the delivery is logged with the recipients masked.

export const EMAIL_LINK_DAYS = 30;

export type ReportMailer = typeof sendReportEmail;

export interface ReportEmailDeps {
	mailer?: ReportMailer;
	maxAttachmentBytes?: number;
	reports?: ReturnType<typeof createReportService>;
	shares?: ReturnType<typeof createShareService>;
}

export const createReportEmailService = (deps: ReportEmailDeps = {}) => {
	const mailer = deps.mailer ?? sendReportEmail;
	const maxBytes = () => deps.maxAttachmentBytes ?? config.reports.maxAttachmentBytes;
	const reports = deps.reports ?? createReportService();
	const shares = deps.shares ?? createShareService();

	/**
	 * Sends a ready report. `rateLimited` is true for user-triggered emails (20 / hour per organization).
	 * Throws on failure (ApiError for the request path; the scheduled-email job records it).
	 */
	const send = async (report: IReport, recipientsIn: string[], opts: { message?: string | null; sentBy: string | null; rateLimited: boolean }) => {
		if (report.archived_at) throw new ApiError(httpStatus.CONFLICT, 'Archived reports cannot be emailed.');
		const recipients = [...new Set(recipientsIn.map((r) => r.trim().toLowerCase()))];
		if (opts.rateLimited) await hit(LIMITS.reportEmailPerOrg, [String(report.organization_id)]);
		const { data, filename } = await reports.readPdf(report);
		const snapshot = (await ReportSnapshot.findOne({ report_id: report._id }).lean<IReportSnapshot>()) as IReportSnapshot;
		const doc = reports.documentOf(report, snapshot);
		const org = await Organization.findById(report.organization_id).select({ name: 1, type: 1, branding: 1 }).lean();
		const brand = org ? effectiveBranding(org) : null;

		const asLink = data.length > maxBytes();
		const link = asLink ? (await shares.createFor(report, { expiresInDays: EMAIL_LINK_DAYS, purpose: 'email_link', createdBy: opts.sentBy })).url : null;
		const note = { message: opts.message ?? null, link };
		const senderName = brand?.email_sender_name || (brand?.white_label ? `${doc.branding.name} via MyPageSEO` : 'MyPageSEO');
		const delivery = asLink ? ('link' as const) : ('attachment' as const);

		// 13b: sent or logged by the email service (EMAIL_TRANSPORT); an SMTP failure throws.
		await mailer({
			to: recipients,
			subject: `${doc.title}: ${doc.location.name}`,
			text: renderEmailText(doc, note),
			html: renderEmailHtml(doc, note),
			senderName,
			replyTo: brand?.email_reply_to ?? null,
			attachment: asLink ? null : { filename, content: data },
			link,
		});
		logger.info(`report email for report ${String(report._id)}: ${recipients.length} recipient(s), ${delivery}`);
		return { sent: true, recipients: recipients.length, delivery };
	};

	return { send };
};

export const reportEmailService = createReportEmailService();
