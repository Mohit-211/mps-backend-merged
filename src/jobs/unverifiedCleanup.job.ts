import { Agenda } from 'agenda';
import { cleanupUnverifiedAccounts } from '../services/auth/emailVerification';
import { defineJob } from './defineJob';
import { JOB_NAMES } from './jobNames';

// Phase 8.1: hourly, deletes signups still unverified after their deadline (EMAIL_VERIFICATION_TTL_HOURS).
// One agenda document (agenda.every), locked in MongoDB, so a single pm2 process runs it at a time.

export const UNVERIFIED_CLEANUP_INTERVAL = '1 hour';

export const defineUnverifiedCleanupJob = (agenda: Agenda): void => {
	defineJob<Record<string, string>>(agenda, {
		name: JOB_NAMES.UNVERIFIED_CLEANUP,
		concurrency: 1,
		lockLifetimeMs: 15 * 60 * 1000,
		handler: async () => {
			await cleanupUnverifiedAccounts();
		},
	});
};
