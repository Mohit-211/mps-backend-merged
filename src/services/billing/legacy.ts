import httpStatus from 'http-status';
import { Types } from 'mongoose';
import { PaypalClient, paypalClient } from '../../clients/paypalClient';
import logger from '../../configs/logger';
import { currencyFor } from '../../billing/constants';
import { IOrganization, ISubscription, Location, Organization, Payment, Subscription, User } from '../../models';
import { apiErrorWithData } from '../../utils';
import { planForOrganization } from './plans';
import { createSubscriptionService } from './subscriptions';

// Legacy guest-checkout subscriptions (Phase 13a). Before 13a, PayPal subscriptions were bought without an
// account and stored in `payments` (paypal_subscription_id, customer_email). They are linked to the
// organization owned by the user with that verified email (migrate:billing), or by an admin.

type Id = Types.ObjectId | string;

export interface LegacyPaymentRow {
	_id: Types.ObjectId;
	paypal_subscription_id?: string | null;
	customer_email?: string | null;
	customer_name?: string | null;
	monthly_amount?: number | null;
	final_amount?: number | null;
	subscription_status?: string | null;
	status?: string | null;
	subscription_start_date?: Date | null;
	created_at?: Date | null;
}

/** Paid legacy subscriptions still running (a PayPal subscription id, paid or active, not ended). */
export const legacyPaidFilter = () => ({
	paypal_subscription_id: { $type: 'string', $ne: '' },
	subscription_status: { $nin: ['cancelled', 'expired', 'halted', 'completed'] },
	$or: [{ status: 'SUCCESS' }, { subscription_status: 'active' }],
});

export const listLegacyPayments = async (): Promise<LegacyPaymentRow[]> => Payment.collection.find(legacyPaidFilter()).sort({ created_at: -1 }).limit(1000).toArray() as unknown as Promise<LegacyPaymentRow[]>;

/** The organization owned by the verified user with this email (null when none or ambiguous). */
export const organizationForEmail = async (email: string | null | undefined): Promise<IOrganization | null> => {
	if (!email) return null;
	const escaped = email.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const user = await User.findOne({ email: { $regex: `^${escaped}$`, $options: 'i' }, email_verified_at: { $ne: null } }).select({ _id: 1 }).lean<{ _id: Types.ObjectId }>();
	if (!user) return null;
	const owned = await Organization.find({ owner_user_id: user._id, is_active: true }).lean<IOrganization[]>();
	return owned.length === 1 ? owned[0] : null;
};

/** Creates the organization's Subscription for a legacy PayPal subscription. */
export const linkLegacyPayment = async (payment: LegacyPaymentRow, organizationId: Id, deps: { paypal?: () => PaypalClient; now?: () => Date } = {}): Promise<ISubscription> => {
	const now = (deps.now ?? (() => new Date()))();
	const providerId = payment.paypal_subscription_id;
	if (!providerId) throw apiErrorWithData(httpStatus.BAD_REQUEST, 'This payment has no PayPal subscription.', { reason: 'not_a_subscription' });
	if (await Subscription.exists({ provider_subscription_id: providerId })) throw apiErrorWithData(httpStatus.CONFLICT, 'This PayPal subscription is already linked.', { reason: 'already_linked' });
	const org = await Organization.findById(organizationId).lean<IOrganization>();
	if (!org) throw apiErrorWithData(httpStatus.NOT_FOUND, 'Organization not found.', { reason: 'not_found' });
	if (await Subscription.exists({ organization_id: org._id, open: true })) throw apiErrorWithData(httpStatus.CONFLICT, 'The organization already has a subscription.', { reason: 'already_subscribed' });
	const plan = await planForOrganization(org);
	const quantity = Math.max(1, await Location.countDocuments({ organization_id: org._id, is_active: true }));
	const started = payment.subscription_start_date ?? payment.created_at ?? now;
	const monthly = Number(payment.monthly_amount ?? payment.final_amount ?? 0) || 0;
	const sub = (
		await Subscription.create({
			organization_id: org._id,
			plan_id: plan._id,
			billing_method: 'paypal',
			provider_subscription_id: providerId,
			currency: currencyFor(org.country),
			status: 'active',
			open: true,
			started_at: started,
			current_period_start: started,
			// The legacy price stays until the first renewal snapshot re-prices it (first + (n − 1) × additional).
			paid_quantity: quantity,
			price: { first: monthly, additional: 0 },
			legacy_payment_id: payment._id,
			note: 'linked from a legacy guest-checkout payment',
			events: [{ at: now, type: 'legacy_linked', detail: `payment ${String(payment._id)}` }],
		})
	).toObject() as ISubscription;
	// Read the real status and period from PayPal when configured (otherwise the webhooks fill it in).
	const client = (deps.paypal ?? paypalClient)();
	if (client.configured()) {
		try {
			return await createSubscriptionService({ paypal: () => client }).applyPaypal(sub, await client.getSubscription(providerId));
		} catch (err) {
			logger.warn(`billing: legacy link ${String(sub._id)}: PayPal read failed: ${(err as Error).message}`);
		}
	}
	return sub;
};
