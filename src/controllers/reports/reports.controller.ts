import httpStatus from 'http-status';
import { GOOGLE_ATTRIBUTION } from '../../constants/attribution';
import { OrgContext } from '../../services/org/context';
import { brandingService } from '../../services/reports/branding.service';
import { reportEmailService } from '../../services/reports/reportEmail.service';
import { reportService } from '../../services/reports/report.service';
import { scheduleService } from '../../services/reports/schedule.service';
import { shareService } from '../../services/reports/share.service';
import { catchAsync, responseWrapper } from '../../utils';

// Reports center (Phase 12). loadOrgContext ran; writes also ran requireWrite (owner/member).

interface Locals { locals: Record<string, unknown> }
const orgOf = (res: Locals): OrgContext => res.locals.org as OrgContext;

const sendFile = (res: import('express').Response, data: Buffer, type: string, filename: string | null) => {
	res.setHeader('Content-Type', type);
	res.setHeader('Content-Length', String(data.length));
	res.setHeader('Cache-Control', 'private, no-store');
	res.setHeader('X-Content-Type-Options', 'nosniff');
	if (filename) res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
	res.status(httpStatus.OK).end(data);
};

// ---- reports ----

export const create = catchAsync(async (req, res) => {
	const result = await reportService.create(orgOf(res), res.locals.reportInput);
	return responseWrapper(res, result, result.existing ? 'A report of this type is already being generated.' : 'Report queued.', httpStatus.ACCEPTED);
});
export const list = catchAsync(async (req, res) => responseWrapper(res, await reportService.list(orgOf(res), res.locals.reportQuery)));
export const get = catchAsync(async (req, res) => responseWrapper(res, { ...(await reportService.get(orgOf(res), req.params.reportId)), attribution: GOOGLE_ATTRIBUTION }));
export const pdf = catchAsync(async (req, res) => {
	const { data, filename } = await reportService.pdf(orgOf(res), req.params.reportId);
	sendFile(res, data, 'application/pdf', filename);
});
export const archive = catchAsync(async (req, res) => responseWrapper(res, await reportService.archive(orgOf(res), req.params.reportId), 'Report archived.'));
export const email = catchAsync(async (req, res) => {
	const report = await reportService.load(orgOf(res), req.params.reportId);
	const input = res.locals.emailInput as { recipients: string[]; message?: string | null };
	const result = await reportEmailService.send(report, input.recipients, { message: input.message || null, sentBy: orgOf(res).userId, rateLimited: true });
	return responseWrapper(res, result, result.sent ? 'Report emailed.' : 'Report email logged (development).');
});

// ---- share links ----

export const share = catchAsync(async (req, res) => {
	const report = await reportService.load(orgOf(res), req.params.reportId);
	const input = res.locals.shareInput as { expires_in_days?: number | null };
	return responseWrapper(res, await shareService.create(orgOf(res), report, input.expires_in_days ?? null), 'Share link created. The link is shown only once.', httpStatus.CREATED);
});
export const listShares = catchAsync(async (req, res) => responseWrapper(res, await shareService.list(await reportService.load(orgOf(res), req.params.reportId))));
export const revokeShare = catchAsync(async (req, res) =>
	responseWrapper(res, await shareService.revoke(await reportService.load(orgOf(res), req.params.reportId), req.params.shareId), 'Share link revoked.'),
);

// ---- schedules ----

export const createSchedule = catchAsync(async (req, res) => responseWrapper(res, await scheduleService.create(orgOf(res), res.locals.scheduleInput), 'Schedule created.', httpStatus.CREATED));
export const listSchedules = catchAsync(async (req, res) => responseWrapper(res, await scheduleService.list(orgOf(res), res.locals.scheduleQuery)));
export const getSchedule = catchAsync(async (req, res) => responseWrapper(res, await scheduleService.get(orgOf(res), req.params.scheduleId)));
export const updateSchedule = catchAsync(async (req, res) =>
	responseWrapper(res, await scheduleService.update(orgOf(res), req.params.scheduleId, res.locals.scheduleInput), 'Schedule updated.'),
);
export const deleteSchedule = catchAsync(async (req, res) => responseWrapper(res, await scheduleService.remove(orgOf(res), req.params.scheduleId), 'Schedule deleted.'));

// ---- branding ----

export const getBranding = catchAsync(async (req, res) => responseWrapper(res, await brandingService.get(orgOf(res))));
export const updateBranding = catchAsync(async (req, res) => responseWrapper(res, await brandingService.update(orgOf(res), res.locals.brandingInput), 'Branding updated.'));
export const getLogo = catchAsync(async (req, res) => {
	const logo = await brandingService.readLogo(orgOf(res).organization._id);
	if (!logo) return responseWrapper(res, '', 'No logo.', httpStatus.NOT_FOUND);
	sendFile(res, logo.data, logo.mime, null);
});
export const setLogo = catchAsync(async (req, res) => responseWrapper(res, await brandingService.setLogo(orgOf(res), (res.locals.logoInput as { data: string }).data), 'Logo updated.'));
export const removeLogo = catchAsync(async (req, res) => responseWrapper(res, await brandingService.removeLogo(orgOf(res)), 'Logo removed.'));
