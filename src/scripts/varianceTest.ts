/*
 * Phase 12.5 LIVE variance test (Mohit triggers it). Repeats identical IDs-only searches (full depth)
 * at the 5 tracker points of one location and measures how much the rank moves between samples, at
 * three spacings. Budget: at most 300 IDs-only calls (free SKU), 0 Pro. Refuses without --confirm-live.
 *
 *   npm run variance:test -- --confirm-live
 *   npm run variance:test -- --confirm-live --spacings=600     (rerun only the 10-minute spacing: 90 calls)
 *   Options: --location=<id> (default MyPageSEO Fredericton) --keywords="a|b" --spacings=0,60,600 --samples=3
 *
 * Writes docs/calibration/variance-<date>.md (variance-<date>-s<spacings>.md for other spacings) after
 * EACH spacing, and on Ctrl-C, so an interrupted run keeps what finished; usage is flushed the same way.
 */
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import config from '../configs/config';
import { PlacesClient, placesClient } from '../clients/placesClient';
import { Location } from '../models';
import { DEFAULT_TRACKER_OFFSET_KM, createRankingEngine, regionFromCountry, trackerPoints } from '../ranking';
import { withDefaults } from '../services/ranking/trackingSettings';
import { VariancePoint, VarianceSummary, recommendSampling, summariseVariance } from '../services/ranking/variance';
import { withLocationUsage } from '../services/usage/jobScope';
import { flushUsage } from '../services/usage/scope';

const BUDGET = 300;
const DEFAULT_LOCATION = '6ab76e2c99cf66c2cc414a18';
const DEFAULT_KEYWORDS = ['marketing agency', 'digital marketing agency fredericton'];

const arg = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const out = (line = ''): void => {
	process.stdout.write(`${line}\n`);
};

/** Wraps the client so the run stops before it could exceed the budget (a search may need 3 pages). */
const budgeted = (inner: PlacesClient, budget: number) => {
	let used = 0;
	const client: Pick<PlacesClient, 'searchTextIds'> = {
		searchTextIds: async (params) => {
			if (used + 3 > budget) throw new Error(`call budget reached (${used} of ${budget}); stopping`);
			try {
				const r = await inner.searchTextIds(params);
				used += r.apiCalls;
				return r;
			} catch (err) {
				used += (err as { apiCalls?: number }).apiCalls ?? 1;
				throw err;
			}
		},
	};
	return { client, used: () => used };
};

const main = async (): Promise<number> => {
	if (!process.argv.includes('--confirm-live')) {
		process.stderr.write('This makes REAL Places API calls (IDs-only, free SKU, max 300). Re-run with --confirm-live when Mohit says so.\n');
		return 2;
	}
	const locationId = arg('location') ?? DEFAULT_LOCATION;
	const keywords = arg('keywords')?.split('|').map((k) => k.trim()).filter(Boolean) ?? DEFAULT_KEYWORDS;
	const spacings = (arg('spacings') ?? '0,60,600').split(',').map(Number);
	const samples = Number(arg('samples') ?? 3);
	const pointsPerKeyword = 5;
	const worst = keywords.length * pointsPerKeyword * samples * 3 * spacings.length;
	out(`Plan: ${keywords.length} keywords × ${pointsPerKeyword} tracker points × ${samples} samples × up to 3 pages × ${spacings.length} spacings = up to ${worst} IDs-only calls (budget ${BUDGET}), 0 Pro.`);
	if (worst > BUDGET) {
		process.stderr.write(`Worst case ${worst} exceeds the ${BUDGET}-call budget; reduce keywords, samples or spacings.\n`);
		return 2;
	}
	await mongoose.connect(config.databases.mongodb.url, {
		user: config.databases.mongodb.user,
		pass: config.databases.mongodb.password,
		authSource: config.databases.mongodb.authSource,
		serverSelectionTimeoutMS: 10000,
	});
	try {
		const location = await Location.findById(locationId).lean();
		if (!location || !location.place_id || !Number.isFinite(location.lat) || !Number.isFinite(location.lng)) {
			process.stderr.write('Location not found, or it has no place_id / center.\n');
			return 2;
		}
		const tracking = withDefaults(location.tracking);
		const targets = [{ key: 'self' as const, placeId: location.place_id }, ...tracking.competitors.map((p, i) => ({ key: `competitor_${i + 1}` as `competitor_${number}`, placeId: p }))];
		const points = trackerPoints({ lat: location.lat as number, lng: location.lng as number }, DEFAULT_TRACKER_OFFSET_KM);
		const budget = budgeted(placesClient, BUDGET);
		const results: { spacingSec: number; summaries: VarianceSummary[]; points: VariancePoint[]; calls: number }[] = [];
		const date = new Date().toISOString().slice(0, 10);
		const suffix = spacings.join(',') === '0,60,600' ? '' : `-s${spacings.join('_')}`;
		const file = path.resolve(process.cwd(), 'docs/calibration', `variance-${date}${suffix}.md`);
		const writeReport = (state: 'complete' | 'partial' | 'interrupted') => {
			const rec = recommendSampling(results);
			const done = new Set(results.map((r) => r.spacingSec));
			const lines = [
				`# Variance test ${date} (Phase 12.5)${state === 'complete' ? '' : ` — ${state}`}`,
				'',
				`Location \`${locationId}\` (${location.name}), keywords: ${keywords.map((k) => `"${k}"`).join(', ')}; ${samples} samples at the 5 tracker points; full depth IDs-only.`,
				`Calls: **${budget.used()}** IDs-only (budget ${BUDGET}), 0 Pro.`,
				'',
				'| Spacing | Target | Points | Identical | Max spread | Points with a failed sample | Calls |',
				'|---|---|---|---|---|---|---|',
				...results.flatMap((r) => r.summaries.map((x) => `| ${r.spacingSec} s | ${x.target} | ${x.points} | ${x.identical_pct} % | ${x.max_spread} | ${x.with_errors} | ${r.calls} |`)),
				...spacings.filter((sp) => !done.has(sp)).map((sp) => `| ${sp} s | – | – | not completed | – | – | – |`),
				'',
				'Per point (self; 61 = not in the top 60):',
				'',
				...results.flatMap((r) => r.points.map((p) => `- ${r.spacingSec} s · ${p.keyword} · ${p.point}: ${JSON.stringify(p.byTarget.self?.samples ?? [])} → ${p.byTarget.self?.rank ?? p.byTarget.self?.status}`)),
				'',
				`**Rule (Mohit):** no variance at any spacing → 1 sample; otherwise the smallest spacing showing variance, with 3 samples. **Result so far:** RANK_SAMPLES_PER_POINT=${rec.samples}, RANK_SAMPLE_SPACING_SEC=${rec.spacingSec} (to be confirmed by Mohit).`,
			];
			fs.writeFileSync(file, `${lines.join('\n')}\n`);
		};
		process.once('SIGINT', () => {
			writeReport('interrupted');
			out(`Interrupted: ${budget.used()} IDs-only calls so far; partial results written to ${path.relative(process.cwd(), file)}.`);
			flushUsage()
				.catch(() => undefined)
				.finally(() => mongoose.disconnect().finally(() => process.exit(130)));
		});
		await withLocationUsage(locationId, async () => {
			for (const spacingSec of spacings) {
				const before = budget.used();
				const started = Date.now();
				const engine = createRankingEngine({
					places: budget.client,
					region: regionFromCountry(location.country),
					targets,
					samples,
					sampleSpacingMs: spacingSec * 1000,
					concurrency: 2,
				});
				const vp: VariancePoint[] = [];
				for (const keyword of keywords) {
					for (const r of await engine.rankKeywordAtPoints(keyword, points)) vp.push({ keyword, point: r.point.label, byTarget: r.byTarget });
				}
				const summaries = summariseVariance(vp, targets.map((t) => t.key));
				results.push({ spacingSec, summaries, points: vp, calls: budget.used() - before });
				await flushUsage();
				writeReport(results.length === spacings.length ? 'complete' : 'partial');
				out(`spacing ${spacingSec}s: ${budget.used() - before} calls, ${Math.round((Date.now() - started) / 1000)}s; self identical ${summaries[0].identical_pct}% max spread ${summaries[0].max_spread}`);
			}
		});
		const rec = recommendSampling(results);
		out(`Total ${budget.used()} IDs-only calls. Recommendation: samples=${rec.samples}, spacing=${rec.spacingSec}s. Written to ${path.relative(process.cwd(), file)}.`);
		return 0;
	} finally {
		await mongoose.disconnect();
	}
};

main()
	.then((code) => process.exit(code))
	.catch(async (err: Error) => {
		process.stderr.write(`variance:test failed: ${err.message}\n`);
		await mongoose.disconnect().catch(() => undefined);
		process.exit(1);
	});
