import httpStatus from 'http-status';
import { StaffActor, salesAuditService } from '../../services/salesAudit/salesAudit.service';
import { catchAsync, responseWrapper } from '../../utils';

// Sales audit (Phase 19): staff only (validateAdminJWTToken + audits.run ran). Validated input is on
// res.locals.auditInput.

interface Locals { locals: Record<string, unknown> }
const actorOf = (res: Locals): StaffActor => {
	const admin = res.locals.admin as { id: string; name?: string | null };
	return { id: admin.id, name: admin.name ?? null };
};
const input = <T>(res: Locals): T => res.locals.auditInput as T;

export const autocomplete = catchAsync(async (req, res) => responseWrapper(res, await salesAuditService.autocomplete(actorOf(res), input(res)), 'Suggestions.'));
export const startAudit = catchAsync(async (req, res) => responseWrapper(res, await salesAuditService.start(actorOf(res), input(res)), 'Audit started.', httpStatus.CREATED));
export const listAudits = catchAsync(async (req, res) => responseWrapper(res, await salesAuditService.list(actorOf(res)), 'Open audits.'));
export const getAudit = catchAsync(async (req, res) => responseWrapper(res, await salesAuditService.get(actorOf(res), req.params.auditId), 'Audit.'));
export const closeAudit = catchAsync(async (req, res) => responseWrapper(res, await salesAuditService.remove(actorOf(res), req.params.auditId), 'Audit closed.'));

export const auditPdf = catchAsync(async (req, res) => {
	const { buffer, filename } = await salesAuditService.pdf(actorOf(res), req.params.auditId);
	res.setHeader('Content-Type', 'application/pdf');
	res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
	res.setHeader('Cache-Control', 'no-store');
	res.send(buffer);
});
