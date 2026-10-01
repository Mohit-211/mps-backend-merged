import crypto from 'crypto';

// Deterministic review flags (Phase 18). Cheap system rules run on every new or changed review, with no
// AI. Wording for users: "Suspicious indicators", never "fake". Pure.
// - suspicious: a likely Google policy issue (links, contact details, ads, copied text, abuse, a burst of
//   low ratings): worth a closer look and maybe a report.
// - attention: a human should look (a 1-2 star review without text, a rating that contradicts the text, the
//   same reviewer posting several times).

export type FlagLevel = 'none' | 'attention' | 'suspicious';

export const FLAG_CODES = {
	link: { level: 'suspicious', label: 'Contains a link' },
	contact_info: { level: 'suspicious', label: 'Contains an email address or phone number' },
	promotional: { level: 'suspicious', label: 'Promotional or advertising language' },
	duplicate_text: { level: 'suspicious', label: 'Same text as another review of this business' },
	profanity: { level: 'suspicious', label: 'Offensive or abusive language' },
	low_rating_burst: { level: 'suspicious', label: 'Part of a burst of 1-2 star reviews within 24 hours' },
	repeat_reviewer: { level: 'attention', label: 'Same reviewer name on several reviews' },
	empty_low_rating: { level: 'attention', label: '1-2 stars without any text' },
	rating_text_mismatch: { level: 'attention', label: 'The rating and the text seem to disagree' },
	ai_suspicious: { level: 'suspicious', label: 'AI analysis found suspicious indicators' },
	ai_serious: { level: 'attention', label: 'AI analysis: serious complaint' },
} as const satisfies Record<string, { level: Exclude<FlagLevel, 'none'>; label: string }>;

export type FlagCode = keyof typeof FLAG_CODES;

export interface ReviewFlag {
	code: FlagCode;
	source: 'system' | 'ai';
	detail: string | null;
}

/** Short texts ("Great service!") repeat naturally, so they get no fingerprint. */
const MIN_FINGERPRINT_CHARS = 25;

export const normaliseText = (text: string): string => text.toLowerCase().replace(/[^a-z0-9À-ɏ]+/g, ' ').replace(/\s+/g, ' ').trim();

export const fingerprintOf = (text: string | null | undefined): string | null => {
	if (!text) return null;
	const n = normaliseText(text);
	return n.length < MIN_FINGERPRINT_CHARS ? null : crypto.createHash('sha1').update(n).digest('hex');
};

const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|ca|us|io|co|biz|info|xyz|ly)\b)/i;
const EMAIL = /\b[^\s@]+@[^\s@]+\.[a-z]{2,}\b/i;
const PHONE = /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;
const PROMO = /\b(discount code|promo code|coupon|use code|visit my|check out my|dm me|whatsapp|telegram|crypto|bitcoin|earn \$|make money|click here|follow me)\b/i;
/** A small, conservative list: clear slurs and strong abuse only (false positives cost trust). */
const PROFANITY = /\b(fuck\w*|shit\w*|bitch\w*|bastard\w*|asshole\w*|cunt\w*|dickhead\w*|motherfuck\w*|retard\w*|scumbag\w*)\b/i;
const NEGATIVE = /\b(worst|terrible|horrible|awful|scam|rude|never again|do not recommend|don't recommend|disgusting|ripped off|waste of money|avoid)\b/i;
const POSITIVE = /\b(excellent|amazing|great|fantastic|wonderful|highly recommend|best|outstanding|perfect|awesome)\b/i;

export interface FlagContext {
	/** How many reviews of this location share each fingerprint. */
	fingerprintCounts: Map<string, number>;
	/** How many reviews of this location each reviewer display name has (anonymous excluded). */
	reviewerCounts: Map<string, number>;
	/** Create times of this location's 1-2 star reviews. */
	lowRatingTimes: Date[];
}

export interface FlagInput {
	rating: number | null;
	comment: string | null;
	create_time: Date | null;
	reviewer: { display_name: string | null; is_anonymous: boolean };
	fingerprint: string | null;
}

const DAY_MS = 86_400_000;
const BURST_SIZE = 3;

export const systemFlags = (r: FlagInput, ctx: FlagContext): ReviewFlag[] => {
	const flags: ReviewFlag[] = [];
	const add = (code: FlagCode, detail: string | null = null) => flags.push({ code, source: 'system', detail });
	const text = r.comment ?? '';
	if (LINK.test(text)) add('link');
	if (EMAIL.test(text) || PHONE.test(text)) add('contact_info');
	if (PROMO.test(text)) add('promotional');
	if (PROFANITY.test(text)) add('profanity');
	if (r.fingerprint && (ctx.fingerprintCounts.get(r.fingerprint) ?? 0) > 1) add('duplicate_text', `${ctx.fingerprintCounts.get(r.fingerprint)} reviews share this text`);
	const name = r.reviewer.is_anonymous ? null : r.reviewer.display_name?.trim().toLowerCase();
	if (name && (ctx.reviewerCounts.get(name) ?? 0) > 1) add('repeat_reviewer', `${ctx.reviewerCounts.get(name)} reviews from this name`);
	const low = r.rating !== null && r.rating <= 2;
	if (low && !text.trim()) add('empty_low_rating');
	if (low && r.create_time) {
		const t = r.create_time.getTime();
		const near = ctx.lowRatingTimes.filter((d) => Math.abs(d.getTime() - t) <= DAY_MS).length;
		if (near >= BURST_SIZE) add('low_rating_burst', `${near} low ratings within 24 hours`);
	}
	if (text && r.rating !== null && ((r.rating >= 5 && NEGATIVE.test(text) && !POSITIVE.test(text)) || (r.rating <= 1 && POSITIVE.test(text) && !NEGATIVE.test(text)))) {
		add('rating_text_mismatch');
	}
	return flags;
};

/** The strongest level among the flags. */
export const levelOf = (flags: Pick<ReviewFlag, 'code'>[]): FlagLevel => {
	let level: FlagLevel = 'none';
	for (const f of flags) {
		const l = FLAG_CODES[f.code]?.level;
		if (l === 'suspicious') return 'suspicious';
		if (l === 'attention') level = 'attention';
	}
	return level;
};

/** The context for flagging one location's reviews. */
export const flagContext = (reviews: Pick<FlagInput, 'rating' | 'create_time' | 'reviewer' | 'fingerprint'>[]): FlagContext => {
	const fingerprintCounts = new Map<string, number>();
	const reviewerCounts = new Map<string, number>();
	const lowRatingTimes: Date[] = [];
	for (const r of reviews) {
		if (r.fingerprint) fingerprintCounts.set(r.fingerprint, (fingerprintCounts.get(r.fingerprint) ?? 0) + 1);
		const name = r.reviewer?.is_anonymous ? null : r.reviewer?.display_name?.trim().toLowerCase();
		if (name) reviewerCounts.set(name, (reviewerCounts.get(name) ?? 0) + 1);
		if (r.rating !== null && r.rating <= 2 && r.create_time) lowRatingTimes.push(r.create_time);
	}
	return { fingerprintCounts, reviewerCounts, lowRatingTimes };
};
