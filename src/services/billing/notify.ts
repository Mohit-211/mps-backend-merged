import logger from '../../configs/logger';
import { sendBillingNotice } from './billingEmails';

// Billing notifications (Phase 13a). Services only say what happened; billingEmails turns it into an
// email (development: logged with the address masked, nothing sent).

export type BillingNotice =
	| { kind: 'receipt'; organization_id: string; invoice_id: string }
	| { kind: 'payment_failed'; organization_id: string; grace_ends_at: Date | null }
	| { kind: 'subscription_cancelled'; organization_id: string; access_until: Date | null }
	| { kind: 'subscription_activated'; organization_id: string }
	| { kind: 'trial_ending'; organization_id: string; days: number; trial_ends_at: Date }
	| { kind: 'invoice_issued'; organization_id: string; invoice_id: string }
	| { kind: 'invoice_overdue'; organization_id: string; invoice_id: string };

type Sender = (n: BillingNotice) => Promise<void>;
let sender: Sender = sendBillingNotice;

export const setBillingNoticeSender = (s: Sender): void => {
	sender = s;
};

/** Never throws: a failed email must not fail a payment. */
export const notify = async (n: BillingNotice): Promise<void> => {
	try {
		await sender(n);
	} catch (err) {
		logger.warn(`billing: notice ${n.kind} failed: ${(err as Error).message}`);
	}
};
