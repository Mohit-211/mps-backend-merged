import { Types } from 'mongoose';
import config from '../configs/config';
import logger from '../configs/logger';
import {
	ConnectionRef,
	DAILY_METRICS,
	GbpAccessNotApprovedError,
	GbpClient,
	GbpNotConnectedError,
	GbpReauthRequiredError,
	createGbpClient,
	sharedGbpLimiter,
} from '../clients/gbpClient';
import {
	GBP_SYNC_TYPES,
	GbpKeywordMonthly,
	GbpMetricDaily,
	GbpProfileSnapshot,
	GbpReview,
	GbpSync,
	GbpSyncType,
	GbpTypeResult,
	IGbpProfileSnapshot,
	IGbpSync,
	Location,
	UserGBP,
	V4_SYNC_TYPES,
} from '../models';
import { connectionForBinding } from '../services/gbp/connections';
import { explainGbpError } from '../services/gbp/errors';
import { AmbiguousConnectionError } from '../services/gbp/tokenStore';
import { syncSettings } from '../services/gbp/sync.service';
import { onGbpSyncFinished } from './hooks';
import {
	mapAttributes,
	mapDailyMetrics,
	mapGoogleUpdated,
	mapKeywords,
	mapMediaSummary,
	mapPostsSummary,
	mapProfile,
	mapReview,
	mapVerification,
} from './mappers';
import { WindowSettings, dailyWindow, keywordMonths, toIsoDate, toIsoMonth } from './windows';

// gbp-sync job body (Phase 7b, CLAUDE.md §11 7.1). Fetches each data type independently: one type
// failing never stops the others, except a connection-wide failure (reconnect needed, API access not
// approved), after which no further calls are made. v4 types (reviews, media, posts) are
// not_available while GBP_V4_ENABLED is false. Everything is upserted, so re-running is harmless.

type SyncClient = Pick<
	GbpClient,
	| 'fetchDailyMetrics'
	| 'listSearchKeywords'
	| 'getLocationFull'
	| 'getAttributes'
	| 'getGoogleUpdated'
	| 'getVoiceOfMerchantState'
	| 'listReviews'
	| 'listMedia'
	| 'countCustomerMedia'
	| 'listLocalPosts'
	| 'getStats'
>;

export interface SyncExecutorDeps {
	/** Tests inject a fake; by default each sync gets its own client (own call counts, shared rate limit). */
	client?: SyncClient;
	v4Enabled?: boolean;
	settings?: WindowSettings;
	now?: () => Date;
}

export interface SyncExecutionResult {
	status: IGbpSync['status'];
	types: Record<GbpSyncType, GbpTypeResult>;
	api_calls: number;
}

/** Errors that make every further call for this connection pointless. */
const isConnectionWide = (err: unknown): boolean =>
	err instanceof GbpReauthRequiredError ||
	err instanceof GbpNotConnectedError ||
	err instanceof GbpAccessNotApprovedError ||
	err instanceof AmbiguousConnectionError;

const result = (status: GbpTypeResult['status'], message: string | null = null, rows = 0, range: GbpTypeResult['range'] = null): GbpTypeResult => ({
	status,
	message,
	rows,
	range,
});

export const executeGbpSync = async (syncId: string, deps: SyncExecutorDeps = {}): Promise<SyncExecutionResult | null> => {
	const now = deps.now ?? (() => new Date());
	const v4Enabled = deps.v4Enabled ?? config.gbp.v4Enabled;
	const settings = deps.settings ?? syncSettings();
	const client = deps.client ?? createGbpClient({ limiter: sharedGbpLimiter() });
	const callsBefore = client.getStats().calls;

	const startedAt = now();
	const sync = await GbpSync.findOneAndUpdate(
		{ _id: syncId, status: 'queued' },
		{ $set: { status: 'running', started_at: startedAt, updated_at: startedAt } },
		{ new: true },
	);
	if (!sync) {
		logger.info(`gbp-sync ${syncId}: not queued any more, skipping`);
		return null;
	}

	const types = Object.fromEntries(GBP_SYNC_TYPES.map((t) => [t, result('pending')])) as Record<GbpSyncType, GbpTypeResult>;
	const locationId = sync.location_id as Types.ObjectId;
	const finish = async (status: IGbpSync['status'], failureReason: string | null) => {
		const finishedAt = now();
		const stats = client.getStats();
		const calls = stats.calls - callsBefore;
		await GbpSync.updateOne(
			{ _id: sync._id },
			{
				$set: {
					status,
					active: false,
					finished_at: finishedAt,
					duration_ms: finishedAt.getTime() - startedAt.getTime(),
					types,
					api_calls: { total: calls, by_endpoint: stats.byEndpoint },
					failure_reason: failureReason,
					updated_at: finishedAt,
				},
			},
		);
		logger.info(`gbp-sync ${syncId}: ${status} calls=${calls} ${GBP_SYNC_TYPES.map((t) => `${t}=${types[t].status}`).join(' ')}`);
		return { status, types, api_calls: calls };
	};

	try {
		const binding = await UserGBP.findOne({ location_id: locationId, is_active: true }).lean();
		if (!binding) {
			for (const t of GBP_SYNC_TYPES) types[t] = result('skipped', 'GBP binding removed');
			return await finish('failed', 'This location is no longer connected to a Google Business Profile.');
		}
		const conn: ConnectionRef = connectionForBinding(binding);
		const locationName = binding.gbpLocationId;
		const accountName = binding.gbpAccountId;
		const backfill = sync.backfill;
		let abort: string | null = null;

		/** Runs one type; a connection-wide error stops every later call. */
		const run = async (type: GbpSyncType, fn: () => Promise<Omit<GbpTypeResult, 'status' | 'message'>>) => {
			if (abort) {
				types[type] = result('error', abort);
				return;
			}
			try {
				const out = await fn();
				types[type] = result('ok', null, out.rows, out.range);
			} catch (err) {
				const message = explainGbpError(err);
				types[type] = result('error', message);
				if (isConnectionWide(err)) abort = message;
				logger.warn(`gbp-sync ${syncId}: ${type} failed: ${message}`);
			}
		};

		const snapshot: Partial<IGbpProfileSnapshot> = {};

		await run('performance', async () => {
			const range = dailyWindow(now(), backfill, settings);
			const rows = mapDailyMetrics(await client.fetchDailyMetrics(conn, locationName, DAILY_METRICS, range));
			if (rows.length > 0) {
				await GbpMetricDaily.bulkWrite(
					rows.map((r) => ({
						updateOne: {
							filter: { location_id: locationId, date: r.date, metric: r.metric },
							update: { $set: { value: r.value } },
							upsert: true,
						},
					})),
					{ ordered: false },
				);
			}
			return { rows: rows.length, range: { from: toIsoDate(range.start), to: toIsoDate(range.end) } };
		});

		await run('keywords', async () => {
			const months = keywordMonths(now(), backfill, settings);
			let rows = 0;
			for (const month of months) {
				const list = await client.listSearchKeywords(conn, locationName, month);
				const mapped = mapKeywords(list.items);
				const key = toIsoMonth(month);
				if (mapped.length > 0) {
					await GbpKeywordMonthly.bulkWrite(
						mapped.map((k) => ({
							updateOne: {
								filter: { location_id: locationId, month: key, keyword: k.keyword },
								update: { $set: { value: k.value, threshold: k.threshold } },
								upsert: true,
							},
						})),
						{ ordered: false },
					);
				}
				rows += mapped.length;
			}
			return { rows, range: months.length ? { from: toIsoMonth(months[0]), to: toIsoMonth(months[months.length - 1]) } : null };
		});

		await run('profile', async () => {
			const raw = await client.getLocationFull(conn, locationName);
			snapshot.profile = mapProfile(raw);
			snapshot.raw_location = raw;
			snapshot.attributes = mapAttributes(await client.getAttributes(conn, locationName));
			snapshot.pending_google_edits = mapGoogleUpdated(await client.getGoogleUpdated(conn, locationName));
			return { rows: 1, range: null };
		});

		await run('verification', async () => {
			snapshot.verification = mapVerification(await client.getVoiceOfMerchantState(conn, locationName));
			return { rows: 1, range: null };
		});

		if (!v4Enabled) {
			for (const t of V4_SYNC_TYPES) types[t] = result('not_available', 'v4_access_pending');
		} else {
			await run('reviews', async () => {
				const list = await client.listReviews(conn, accountName, locationName);
				const at = now();
				const docs = list.items.map((r) => mapReview(r, locationId, at)).filter((d): d is NonNullable<typeof d> => d !== null);
				if (docs.length > 0) {
					await GbpReview.bulkWrite(
						docs.map((d) => ({ updateOne: { filter: { review_name: d.review_name }, update: { $set: d }, upsert: true } })),
						{ ordered: false },
					);
				}
				snapshot.reviews_summary = { average_rating: list.averageRating, total: list.totalReviewCount };
				return { rows: docs.length, range: null };
			});
			await run('media', async () => {
				const owner = await client.listMedia(conn, accountName, locationName);
				const customers = await client.countCustomerMedia(conn, accountName, locationName);
				snapshot.media = mapMediaSummary(owner.items, owner.total, customers);
				return { rows: owner.items.length, range: null };
			});
			await run('posts', async () => {
				const posts = await client.listLocalPosts(conn, accountName, locationName);
				snapshot.posts = mapPostsSummary(posts.items, now());
				return { rows: posts.items.length, range: null };
			});
		}

		// One dated snapshot per sync (history kept); the newest is flagged is_latest.
		if (Object.keys(snapshot).length > 0) {
			await GbpProfileSnapshot.updateMany({ location_id: locationId, is_latest: true }, { $set: { is_latest: false } });
			await GbpProfileSnapshot.create({
				location_id: locationId,
				sync_id: sync._id,
				taken_at: now(),
				is_latest: true,
				profile: snapshot.profile ?? null,
				raw_location: snapshot.raw_location ?? null,
				attributes: snapshot.attributes ?? null,
				pending_google_edits: snapshot.pending_google_edits ?? null,
				verification: snapshot.verification ?? null,
				media: snapshot.media ?? null,
				posts: snapshot.posts ?? null,
				reviews_summary: snapshot.reviews_summary ?? null,
			});
		}

		const statuses = GBP_SYNC_TYPES.map((t) => types[t].status);
		const ok = statuses.filter((s) => s === 'ok').length;
		const errors = statuses.filter((s) => s === 'error').length;
		const status: IGbpSync['status'] = ok === 0 ? 'failed' : errors > 0 ? 'partial' : 'done';

		const set: Record<string, unknown> = {
			'gbp_sync.last_status': status,
			'gbp_sync.last_sync_id': String(sync._id),
		};
		if (status !== 'failed') set['gbp_sync.last_synced_at'] = now();
		// The backfill counts as done once the performance history is stored; later syncs use rolling windows.
		if (backfill && types.performance.status === 'ok') set['gbp_sync.backfilled_at'] = now();
		await Location.updateOne({ _id: locationId }, { $set: set });

		const outcome = await finish(status, status === 'failed' ? (abort ?? 'No data type could be synced.') : null);
		await onGbpSyncFinished(String(sync._id), status);
		return outcome;
	} catch (err) {
		const message = err instanceof Error ? err.message : 'unknown error';
		logger.error(`gbp-sync ${syncId}: failed: ${message}`);
		await Location.updateOne({ _id: locationId }, { $set: { 'gbp_sync.last_status': 'failed', 'gbp_sync.last_sync_id': String(sync._id) } });
		return finish('failed', message);
	}
};
