import { Agenda } from 'agenda';
import { sendBillingReminders } from '../services/billing/reminders';
import { renewalService } from '../services/billing/renewals';
import { defineJob } from './defineJob';
import { JOB_NAMES } from './jobNames';

// Phase 13a: renewals every 6 hours (PayPal renewal snapshots + price PATCH 11 days ahead, manual
// invoices, token expiry) and reminders daily. One agenda document each (agenda.every), Mongo-locked.

export const BILLING_RENEWALS_INTERVAL = '6 hours';
export const BILLING_REMINDERS_INTERVAL = '1 day';

export const defineBillingJobs = (agenda: Agenda): void => {
	defineJob<Record<string, string>>(agenda, {
		name: JOB_NAMES.BILLING_RENEWALS,
		concurrency: 1,
		lockLifetimeMs: 30 * 60 * 1000,
		handler: async () => {
			await renewalService.run();
		},
	});
	defineJob<Record<string, string>>(agenda, {
		name: JOB_NAMES.BILLING_REMINDERS,
		concurrency: 1,
		lockLifetimeMs: 15 * 60 * 1000,
		handler: async () => {
			await sendBillingReminders();
		},
	});
};
