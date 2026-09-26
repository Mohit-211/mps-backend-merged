// Search keywords section of the GBP report (Phase 7c), pure. Google gives either an exact
// monthly impression count or only a threshold ("fewer than N"); thresholds stay thresholds.

const TOP_LIMIT = 50;

export interface KeywordRow {
	month: string;
	keyword: string;
	value: number | null;
	threshold: number | null;
}

export interface TopKeyword {
	keyword: string;
	value: number | null;
	threshold: number | null;
	/** Previous month's exact value; null when either month has only a threshold. */
	previous_value: number | null;
	/** value - previous_value, only when both are exact. */
	change: number | null;
	tracked: boolean;
}

export interface KeywordsSection {
	available: true;
	months: string[];
	latest_month: string;
	top: TopKeyword[];
	/** Top keywords that aren't in the location's tracked keywords (ideas for rank tracking). */
	not_tracked: string[];
}

export const normaliseKeyword = (text: string): string => text.trim().toLowerCase().replace(/\s+/g, ' ');

const rank = (k: { value: number | null; threshold: number | null }): number => (k.value !== null ? 1e12 + k.value : k.threshold ?? 0);

export const keywordsSection = (rows: KeywordRow[], trackedKeywords: string[]): KeywordsSection | null => {
	if (rows.length === 0) return null;
	const months = [...new Set(rows.map((r) => r.month))].sort();
	const latest = months[months.length - 1];
	const previousMonth = months.length > 1 ? months[months.length - 2] : null;
	const previous = new Map(rows.filter((r) => r.month === previousMonth).map((r) => [normaliseKeyword(r.keyword), r]));
	const tracked = new Set(trackedKeywords.map(normaliseKeyword));
	const top = rows
		.filter((r) => r.month === latest)
		.sort((a, b) => rank(b) - rank(a) || a.keyword.localeCompare(b.keyword))
		.slice(0, TOP_LIMIT)
		.map((r): TopKeyword => {
			const prev = previous.get(normaliseKeyword(r.keyword));
			const previousValue = prev?.value ?? null;
			return {
				keyword: r.keyword,
				value: r.value,
				threshold: r.value === null ? r.threshold : null,
				previous_value: previousValue,
				change: r.value !== null && previousValue !== null ? r.value - previousValue : null,
				tracked: tracked.has(normaliseKeyword(r.keyword)),
			};
		});
	return {
		available: true,
		months,
		latest_month: latest,
		top,
		not_tracked: top.filter((k) => !k.tracked).map((k) => k.keyword),
	};
};
