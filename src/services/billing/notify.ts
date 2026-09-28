import logger from '../../configs/logger';

// Billing notifications (Phase 13a). The event → email mapping lives here so services only say what
// happened; emails are sent by D4's billing emails (development: logged, masked).

export type BillingNotice =
	| { kind: 'receipt'; organization_id: string; invoice_id: string }
	| { kind: 'payment_failed'; organization_id: string; grace_ends_at: Date | null }
	| { kind: 'subscription_cancelled'; organization_id: string; access_until: Date | null }
	| { kind: 'subscription_activated'; organization_id: string };

type Sender = (n: BillingNotice) => Promise<void>;
let sender: Sender = async (n) => {
	logger.info(`billing: notice ${n.kind} for organization ${n.organization_id}`);
};

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
