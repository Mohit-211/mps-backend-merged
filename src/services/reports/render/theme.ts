import type { RankBucket } from '../../../ranking/types';
import type { Tone } from '../types';

// Colours shared by the PDF and HTML renderers (Phase 12).

export const TEXT = '#111827';
export const MUTED = '#6b7280';

export const TONE_COLORS: Record<Tone, string> = { good: '#15803d', bad: '#b91c1c', neutral: MUTED };

export const BUCKET_COLORS: Record<RankBucket, string> = {
	pack: '#16a34a',
	visible: '#65a30d',
	low: '#d97706',
	invisible: '#dc2626',
	not_found: '#7f1d1d',
	error: '#9ca3af',
};

export const BUCKET_LABELS: Record<RankBucket, string> = {
	pack: '1–3',
	visible: '4–10',
	low: '11–20',
	invisible: '21–60',
	not_found: '60+',
	error: 'Search failed',
};

/** The legend for a heatmap measured to maxRank (Phase 19's sales audit: 30). */
export const bucketLabels = (maxRank = 60): Record<RankBucket, string> =>
	maxRank === 60 ? BUCKET_LABELS : { ...BUCKET_LABELS, invisible: `21–${maxRank}`, not_found: `${maxRank}+` };
