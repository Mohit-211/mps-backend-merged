import { Types } from 'mongoose';
import { BillingPlan, Invoice, Organization, Subscription, TokenLedger } from '../../../src/models';
import { standardPlan } from '../../../src/services/billing/plans';
import { sendBillingReminders } from '../../../src/services/billing/reminders';
import { createPaypalProvider } from '../../../src/services/billing/providers/paypal';
import { createRenewalService } from '../../../src/services/billing/renewals';
import { credit, spend } from '../../../src/services/billing/tokens';
import { activateBilling } from '../../helpers/billing';
import { clearDb, createLocation, createUser, ensureOrg, startTestDb } from '../../helpers/mongoose';

jest.setTimeout(60000);

const DAY = 86_400_000;
let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
});
afterAll(async () => db.stop());
beforeEach(clearDb);

const fakePaypal = () => {
	const setSubscriptionPrice = jest.fn(async () => undefined);
	// Phase 13b: renewals talk to the provider interface; the PayPal provider wraps a fake client.
	const provider = createPaypalProvider({ client: () => ({ configured: () => true, setSubscriptionPrice }) as never, renewalLeadDays: 11 });
	return { client: provider, setSubscriptionPrice };
};

const org = async (email = 'o@test.dev') => {
	const { user } = await createUser(email);
	const o = await ensureOrg(user._id);
	await Organization.updateOne({ _id: o._id }, { $set: { token_balance: 0 } });
	return { user, orgId: o._id as Types.ObjectId };
};

const prices = async (list: { first: number; additional: number; from: string }[]) => {
	const plan = await standardPlan();
	await BillingPlan.updateOne(
		{ _id: plan._id },
		{ $set: { prices: list.map((p) => ({ currency: 'CAD', first_location_price: p.first, additional_location_price: p.additional, effective_from: new Date(p.from), set_at: new Date() })) } },
	);
};

describe('PayPal renewal snapshot', () => {
	it('11 days ahead: quantity = active locations, the price in effect at the renewal, PATCHed once', async () => {
		const now = new Date('2026-10-01T00:00:00Z');
		const { user, orgId } = await org();
		for (let i = 0; i < 3; i += 1) await createLocation(user._id as Types.ObjectId);
		// A new price starts before the renewal date: the renewal uses it.
		await prices([
			{ first: 49, additional: 19, from: '2026-01-01' },
			{ first: 55, additional: 20, from: '2026-10-05' },
		]);
		const sub = await activateBilling(orgId, { billing_method: 'paypal', provider_subscription_id: 'I-R1', comp: false, quantity: 5, period_start: new Date('2026-09-10T00:00:00Z'), period_end: new Date('2026-10-10T00:00:00Z') });
		const { client, setSubscriptionPrice } = fakePaypal();
		const svc = createRenewalService({ provider: () => client, now: () => now });

		const r1 = await svc.run();
		expect(r1.snapshots).toBe(1);
		expect(setSubscriptionPrice).toHaveBeenCalledWith('I-R1', 95, 'CAD'); // 55 + 2 × 20
		const s = await Subscription.findById(sub._id).lean();
		expect(s?.next_renewal).toMatchObject({ quantity: 3, amount: 95, price: { first: 55, additional: 20 }, prepaid_quantity: 0 });
		await svc.run();
		expect(setSubscriptionPrice).toHaveBeenCalledTimes(1);
	});

	it('not yet within 11 days: nothing; a failed PATCH stores nothing and is retried', async () => {
		const { orgId } = await org();
		await prices([{ first: 49, additional: 19, from: '2026-01-01' }]);
		await activateBilling(orgId, { billing_method: 'paypal', provider_subscription_id: 'I-R2', comp: false, quantity: 1, period_start: new Date('2026-09-10T00:00:00Z'), period_end: new Date('2026-10-10T00:00:00Z') });
		const { client, setSubscriptionPrice } = fakePaypal();
		expect((await createRenewalService({ provider: () => client, now: () => new Date('2026-09-20T00:00:00Z') }).run()).snapshots).toBe(0);
		setSubscriptionPrice.mockRejectedValueOnce(new Error('503'));
		const svc = createRenewalService({ provider: () => client, now: () => new Date('2026-10-01T00:00:00Z') });
		expect(await svc.run()).toMatchObject({ snapshots: 0, patch_errors: 1 });
		expect(await svc.run()).toMatchObject({ snapshots: 1, patch_errors: 0 });
	});
});

describe('manual billing', () => {
	it('at period end: next period, an open invoice with the pending slot lines, due in 14 days; comped: no invoice', async () => {
		const { user, orgId } = await org();
		await createLocation(user._id as Types.ObjectId);
		await createLocation(user._id as Types.ObjectId);
		await prices([{ first: 49, additional: 19, from: '2026-01-01' }]);
		await BillingPlan.updateOne({ kind: 'standard' }, { $set: { monthly_token_grant: 5 } });
		const sub = await activateBilling(orgId, { billing_method: 'manual', comp: false, quantity: 2, period_start: new Date('2026-09-01T00:00:00Z'), period_end: new Date('2026-10-01T00:00:00Z') });
		await Subscription.updateOne({ _id: sub._id }, { $set: { pending_lines: [{ label: 'Additional location, prorated to 2026-10-01', quantity: 1, unit_price: 6.33, amount: 6.33 }] } });
		const now = new Date('2026-10-01T06:00:00Z');
		const svc = createRenewalService({ now: () => now });
		expect(await svc.run()).toMatchObject({ manual_advanced: 1, manual_invoices: 1 });
		await svc.run();
		const invoices = await Invoice.find({ organization_id: orgId }).lean();
		expect(invoices).toHaveLength(1);
		expect(invoices[0]).toMatchObject({ kind: 'manual', status: 'open', total: 74.33 });
		expect(invoices[0].due_at?.toISOString()).toBe('2026-10-15T00:00:00.000Z');
		const s = await Subscription.findById(sub._id).lean();
		expect(s).toMatchObject({ paid_quantity: 2, pending_lines: [] });
		expect(s?.current_period_end?.toISOString()).toBe('2026-11-01T00:00:00.000Z');
		expect((await Organization.findById(orgId).lean())?.token_balance).toBe(5);

		const other = await org('comp@test.dev');
		await activateBilling(other.orgId, { billing_method: 'manual', quantity: 1, period_start: new Date('2026-09-01T00:00:00Z'), period_end: new Date('2026-10-01T00:00:00Z') });
		expect(await svc.run()).toMatchObject({ manual_advanced: 1, manual_invoices: 0 });
	});
});

describe('token expiry', () => {
	it('expires only what is left of the pack (oldest tokens are spent first), once', async () => {
		const { orgId } = await org();
		const t0 = new Date('2026-09-01T00:00:00Z');
		await credit(orgId, 'purchase', 10, { ref: 'order:a', expires_at: new Date('2026-09-30T00:00:00Z') }, t0);
		await spend(orgId, 4, {}, new Date('2026-09-10T00:00:00Z'));
		await credit(orgId, 'purchase', 5, { ref: 'order:b' }, new Date('2026-09-15T00:00:00Z'));
		const svc = createRenewalService({ now: () => new Date('2026-10-01T00:00:00Z') });
		expect((await svc.run()).tokens_expired).toBe(6);
		expect((await svc.run()).tokens_expired).toBe(0);
		expect((await Organization.findById(orgId).lean())?.token_balance).toBe(5);
		expect(await TokenLedger.countDocuments({ organization_id: orgId, type: 'expiry' })).toBe(1);
	});
});

describe('reminders', () => {
	it('trial ending at 3 days and 1 day, once each; overdue manual invoices once', async () => {
		const { orgId } = await org();
		const now = new Date('2026-10-01T00:00:00Z');
		await Organization.updateOne({ _id: orgId }, { $set: { trial_ends_at: new Date(now.getTime() + 2.5 * DAY) } });
		expect(await sendBillingReminders(now)).toMatchObject({ trial: 1 });
		expect(await sendBillingReminders(now)).toMatchObject({ trial: 0 });
		const later = new Date(now.getTime() + 2 * DAY);
		expect(await sendBillingReminders(later)).toMatchObject({ trial: 1 });
		expect((await Organization.findById(orgId).lean())?.billing_reminders?.sent).toEqual([3, 1]);

		await Invoice.create({ number: 'INV-2026-000900', organization_id: orgId, kind: 'manual', status: 'open', currency: 'CAD', lines: [], tax_lines: [], total: 10, issued_at: now, due_at: new Date(now.getTime() - DAY), customer: { name: 'x', email: null, address: [] }, seller: { name: 'y', email: null, address: [], tax_id: null } });
		expect(await sendBillingReminders(now)).toMatchObject({ overdue: 1 });
		expect(await sendBillingReminders(now)).toMatchObject({ overdue: 0 });
	});
});
