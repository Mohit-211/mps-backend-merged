import { batches, appealEligible, per10, replyDraftEligibility } from '../../src/reviews/eligibility';
import { FlagInput, fingerprintOf, flagContext, levelOf, systemFlags } from '../../src/reviews/flags';

// Phase 18: deterministic review flags and AI eligibility (no AI involved).

const review = (over: Partial<FlagInput> = {}): FlagInput => ({
	rating: 5,
	comment: 'Fixed our leaking boiler on a Sunday, very tidy work and a fair price.',
	create_time: new Date('2026-09-10T10:00:00Z'),
	reviewer: { display_name: 'Ann Lee', is_anonymous: false },
	fingerprint: null,
	...over,
});
const codes = (r: FlagInput, ctx = flagContext([r])) => systemFlags(r, ctx).map((f) => f.code);

describe('systemFlags', () => {
	it('a normal review has no flags', () => {
		expect(codes(review())).toEqual([]);
		expect(levelOf([])).toBe('none');
	});

	it('links, contact details, promotions and abuse are suspicious', () => {
		expect(codes(review({ comment: 'Great! visit www.cheap-plumbers.biz for more' }))).toContain('link');
		expect(codes(review({ comment: 'Call me at 416-555-0199 instead' }))).toContain('contact_info');
		expect(codes(review({ comment: 'mail joe@example.com' }))).toContain('contact_info');
		expect(codes(review({ comment: 'Use promo code SAVE20 at my shop' }))).toContain('promotional');
		const abusive = systemFlags(review({ rating: 1, comment: 'These guys are total assholes' }), flagContext([]));
		expect(abusive.map((f) => f.code)).toContain('profanity');
		expect(levelOf(abusive)).toBe('suspicious');
	});

	it('duplicate text, repeat reviewers and low-rating bursts need the location context', () => {
		const text = 'Terrible service, they never showed up and never called back at all.';
		const fp = fingerprintOf(text);
		const a = review({ rating: 1, comment: text, fingerprint: fp, reviewer: { display_name: 'Bob K', is_anonymous: false } });
		const b = review({ rating: 1, comment: text, fingerprint: fp, reviewer: { display_name: 'Bob K', is_anonymous: false }, create_time: new Date('2026-09-10T15:00:00Z') });
		const c = review({ rating: 2, comment: 'meh', create_time: new Date('2026-09-10T20:00:00Z'), reviewer: { display_name: 'C', is_anonymous: false } });
		const ctx = flagContext([a, b, c]);
		const flags = codes(a, ctx);
		expect(flags).toEqual(expect.arrayContaining(['duplicate_text', 'repeat_reviewer', 'low_rating_burst']));
	});

	it('empty 1-2 star and a rating that contradicts the text need attention', () => {
		const empty = systemFlags(review({ rating: 1, comment: null }), flagContext([]));
		expect(empty.map((f) => f.code)).toEqual(['empty_low_rating']);
		expect(levelOf(empty)).toBe('attention');
		expect(codes(review({ rating: 5, comment: 'Worst plumber ever, avoid' }))).toContain('rating_text_mismatch');
	});

	it('short texts get no fingerprint (they repeat naturally)', () => {
		expect(fingerprintOf('Great service!')).toBeNull();
		expect(fingerprintOf('Fixed our leaking boiler on a Sunday, very tidy.')).toMatch(/^[0-9a-f]{40}$/);
		expect(fingerprintOf('FIXED our leaking boiler, on a Sunday... very tidy!')).toBe(fingerprintOf('fixed our leaking boiler on a sunday very tidy'));
	});
});

describe('eligibility', () => {
	it('AI reply drafts only for 4-5 stars, not replied, not suspicious', () => {
		expect(replyDraftEligibility({ rating: 5, reply_state: 'none', flag_level: 'none' })).toEqual({ eligible: true, reason: null });
		expect(replyDraftEligibility({ rating: 4, reply_state: 'draft', flag_level: 'attention' }).eligible).toBe(true);
		expect(replyDraftEligibility({ rating: 3, reply_state: 'none', flag_level: 'none' }).reason).toBe('rating_not_eligible');
		expect(replyDraftEligibility({ rating: 5, reply_state: 'sent', flag_level: 'none' }).reason).toBe('already_replied');
		expect(replyDraftEligibility({ rating: 5, reply_state: 'none', flag_level: 'suspicious' }).reason).toBe('flagged');
	});

	it('appeals for flagged or 1-3 star reviews; tokens per started batch of 10', () => {
		expect(appealEligible({ rating: 5, flag_level: 'none' })).toBe(false);
		expect(appealEligible({ rating: 5, flag_level: 'suspicious' })).toBe(true);
		expect(appealEligible({ rating: 2, flag_level: 'none' })).toBe(true);
		expect([0, 1, 10, 11, 20].map((n) => per10(n, 1))).toEqual([0, 1, 1, 2, 2]);
		expect(batches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
	});
});
