import { NamedPlaceEntry } from '../../src/clients/types/places';
import { AUDIT, AuditCell, auditBucket, auditRankText, capCell, checklist, countryOf, factsFrom, quickScore, rankedAtCenter, summarise, topOthers } from '../../src/salesAudit/compute';
import { actionsFor } from '../../src/services/salesAudit/document';

const cell = (rank: number | null, status: AuditCell['status'] = rank === null ? 'not_found' : 'ok'): AuditCell => ({ row: 0, col: 0, lat: 0, lng: 0, rank, status });
const named = (ids: string[]): NamedPlaceEntry[] => ids.map((id, i) => ({ id, name: `Biz ${i + 1}`, address: `${i + 1} Main St` }));

describe('sales audit: ranks to 30', () => {
	it('caps ranks deeper than 30 as 30+', () => {
		expect(capCell({ rank: 31, status: 'ok' })).toEqual({ rank: null, status: 'not_found' });
		expect(capCell({ rank: 30, status: 'ok' })).toEqual({ rank: 30, status: 'ok' });
		expect(capCell({ rank: null, status: 'error' })).toEqual({ rank: null, status: 'error' });
		expect(auditRankText({ rank: null, status: 'not_found' })).toBe('30+');
		expect(auditRankText({ rank: null, status: 'error' })).toBe('–');
		expect(auditBucket({ rank: 25, status: 'ok' })).toBe('invisible');
		expect(auditBucket({ rank: 2, status: 'ok' })).toBe('pack');
	});

	it('summarises over the points that did not fail, 30+ counted as 31', () => {
		const cells = [cell(1), cell(3), cell(null), cell(null, 'error'), cell(10)];
		expect(summarise(cells, 0)).toEqual({ center_rank: 1, center_status: 'ok', avg_rank: 11.3, found_rate: 0.75, top3_rate: 0.5, points: 5, failed_points: 1 });
		expect(summarise([cell(null, 'error')], 0)).toMatchObject({ center_rank: null, center_status: 'error', avg_rank: null, found_rate: null });
	});
});

describe('sales audit: who ranks higher', () => {
	it('lists the businesses above the client and its own rank', () => {
		const r = rankedAtCenter(named(['a', 'b', 'self', 'c', 'd', 'e']), 'self');
		expect(r.self_rank).toBe(3);
		expect(r.higher.map((h) => h.place_id)).toEqual(['a', 'b']);
		expect(topOthers(r.list).map((h) => h.place_id)).toEqual(['a', 'b', 'c']);
	});

	it('lists all 30 when the client is not in the top 30', () => {
		const ids = Array.from({ length: 40 }, (_, i) => `p${i}`);
		ids[34] = 'self';
		const r = rankedAtCenter(named(ids), 'self');
		expect(r.self_rank).toBeNull();
		expect(r.higher).toHaveLength(AUDIT.maxRank);
	});

	it('matches a moved place id', () => {
		const r = rankedAtCenter([{ id: 'old', movedPlaceId: 'self', name: 'X' }], 'self');
		expect(r.self_rank).toBe(1);
	});
});

describe('sales audit: quick score', () => {
	const full = factsFrom({
		displayName: 'Maple Leaf Plumbing',
		rating: 4.8,
		userRatingCount: 250,
		primaryTypeDisplayName: 'Plumber',
		regularOpeningHours: { weekdayDescriptions: ['Monday: 8 AM–5 PM'] },
		websiteUri: 'https://example.test',
		nationalPhoneNumber: '(506) 555-0100',
		editorialSummary: 'Family plumbers.',
		photoCount: 10,
		businessStatus: 'OPERATIONAL',
	});

	it('gives full marks to a complete profile', () => {
		const s = quickScore(full);
		expect(s).toMatchObject({ score: 100, grade: 'A', flag: null });
		expect(checklist(full, s).every((c) => c.state === 'good')).toBe(true);
	});

	it('flags what is missing and suggests actions against the top 3', () => {
		const thin = { ...full, rating: 4.1, user_rating_count: 12, has_hours: false, website: null, photo_count: 2 };
		const s = quickScore(thin);
		const items = Object.fromEntries(checklist(thin, s).map((c) => [c.id, c.state]));
		expect(items).toMatchObject({ rating: 'partial', review_count: 'partial', hours: 'missing', website: 'missing', phone: 'good', photos: 'partial' });
		expect(s.score).toBeLessThan(70);
		const actions = actionsFor({ ...thin, country: 'CA', score: s, checklist: checklist(thin, s) }, [{ rank: 1, name: 'Top', address: null, facts: full, score: quickScore(full) }]);
		expect(actions[0]).toBe('Get more Google reviews: you have 12, the leading business near you has 250.');
		expect(actions).toEqual(expect.arrayContaining(['Add your opening hours to your Google Business Profile.', 'Add your website to your Google Business Profile.']));
		expect(actions.length).toBeLessThanOrEqual(5);
	});

	it('reads the country from the address', () => {
		expect(countryOf({ addressComponents: [{ long: 'Canada', short: 'CA', types: ['country', 'political'] }] })).toBe('CA');
		expect(countryOf({ addressComponents: [{ long: 'Mexico', short: 'MX', types: ['country'] }] })).toBeNull();
		expect(countryOf({})).toBeNull();
	});
});
