import { RunForSummary, competitorNameFrom, reportSummaryFields, runSummaryFields, top3RateChange } from '../../../src/services/locations/summary';

const cell = (avgRank: number | null, changeLabel: string | null, change: number | null = null, top3Rate: number | null = 0.2) => ({ avgRank, top3Rate, change, changeLabel });

const run = (day: number, over: Partial<RunForSummary> = {}): RunForSummary => ({
	run_at: new Date(Date.UTC(2026, 0, day)),
	overall: { self: { overallAvgRank: 20 - day / 10, change: 1 }, competitor_1: { overallAvgRank: 5, change: null }, competitor_2: { overallAvgRank: 9, change: null } },
	...over,
});

describe('runSummaryFields', () => {
	const latest = run(30, {
		finished_at: new Date('2026-01-30T00:05:00Z'),
		targets: [
			{ key: 'self', place_id: 'SELF' },
			{ key: 'competitor_1', place_id: 'C1' },
			{ key: 'competitor_2', place_id: 'C2' },
		],
		tracker: [
			{ keyword: 'a', summary: { self: cell(3, 'improved', 2, 0.6) } },
			{ keyword: 'b', summary: { self: cell(12, 'declined', -4, 0) } },
			{ keyword: 'c', summary: { self: cell(61, 'dropped_out_of_top_60', null, 0) } },
			{ keyword: 'd', summary: { self: cell(8, 'declined', -1, 0.2) } },
			{ keyword: 'e', summary: { self: cell(9, null, null, null) } },
			{ keyword: 'f', summary: { self: cell(30, 'entered_top_60') } },
		],
		mapList: [{ results: [{ place_id: 'C1', name: 'Rival One' }] }],
	});
	const recent = [latest, ...[29, 28, 27, 26, 25, 24, 23].map((d) => run(d))];

	it('movement from change labels; declines worst first (dropped out, then the biggest drop), max 3', () => {
		const f = runSummaryFields(latest, recent);
		expect(f.movement).toEqual({ improved: 1, declined: 2, unchanged: 0, entered_top_60: 1, dropped_out_of_top_60: 1, not_comparable: 1 });
		expect(f.declines).toEqual([
			{ keyword: 'c', change: null, label: 'dropped_out_of_top_60' },
			{ keyword: 'b', change: -4, label: 'declined' },
			{ keyword: 'd', change: -1, label: 'declined' },
		]);
		expect(f.top3_rate).toBe(0.2);
		expect(f.last_run_at).toEqual(new Date('2026-01-30T00:05:00Z'));
	});

	it('trend: the last 6 runs, oldest first', () => {
		const f = runSummaryFields(latest, recent);
		expect(f.rank_trend).toHaveLength(6);
		expect(f.rank_trend?.[5]).toEqual({ run_at: latest.run_at, overall_avg_rank: 17 });
		expect(f.rank_trend?.[0].run_at).toEqual(new Date(Date.UTC(2026, 0, 25)));
	});

	it('key competitor: the best-ranked tracked competitor, ahead or not; null without competitors', () => {
		expect(runSummaryFields(latest, recent).key_competitor).toEqual({ place_id: 'C1', name: 'Rival One', avg_rank: 5, self_avg_rank: 17, ahead: true });
		const leading = { ...latest, overall: { ...latest.overall, self: { overallAvgRank: 2, change: 0 } } };
		expect(runSummaryFields(leading, [leading]).key_competitor).toMatchObject({ ahead: false, self_avg_rank: 2 });
		expect(runSummaryFields({ ...latest, targets: [{ key: 'self', place_id: 'SELF' }] }, [latest]).key_competitor).toBeNull();
	});

	it('top-3 rate change vs the previous run, on the keywords both runs have (2026-10-02)', () => {
		const previous = run(29, {
			tracker: [
				{ keyword: 'A', summary: { self: cell(5, null, null, 0.2) } },
				{ keyword: 'b', summary: { self: cell(12, null, null, 0.2) } },
				{ keyword: 'gone', summary: { self: cell(1, null, null, 1) } },
			],
		});
		// a: 0.6 vs 0.2, b: 0 vs 0.2 → mean 0.3 vs 0.2; 'gone' and the new keywords are ignored.
		expect(top3RateChange(latest, previous)).toBe(0.1);
		expect(runSummaryFields(latest, recent, previous).top3_rate_change).toBe(0.1);
		expect(runSummaryFields(latest, recent).top3_rate_change).toBeNull();
		expect(top3RateChange(latest, run(29, { tracker: [{ keyword: 'z', summary: { self: cell(5, null) } }] }))).toBeNull();
	});
});

describe('reportSummaryFields', () => {
	const score = {
		available: true,
		score: 62,
		grade: 'C',
		partial: true,
		pillars: [{ id: 'activity', weight: 20, available: true, earned: 5, available_max: 20, score: 5 }],
		checks: [{ id: 'special_hours', status: 'scored', points: 0, max: 2 }],
		top_fixes: [{ id: 'recent_post', pillar: 'activity', label: 'Post', fix_hint: 'Post weekly', points: 0, max: 6 }],
	};
	const report = {
		gbp_score: score,
		competitors: { available: true, rows: [{ is_self: true, place_id: 'S', rating: 4.4, user_rating_count: 30, public_score: { score: 58 } }, { is_self: false, place_id: 'C1', name: 'Rival One' }] },
		reviews: { available: false, reason: 'v4_access_pending' },
		verification: { available: true, has_voice_of_merchant: false },
		pending_google_edits: { available: true, has_pending: true },
		sync: { last_synced_at: null, last_status: 'partial', types: {} },
		score_history: [
			{ generated_at: new Date(), gbp_score: 70, grade: 'B', public_score: 55 },
			{ generated_at: new Date(), gbp_score: 62, grade: 'C', public_score: 58 },
		],
	} as never;

	it('score, change from the history, weighted fixes, issues, public rating', () => {
		expect(reportSummaryFields(report)).toEqual({
			gbp_score: 62,
			gbp_grade: 'C',
			gbp_partial: true,
			gbp_score_change: -8,
			top_fixes: [{ id: 'recent_post', pillar: 'activity', label: 'Post', fix_hint: 'Post weekly', lost: 6 }],
			gbp_issues: [
				{ id: 'not_verified', label: 'The profile is not verified' },
				{ id: 'pending_google_edits', label: 'Google has suggested edits waiting for review' },
				{ id: 'sync_failed', label: 'The last GBP sync failed for some data' },
				{ id: 'holiday_hours', label: 'Holiday hours are missing for upcoming holidays' },
			],
			public_score: 58,
			rating: 4.4,
			review_count: 30,
			reviews_available: false,
			unreplied: null,
		});
		expect(competitorNameFrom(report, 'C1')).toBe('Rival One');
	});

	it('without a GBP connection: no score, no issues, no change', () => {
		const f = reportSummaryFields({ ...(report as object), gbp_score: { available: false, reason: 'gbp_not_connected' }, score_history: [] } as never);
		expect(f).toMatchObject({ gbp_score: null, gbp_score_change: null, gbp_issues: [], top_fixes: [] });
	});
});
