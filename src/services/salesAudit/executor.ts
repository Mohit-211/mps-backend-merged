import logger from '../../configs/logger';
import { PlacesApiError, PlacesClient, PlacesConfigError, placesClient } from '../../clients/placesClient';
import { NamedPlaceEntry } from '../../clients/types/places';
import { SalesAudit } from '../../models/salesAudit.model';
import { createRankingEngine } from '../../ranking/engine';
import { gridPoints } from '../../ranking/points';
import { GridPoint } from '../../ranking/types';
import {
	AUDIT,
	AuditCell,
	COMPETITOR_FIELDS,
	capCell,
	checklist,
	factsFrom,
	quickScore,
	rankedAtCenter,
	summarise,
	topOthers,
} from '../../salesAudit/compute';
import { withUsage } from '../usage/scope';

// Sales audit (Phase 19): the job body. One keyword, one sample per point, 2 pages (ranks to 30):
// - the 7×7 grid over 5 km with the IDs-only search (free SKU);
// - the named list at the business (Pro, page 2 only when the business isn't on page 1): who ranks
//   higher, and the business's own rank there (it replaces the grid's center cell so both agree);
// - Place Details for the top 3 others (their Public Score).
// Google calls are counted in the usage ledger as purpose 'sales_audit'. A deleted audit is left alone.

export interface ExecutorDeps {
	places?: Pick<PlacesClient, 'searchTextIds' | 'searchTextWithNames' | 'getPlaceDetails'>;
	now?: () => Date;
	/** Tests: no jitter between searches. */
	jitterMs?: [number, number];
}

interface StoredBusiness {
	place_id: string;
	lat: number;
	lng: number;
	region: 'us' | 'ca';
}

export const executeSalesAudit = async (auditId: string, deps: ExecutorDeps = {}): Promise<void> =>
	withUsage({ organization_id: null, location_id: null, purpose: 'sales_audit' }, async () => {
		const places = deps.places ?? placesClient;
		const now = deps.now ?? (() => new Date());
		const audit = await SalesAudit.findOneAndUpdate({ _id: auditId, status: 'queued' }, { $set: { status: 'running', started_at: now() } }, { new: true }).lean();
		if (!audit) return; // deleted, or already taken by another run
		const business = audit.business as unknown as StoredBusiness;
		const api = { ids_only: 0, pro: 0, details: audit.api_calls?.details ?? 0 };
		const warnings: string[] = [];
		const finish = (update: Record<string, unknown>) => SalesAudit.updateOne({ _id: auditId }, { $set: { ...update, api_calls: api, warnings, finished_at: now() } });

		try {
			const center = { lat: business.lat, lng: business.lng };
			const points: GridPoint[] = gridPoints(center, audit.grid.size, audit.grid.spacing_km);
			const centerIndex = points.findIndex((p) => p.row === (audit.grid.size - 1) / 2 && p.col === (audit.grid.size - 1) / 2);
			const engine = createRankingEngine({
				places,
				region: business.region,
				targets: [{ key: 'self', placeId: business.place_id }],
				samples: AUDIT.samples,
				maxPages: AUDIT.pages,
				...(deps.jitterMs ? { jitterMs: deps.jitterMs } : {}),
			});
			const ranks = await engine.rankKeywordAtPoints(audit.keyword, points);
			api.ids_only = engine.getStats().apiCalls.ids_only;
			const cells: AuditCell[] = ranks.map((r) => {
				const cell = capCell(r.byTarget.self);
				return { row: r.point.row, col: r.point.col, lat: r.point.lat, lng: r.point.lng, rank: cell.rank, status: cell.status };
			});
			if (cells.every((c) => c.status === 'error')) {
				await finish({ status: 'failed', failure_reason: 'search_failed' });
				return;
			}
			if (cells.some((c) => c.status === 'error')) warnings.push('some_points_failed');

			let named: NamedPlaceEntry[] | null = null;
			try {
				const res = await places.searchTextWithNames({
					textQuery: audit.keyword,
					regionCode: business.region,
					center: { latitude: center.lat, longitude: center.lng },
					maxPages: AUDIT.pages,
					stopWhenFound: [business.place_id],
				});
				api.pro += res.apiCalls;
				named = res.places;
			} catch (err) {
				if (!(err instanceof PlacesApiError)) throw err;
				api.pro += err.apiCalls;
				warnings.push('names_unavailable');
			}

			const atCenter = named ? rankedAtCenter(named, business.place_id) : null;
			if (atCenter && centerIndex >= 0) {
				cells[centerIndex] = { ...cells[centerIndex], rank: atCenter.self_rank, status: atCenter.self_rank === null ? 'not_found' : 'ok' };
			}

			const others = atCenter ? topOthers(atCenter.list) : [];
			const competitors = await Promise.all(
				others.map(async (o) => {
					try {
						const res = await places.getPlaceDetails(o.place_id, COMPETITOR_FIELDS);
						api.details += res.apiCalls;
						const facts = factsFrom(res.details);
						const score = quickScore(facts);
						return { rank: o.rank, name: facts.name ?? o.name, address: o.address, facts, score, checklist: checklist(facts, score) };
					} catch (err) {
						if (!(err instanceof PlacesApiError)) throw err;
						api.details += err.apiCalls;
						return { rank: o.rank, name: o.name, address: o.address, facts: null, score: null, checklist: [] };
					}
				}),
			);
			if (competitors.some((c) => c.score === null)) warnings.push('some_competitors_unavailable');

			await finish({
				status: 'done',
				result: {
					cells,
					summary: summarise(cells, centerIndex),
					higher: atCenter ? atCenter.higher.map((h) => ({ rank: h.rank, name: h.name, address: h.address, is_self: h.is_self })) : null,
					competitors,
				},
			});
		} catch (err) {
			const reason = err instanceof PlacesConfigError ? 'places_not_configured' : 'internal_error';
			logger.error(`sales audit ${auditId} failed: ${(err as Error).message}`);
			await finish({ status: 'failed', failure_reason: reason });
		}
	});
