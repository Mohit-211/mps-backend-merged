import fs from 'fs';
import os from 'os';
import path from 'path';
import { Invoice, Organization, TokenLedger } from '../../../src/models';
import { createStorage } from '../../../src/services/reports/storage';
import { createInvoiceService, invoicePdfPath, nextInvoiceNumber } from '../../../src/services/billing/invoices';
import { credit, linkSpend, refundSpend, spend } from '../../../src/services/billing/tokens';
import { clearDb, createUser, ensureOrg, startTestDb } from '../../helpers/mongoose';

jest.setTimeout(60000);

let db: { stop: () => Promise<void> };
let dir: string;
beforeAll(async () => {
	db = await startTestDb();
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mps-invoices-'));
});
afterAll(async () => {
	await db.stop();
	fs.rmSync(dir, { recursive: true, force: true });
});
beforeEach(clearDb);

const org = async () => {
	const { user } = await createUser(`o${Math.random().toString(36).slice(2, 8)}@example.com`);
	return ensureOrg(user._id);
};

describe('invoices', () => {
	it('numbers invoices per year, sequentially', async () => {
		const at = new Date('2026-10-01T00:00:00Z');
		expect(await nextInvoiceNumber(at)).toBe('INV-2026-000001');
		expect(await nextInvoiceNumber(at)).toBe('INV-2026-000002');
		expect(await nextInvoiceNumber(new Date('2027-01-02T00:00:00Z'))).toBe('INV-2027-000001');
	});

	it('issues once per provider reference, freezes the parties, flags a charged mismatch, and stores a PDF', async () => {
		const o = await org();
		const storage = createStorage(dir);
		const svc = createInvoiceService({ storage, now: () => new Date('2026-10-05T00:00:00Z') });
		const input = {
			organization_id: o._id,
			kind: 'subscription' as const,
			status: 'paid' as const,
			currency: 'USD' as const,
			lines: [
				{ label: 'First location', quantity: 1, unit_price: 49, amount: 49 },
				{ label: 'Additional locations', quantity: 2, unit_price: 19, amount: 38 },
			],
			provider_ref: 'SALE-1',
			charged_amount: 80,
		};
		const a = await svc.issue(input);
		const b = await svc.issue(input);
		expect(String(b._id)).toBe(String(a._id));
		expect(await Invoice.countDocuments()).toBe(1);
		expect(a.number).toBe('INV-2026-000001');
		expect(a.total).toBe(87);
		expect(a.tax_lines).toEqual([]);
		expect(a.mismatch).toBe(true);
		expect(a.customer.name).toBe(o.name);
		expect(a.paid_at).toBeTruthy();
		expect(a.pdf?.bytes).toBeGreaterThan(1000);
		const pdf = fs.readFileSync(invoicePdfPath(storage, o._id, a._id));
		expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
	});

	it('marks an open manual invoice paid only once', async () => {
		const o = await org();
		const svc = createInvoiceService({ storage: createStorage(dir) });
		const inv = await svc.issue({ organization_id: o._id, kind: 'manual', status: 'open', currency: 'CAD', lines: [{ label: 'Locations', quantity: 1, unit_price: 10, amount: 10 }], due_at: new Date() });
		expect(inv.status).toBe('open');
		expect((await svc.markPaid(inv._id, 'wire 123'))?.status).toBe('paid');
		expect(await svc.markPaid(inv._id, 'again')).toBeNull();
	});
});

describe('token ledger', () => {
	const balance = async (id: unknown) => (await Organization.findById(id).lean())?.token_balance ?? 0;

	it('credits, spends only with enough balance, and records balance_after', async () => {
		const o = await org();
		expect(await credit(o._id, 'purchase', 10, { ref: 'ORDER-1' })).toBe(10);
		const s = await spend(o._id, 4, { location_id: null });
		expect(s).toMatchObject({ ok: true, balance: 6 });
		const denied = await spend(o._id, 7, {});
		expect(denied).toMatchObject({ ok: false, balance: 6, entry_id: null });
		expect(await balance(o._id)).toBe(6);
		const rows = await TokenLedger.find({ organization_id: o._id }).sort({ at: 1, _id: 1 }).lean();
		expect(rows.map((r) => [r.type, r.amount, r.balance_after])).toEqual([
			['purchase', 10, 10],
			['spend', -4, 6],
		]);
	});

	it('parallel spends never overdraw', async () => {
		const o = await org();
		await credit(o._id, 'grant', 3);
		const results = await Promise.all(Array.from({ length: 6 }, () => spend(o._id, 1, {})));
		expect(results.filter((r) => r.ok)).toHaveLength(3);
		expect(await balance(o._id)).toBe(0);
	});

	it('refunds a linked spend exactly once', async () => {
		const o = await org();
		await credit(o._id, 'purchase', 5);
		const s = await spend(o._id, 2, {});
		await linkSpend(s.entry_id as string, 'rank_run:abc');
		expect(await refundSpend('rank_run:abc', 'run failed')).toBe(2);
		expect(await refundSpend('rank_run:abc', 'run failed')).toBe(0);
		expect(await refundSpend('rank_run:unknown', 'x')).toBe(0);
		expect(await balance(o._id)).toBe(5);
	});

	it('refuses a negative adjustment below zero', async () => {
		const o = await org();
		await credit(o._id, 'grant', 1);
		await expect(credit(o._id, 'adjustment', -2, { note: 'fix' })).rejects.toMatchObject({ statusCode: 409 });
		expect(await credit(o._id, 'adjustment', -1, { note: 'fix' })).toBe(0);
	});
});
