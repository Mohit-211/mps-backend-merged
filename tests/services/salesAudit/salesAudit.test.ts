import { Agenda } from 'agenda';
import { HttpRequestError } from '../../../src/clients/http';
import { PlacesApiError } from '../../../src/clients/placesClient';
import {
	AutocompleteParams,
	NamedPlaceEntry,
	PlaceDetails,
	PlaceDetailsField,
	SearchTextIdsParams,
	SearchTextWithNamesParams,
} from '../../../src/clients/types/places';
import config from '../../../src/configs/config';
import { ApiUsage, SalesAudit } from '../../../src/models';
import { renderPdf } from '../../../src/services/reports/render/pdf';
import { auditDocument } from '../../../src/services/salesAudit/document';
import { executeSalesAudit } from '../../../src/services/salesAudit/executor';
import { createSalesAuditService } from '../../../src/services/salesAudit/salesAudit.service';
import { costReport } from '../../../src/services/usage/cost';
import { recordUsage, withUsage } from '../../../src/services/usage/scope';
import { clearDb, startTestDb } from '../../helpers/mongoose';

// Sales audit (Phase 19): start → job → view → PDF → close, on a fake Places client (no network).

const SELF = 'ChIJselfselfselfselfself1';
const FREDERICTON = { lat: 45.9636, lng: -66.6431 };
const fail = () => new PlacesApiError(new HttpRequestError({ code: 'HTTP_ERROR', status: 500, message: 'boom' }), 2);
const other = (i: number) => `ChIJother${String(i).padStart(15, '0')}`;

interface FakeOptions {
	/** The client's rank at a search point (null = not in the results). */
	rank: (lat: number, lng: number) => number | null;
	failIds?: (lat: number, lng: number) => boolean;
	failNames?: boolean;
	country?: string;
}

const fakePlaces = (o: FakeOptions) => {
	const calls = { ids_only: 0, pro: 0, details: 0, autocomplete: 0, idsMaxPages: new Set<number>(), namesMaxPages: new Set<number>() };
	const list = (lat: number, lng: number, depth = 60): string[] => {
		const ids = Array.from({ length: depth }, (_, i) => other(i + 1));
		const r = o.rank(lat, lng);
		if (r !== null && r <= depth) ids.splice(r - 1, 0, SELF);
		return ids.slice(0, depth);
	};
	const details = (id: string): PlaceDetails =>
		id === SELF
			? {
					id: SELF,
					displayName: 'Maple Leaf Plumbing',
					formattedAddress: '1 King St, Fredericton, NB',
					location: { latitude: FREDERICTON.lat, longitude: FREDERICTON.lng },
					addressComponents: [{ long: o.country ?? 'Canada', short: o.country === 'Mexico' ? 'MX' : 'CA', types: ['country'] }],
					rating: 4.2,
					userRatingCount: 18,
					primaryTypeDisplayName: 'Plumber',
					nationalPhoneNumber: '(506) 555-0100',
					photoCount: 3,
					businessStatus: 'OPERATIONAL',
				}
			: { id, displayName: `Rival ${id.slice(-2)}`, rating: 4.8, userRatingCount: 240, primaryTypeDisplayName: 'Plumber', websiteUri: 'https://r.test', regularOpeningHours: { weekdayDescriptions: ['Mon'] }, photoCount: 10 };
	return {
		calls,
		searchTextIds: async (p: SearchTextIdsParams) => {
			calls.idsMaxPages.add(p.maxPages ?? 3);
			const lat = p.center?.latitude ?? 0;
			const lng = p.center?.longitude ?? 0;
			if (o.failIds?.(lat, lng)) {
				calls.ids_only += 2;
				throw fail();
			}
			const pages = p.maxPages ?? 3;
			calls.ids_only += pages;
			return { places: list(lat, lng).slice(0, pages * 20).map((id) => ({ id })), pagesFetched: pages, apiCalls: pages, stoppedEarly: false };
		},
		searchTextWithNames: async (p: SearchTextWithNamesParams) => {
			calls.namesMaxPages.add(p.maxPages ?? 1);
			if (o.failNames) {
				calls.pro += 2;
				throw fail();
			}
			const all = list(p.center?.latitude ?? 0, p.center?.longitude ?? 0);
			const page1 = all.slice(0, 20);
			const pages = page1.includes(SELF) ? 1 : Math.min(p.maxPages ?? 1, 3);
			calls.pro += pages;
			const places: NamedPlaceEntry[] = all.slice(0, pages * 20).map((id, i) => ({ id, name: id === SELF ? 'Maple Leaf Plumbing' : `Rival ${i + 1}`, address: `${i + 1} Main St` }));
			return { places, apiCalls: pages };
		},
		getPlaceDetails: async (id: string, fields: PlaceDetailsField[]) => {
			expect(fields.length).toBeGreaterThan(0);
			calls.details += 1;
			return { details: details(id), apiCalls: 1 };
		},
		autocomplete: async (p: AutocompleteParams) => {
			calls.autocomplete += 1;
			return {
				suggestions: [
					{ place_id: SELF, description: 'Maple Leaf Plumbing, Fredericton', main_text: 'Maple Leaf Plumbing', secondary_text: 'Fredericton', types: ['plumber', 'establishment'] },
					{ place_id: 'ChIJregion', description: `${p.input} Street`, main_text: 'Street', secondary_text: null, types: ['route'] },
				],
				apiCalls: 1,
			};
		},
	};
};

const fakeAgenda = () => {
	const schedule = jest.fn(async () => ({}));
	return { agenda: { schedule } as unknown as Agenda, schedule };
};

const STAFF = { id: '0123456789abcdef01234567', name: 'Sam Sales' };
const OTHER_STAFF = { id: '0123456789abcdef01234568', name: 'Other' };

let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
	await SalesAudit.syncIndexes();
	await ApiUsage.syncIndexes();
}, 120000);
afterAll(async () => db.stop());
beforeEach(async () => clearDb());

const startAndRun = async (o: FakeOptions, now = new Date('2026-10-02T15:00:00Z')) => {
	const places = fakePlaces(o);
	const { agenda, schedule } = fakeAgenda();
	const service = createSalesAuditService({ places, agenda, now: () => now });
	const started = await service.start(STAFF, { place_id: SELF, session: 'session-abc-123', keyword: '  Emergency   Plumber ' });
	await executeSalesAudit(started.id, { places, now: () => now, jitterMs: [0, 0] });
	return { places, service, started, schedule, view: await service.get(STAFF, started.id) };
};

describe('sales audit: start', () => {
	it('looks the business up, scores it and queues the job', async () => {
		const { started, schedule, places } = await startAndRun({ rank: () => 5 });
		expect(started).toMatchObject({ status: 'queued', keyword: 'Emergency Plumber', grid: { size: 7, radius_km: 5 }, api_calls: { details: 1 } });
		expect(started.business).toMatchObject({ place_id: SELF, country: 'CA', region: 'ca', name: 'Maple Leaf Plumbing', rating: 4.2, user_rating_count: 18 });
		expect((started.business as unknown as { score: { score: number } }).score.score).toBeGreaterThan(0);
		expect(schedule).toHaveBeenCalledWith(expect.any(Date), 'sales-audit', { audit_id: started.id });
		const expires = new Date(started.expires_at as Date).getTime() - new Date(started.created_at as Date).getTime();
		expect(expires).toBe(config.staffAudit.ttlHours * 3600 * 1000);
		expect(places.calls.details).toBe(4); // the business + top 3 others
	});

	it('refuses a business outside the US and Canada', async () => {
		const service = createSalesAuditService({ places: fakePlaces({ rank: () => 1, country: 'Mexico' }), agenda: fakeAgenda().agenda });
		await expect(service.start(STAFF, { place_id: SELF, keyword: 'plumber' })).rejects.toMatchObject({ statusCode: 400, data: { reason: 'unsupported_country' } });
	});

	it('suggests businesses only', async () => {
		const service = createSalesAuditService({ places: fakePlaces({ rank: () => 1 }) });
		const res = await service.autocomplete(STAFF, { input: 'maple', session: 'session-abc-123' });
		expect(res.suggestions.map((s) => s.place_id)).toEqual([SELF]);
		expect(res.attribution.text).toBe('Google Maps');
	});

	it('stops at the daily limit per staff member', async () => {
		const places = fakePlaces({ rank: () => 1 });
		const service = createSalesAuditService({ places, agenda: fakeAgenda().agenda });
		const limit = config.staffAudit.dailyLimit;
		for (let i = 0; i < limit; i++) await service.start(STAFF, { place_id: SELF, keyword: 'plumber' });
		await expect(service.start(STAFF, { place_id: SELF, keyword: 'plumber' })).rejects.toMatchObject({ statusCode: 429, data: { reason: 'daily_limit_reached', limit } });
		await expect(service.start(OTHER_STAFF, { place_id: SELF, keyword: 'plumber' })).resolves.toMatchObject({ status: 'queued' });
	});
});

describe('sales audit: the job', () => {
	it('ranks a 7×7 grid to 30, names who ranks higher and scores the top 3', async () => {
		// Ranked 5 at the business, 25 north of it, out of the top 30 (rank 45) in the south rows.
		const { view, places } = await startAndRun({ rank: (lat) => (Math.abs(lat - FREDERICTON.lat) < 1e-6 ? 5 : lat > FREDERICTON.lat ? 25 : 45) });
		expect(view.status).toBe('done');
		const result = view.result as { cells: { row: number; col: number; rank: number | null; status: string }[]; summary: Record<string, number | null>; higher: { rank: number; name: string; is_self: boolean }[]; competitors: { rank: number; score: { score: number } }[] };
		expect(result.cells).toHaveLength(49);
		expect(result.cells.find((c) => c.row === 3 && c.col === 3)).toMatchObject({ rank: 5, status: 'ok' });
		expect(result.cells.find((c) => c.row === 0)).toMatchObject({ rank: 25, status: 'ok' });
		expect(result.cells.find((c) => c.row === 6)).toMatchObject({ rank: null, status: 'not_found' });
		expect(result.summary).toMatchObject({ center_rank: 5, points: 49, failed_points: 0 });
		expect(result.higher.map((h) => h.rank)).toEqual([1, 2, 3, 4]);
		expect(result.competitors.map((c) => c.rank)).toEqual([1, 2, 3]);
		expect(result.competitors[0].score.score).toBeGreaterThan(80);
		// 2 pages per search (ranks to 30), one sample; names: page 1 only (the business is on it).
		expect(places.calls.idsMaxPages).toEqual(new Set([2]));
		expect(places.calls.namesMaxPages).toEqual(new Set([2]));
		expect(view.api_calls).toEqual({ ids_only: 98, pro: 1, details: 4 });
	});

	it('uses the named list for the rank at the business (page 2 when not on page 1)', async () => {
		const { view, places } = await startAndRun({ rank: () => 35 });
		const result = view.result as { summary: { center_rank: number | null }; higher: unknown[] };
		expect(result.summary.center_rank).toBeNull();
		expect(result.higher).toHaveLength(30);
		expect(places.calls.pro).toBe(2);
	});

	it('finishes without names when the names search fails', async () => {
		const { view } = await startAndRun({ rank: () => 2, failNames: true });
		expect(view).toMatchObject({ status: 'done', warnings: ['names_unavailable'] });
		expect(view.result).toMatchObject({ higher: null, competitors: [], summary: { center_rank: 2 } });
	});

	it('fails when every search fails, and keeps going when only some do', async () => {
		expect((await startAndRun({ rank: () => 1, failIds: () => true })).view).toMatchObject({ status: 'failed', failure_reason: 'search_failed' });
		const partial = await startAndRun({ rank: () => 1, failIds: (lat) => lat > FREDERICTON.lat + 0.03 });
		expect(partial.view).toMatchObject({ status: 'done', warnings: ['some_points_failed'] });
	});

	it('leaves a closed audit alone', async () => {
		const places = fakePlaces({ rank: () => 1 });
		const service = createSalesAuditService({ places, agenda: fakeAgenda().agenda });
		const started = await service.start(STAFF, { place_id: SELF, keyword: 'plumber' });
		await service.remove(STAFF, started.id);
		await executeSalesAudit(started.id, { places, jitterMs: [0, 0] });
		expect(await SalesAudit.countDocuments()).toBe(0);
		expect(places.calls.ids_only).toBe(0);
	});
});

describe('sales audit: usage ledger', () => {
	it('counts audit calls apart from customer work (purpose sales_audit)', async () => {
		await withUsage({ organization_id: null, location_id: null, purpose: 'sales_audit' }, async () => recordUsage('places.text.pro', 2));
		await withUsage({ organization_id: null, location_id: null }, async () => recordUsage('places.text.pro', 1));
		const rows = await ApiUsage.find({}).sort({ count: -1 }).lean();
		expect(rows.map((r) => [r.purpose, r.count])).toEqual([
			['sales_audit', 2],
			[null, 1],
		]);
		const report = await costReport(rows[0].month);
		expect(report.rows.map((r) => r.purpose).sort()).toEqual([null, 'sales_audit'].sort());
	});
});

describe('sales audit: view, PDF, close', () => {
	it('is visible only to the staff member who started it', async () => {
		const { service, started } = await startAndRun({ rank: () => 3 });
		await expect(service.get(OTHER_STAFF, started.id)).rejects.toMatchObject({ statusCode: 404, data: { reason: 'audit_not_found' } });
		await expect(service.remove(OTHER_STAFF, started.id)).rejects.toMatchObject({ statusCode: 404 });
		expect((await service.list(STAFF)).audits).toHaveLength(1);
		expect((await service.list(OTHER_STAFF)).audits).toHaveLength(0);
	});

	it('renders one PDF with both parts', async () => {
		const { service, started } = await startAndRun({ rank: (lat) => (lat < FREDERICTON.lat ? 40 : 2) });
		const { buffer, filename } = await service.pdf(STAFF, started.id);
		expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
		expect(filename).toBe('audit-maple-leaf-plumbing-2026-10-02.pdf');
		const audit = await SalesAudit.findById(started.id).lean();
		const rendered = await renderPdf(auditDocument(audit as never, new Date('2026-10-02T15:00:00Z')), { collectText: true });
		const text = rendered.text.join(' ');
		for (const s of ['Google Maps ranking for “Emergency Plumber”', 'Who ranks higher at your business', '30+', '21–30', 'Google Business Profile: quick score', 'How you compare with the top 3', 'What to work on first', 'Maple Leaf Plumbing (you)']) {
			expect(text).toContain(s);
		}
		expect(rendered.pages).toBeGreaterThanOrEqual(2);
	});

	it('answers 409 before the audit is done, and deletes it on close', async () => {
		const service = createSalesAuditService({ places: fakePlaces({ rank: () => 1 }), agenda: fakeAgenda().agenda, now: () => new Date('2026-10-02T15:00:00Z') });
		const started = await service.start(STAFF, { place_id: SELF, keyword: 'plumber' });
		await expect(service.pdf(STAFF, started.id)).rejects.toMatchObject({ statusCode: 409, data: { reason: 'audit_not_ready' } });
		await expect(service.remove(STAFF, started.id)).resolves.toEqual({ deleted: true, id: started.id });
		await expect(service.get(STAFF, started.id)).rejects.toMatchObject({ statusCode: 404 });
	});

	it('marks an audit stuck for 10 minutes as timed out, and hides expired ones', async () => {
		const t0 = new Date('2026-10-02T15:00:00Z');
		const places = fakePlaces({ rank: () => 1 });
		const started = await createSalesAuditService({ places, agenda: fakeAgenda().agenda, now: () => t0 }).start(STAFF, { place_id: SELF, keyword: 'plumber' });
		const later = createSalesAuditService({ places, now: () => new Date(t0.getTime() + 11 * 60 * 1000) });
		await expect(later.get(STAFF, started.id)).resolves.toMatchObject({ status: 'failed', failure_reason: 'timed_out' });
		const expired = createSalesAuditService({ places, now: () => new Date(t0.getTime() + (config.staffAudit.ttlHours + 1) * 3600 * 1000) });
		await expect(expired.get(STAFF, started.id)).rejects.toMatchObject({ statusCode: 404 });
	});
});
