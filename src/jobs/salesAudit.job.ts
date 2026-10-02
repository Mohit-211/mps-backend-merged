import { Agenda } from 'agenda';
import { executeSalesAudit } from '../services/salesAudit/executor';
import { defineJob } from './defineJob';
import { JOB_NAMES } from './jobNames';

// sales-audit (Phase 19): runs one queued sales audit. Job data is { audit_id } only. The outcome is
// stored on the audit (done / failed and why), so the job does not throw for a failed audit.
export const defineSalesAuditJob = (agenda: Agenda): void =>
	defineJob<{ audit_id: string }>(agenda, {
		name: JOB_NAMES.SALES_AUDIT,
		concurrency: 4,
		lockLifetimeMs: 10 * 60 * 1000,
		handler: async ({ audit_id }) => executeSalesAudit(audit_id),
	});
