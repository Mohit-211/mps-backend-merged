import { candidateActions, recommendedActions } from '../../../src/services/dashboard/actions';

const loc = (over: Record<string, unknown> = {}) => ({ location_id: 'L1', name: 'Alpha', status: 'active' as const, summary: {}, ...over });

describe('recommended actions', () => {
	it('reconnect and setup come first; dropped keywords, declines, competitor ahead and GBP fixes by impact', () => {
		const actions = recommendedActions([
			loc({
				summary: {
					declines: [
						{ keyword: 'drain', change: null, label: 'dropped_out_of_top_60' },
						{ keyword: 'plumber', change: -4, label: 'declined' },
					],
					key_competitor: { place_id: 'C', name: 'Rival', avg_rank: 3, self_avg_rank: 13, ahead: true },
					top_fixes: [{ id: 'recent_post', pillar: 'activity', label: 'Post weekly', fix_hint: 'Post', lost: 6 }],
				},
			}),
			loc({ location_id: 'L2', name: 'Beta', status: 'reconnect_required' }),
			loc({ location_id: 'L3', name: 'Gamma', status: 'setup_required' }),
		]);
		expect(actions.map((a) => [a.location_name, a.id, a.impact])).toEqual([
			['Beta', 'connection:reconnect', 0.95],
			['Gamma', 'setup:finish', 0.9],
			['Alpha', 'ranking:dropped:drain', 0.8],
			['Alpha', 'ranking:competitor_ahead', 0.5],
			['Alpha', 'ranking:declined:plumber', 0.4],
		]);
	});

	it('nothing for a location without data; a competitor behind is not an action; at most 5', () => {
		expect(candidateActions(loc({ summary: null }))).toEqual([]);
		expect(candidateActions(loc({ summary: { key_competitor: { place_id: 'C', name: 'R', avg_rank: 9, self_avg_rank: 2, ahead: false } } }))).toEqual([]);
		const many = Array.from({ length: 8 }, (_, i) => loc({ location_id: `L${i}`, name: `N${i}`, status: 'setup_required' }));
		expect(recommendedActions(many)).toHaveLength(5);
	});
});
