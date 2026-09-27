import { SampledCell } from '../../ranking/samples';

// Variance-test analysis (Phase 12.5), pure. For one spacing: the share of points whose samples are
// all identical, and the largest spread, per target.

export interface VariancePoint {
	keyword: string;
	point: string;
	byTarget: Record<string, SampledCell>;
}

export interface VarianceSummary {
	target: string;
	points: number;
	identical: number;
	identical_pct: number;
	max_spread: number;
	/** Points where at least one sample failed (excluded from "identical"). */
	with_errors: number;
}

export const summariseVariance = (points: VariancePoint[], targets: string[]): VarianceSummary[] =>
	targets.map((target) => {
		const cells = points.map((p) => p.byTarget[target]).filter(Boolean);
		const clean = cells.filter((c) => c.samples.every((v) => v !== null));
		const identical = clean.filter((c) => new Set(c.samples).size === 1).length;
		return {
			target,
			points: cells.length,
			identical,
			identical_pct: clean.length ? Math.round((identical / clean.length) * 1000) / 10 : 0,
			max_spread: Math.max(0, ...cells.map((c) => c.spread ?? 0)),
			with_errors: cells.length - clean.length,
		};
	});

/** Mohit's decision rule: no variance anywhere → 1 sample; else the smallest spacing that shows variance, with 3 samples. */
export const recommendSampling = (bySpacing: { spacingSec: number; summaries: VarianceSummary[] }[]): { samples: number; spacingSec: number } => {
	const varied = [...bySpacing].sort((a, b) => a.spacingSec - b.spacingSec).find((s) => s.summaries.some((t) => t.max_spread > 0));
	return varied ? { samples: 3, spacingSec: varied.spacingSec } : { samples: 1, spacingSec: 0 };
};
