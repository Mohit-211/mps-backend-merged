import mongoose, { Document, Model, Schema, Types } from 'mongoose';
import { addTimestamps, toJSON } from '../configs/mongoPlugins';

// One ranking run for one location (CLAUDE.md §9.2). Powers Rank Tracker, Local Search Grid and
// Local Map Ranking. History is kept: runs are never deleted by the application.

export type RankRunStatus = 'queued' | 'running' | 'done' | 'partial' | 'failed';
export type RankRunTrigger = 'manual' | 'scheduled';
export type CellStatus = 'ok' | 'not_found' | 'error';
export type ChangeLabelValue = 'improved' | 'declined' | 'unchanged' | 'entered_top_60' | 'dropped_out_of_top_60';

export interface RankCellDoc {
	rank: number | null;
	status: CellStatus;
	/** Phase 12.5: every sample's value (1–60, 61 = not found, null = failed) and their spread. Absent on older runs. */
	samples?: (number | null)[];
	spread?: number | null;
}

export interface SummaryDoc {
	avgRank: number | null;
	foundRate: number | null;
	top3Rate: number | null;
}

export interface TrackerSummaryDoc extends SummaryDoc {
	change: number | null;
	changeLabel: ChangeLabelValue | null;
}

export interface TrackerSectionDoc {
	keyword: string;
	cells: { point: { label: string; lat: number; lng: number }; byTarget: Record<string, RankCellDoc>; top3?: string[]; result_count?: number | null; more_results?: boolean }[];
	summary: Record<string, TrackerSummaryDoc>;
}

export interface GridSectionDoc {
	keyword: string;
	size: number;
	spacing_km: number;
	points: { row: number; col: number; lat: number; lng: number; byTarget: Record<string, RankCellDoc>; top3?: string[]; result_count?: number | null; more_results?: boolean }[];
	summary: Record<string, SummaryDoc>;
}

export interface MapListResultDoc {
	rank: number;
	place_id: string;
	name: string | null;
	/** Phase 17 map pins (absent on older runs). */
	address?: string | null;
	lat?: number | null;
	lng?: number | null;
	is_self: boolean;
	target_key: string | null;
}

export interface MapListSectionDoc {
	keyword: string;
	/** Phase 12.5: the tracker point ('C' | 'N' | 'S' | 'E' | 'W'); absent on older runs = center. */
	point?: string;
	results: MapListResultDoc[];
}

export interface OverallDoc {
	overallAvgRank: number | null;
	/** Phase 17: over the keywords both runs measured (absent on older runs). */
	change: number | null;
	comparable_keywords?: number;
	keywords_total?: number;
}

export interface RunErrorDoc {
	keyword: string | null;
	section: 'tracker' | 'grid' | 'map' | 'center' | 'run';
	point: { lat: number; lng: number } | null;
	message: string;
}

export interface CallRangeDoc {
	min: number;
	max: number;
	maxWithRetries: number;
}

export interface RankRunEstimateDoc {
	keywords: number;
	gridSize: number;
	points: number;
	samples: number;
	mapPoints: number;
	idsOnly: CallRangeDoc;
	pro: CallRangeDoc;
	details: CallRangeDoc;
	total: CallRangeDoc;
}

/** Plain RankRun fields (what .lean() returns, plus _id). */
export interface RankRunData {
	location_id: Types.ObjectId;
	created_by: Types.ObjectId;
	trigger: RankRunTrigger;
	status: RankRunStatus;
	active: boolean;
	run_at: Date;
	started_at: Date | null;
	finished_at: Date | null;
	duration_ms: number | null;
	failure_reason: string | null;
	keywords_version: number;
	keywords: string[];
	region: 'us' | 'ca';
	center: { lat: number; lng: number } | null;
	center_source: 'location' | 'place_details' | null;
	config: {
		grid_size: number;
		spacing_km: number;
		/** Phase 17: center to edge (absent on older runs: derived from size and spacing). */
		radius_km?: number;
		tracker_offset_km: number;
		radius_m: number;
		store_place_names: boolean;
		/** Phase 12.5 (absent on older runs = 1 sample, no spacing, center-only map list). */
		samples?: number;
		sample_spacing_sec?: number;
		map_points?: number;
	};
	/** Phase 12.5: expected duration from the estimate (the stuck guard allows twice this plus 10 minutes). */
	expected_duration_ms?: number | null;
	targets: { key: string; place_id: string }[];
	estimate: RankRunEstimateDoc;
	dev_capped: boolean;
	tracker: TrackerSectionDoc[];
	grid: GridSectionDoc[];
	mapList: MapListSectionDoc[];
	overall: Record<string, OverallDoc>;
	api_calls: { ids_only: number; pro: number; details: number };
	/** Named run_errors because `errors` is reserved on Mongoose documents (CLAUDE.md §9 calls it errors). */
	run_errors: RunErrorDoc[];
	created_at: Date;
	updated_at: Date;
}

export interface IRankRun extends Document, RankRunData {
	_id: Types.ObjectId;
}

export type LeanRankRun = RankRunData & { _id: Types.ObjectId };

const rankCellSchema = new Schema<RankCellDoc>(
	{
		rank: { type: Number, default: null },
		status: { type: String, enum: ['ok', 'not_found', 'error'], required: true },
		samples: { type: [Number], default: undefined },
		spread: { type: Number, default: undefined },
	},
	{ _id: false },
);

const summaryFields = {
	avgRank: { type: Number, default: null },
	foundRate: { type: Number, default: null },
	top3Rate: { type: Number, default: null },
};

const summarySchema = new Schema<SummaryDoc>(summaryFields, { _id: false });

const trackerSummarySchema = new Schema<TrackerSummaryDoc>(
	{
		...summaryFields,
		change: { type: Number, default: null },
		changeLabel: {
			type: String,
			enum: ['improved', 'declined', 'unchanged', 'entered_top_60', 'dropped_out_of_top_60', null],
			default: null,
		},
	},
	{ _id: false },
);

const callRangeSchema = { min: Number, max: Number, maxWithRetries: Number };

const rankRunSchema = new Schema<IRankRun>(
	{
		location_id: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
		created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
		trigger: { type: String, enum: ['manual', 'scheduled'], required: true },
		status: { type: String, enum: ['queued', 'running', 'done', 'partial', 'failed'], default: 'queued' },
		active: { type: Boolean, default: true },
		run_at: { type: Date, required: true },
		started_at: { type: Date, default: null },
		finished_at: { type: Date, default: null },
		duration_ms: { type: Number, default: null },
		failure_reason: { type: String, default: null },
		keywords_version: { type: Number, required: true },
		keywords: { type: [String], default: [] },
		region: { type: String, enum: ['us', 'ca'], required: true },
		center: { type: new Schema({ lat: Number, lng: Number }, { _id: false }), default: null },
		center_source: { type: String, enum: ['location', 'place_details', null], default: null },
		config: {
			grid_size: { type: Number, required: true },
			spacing_km: { type: Number, required: true },
			radius_km: { type: Number },
			tracker_offset_km: { type: Number, required: true },
			radius_m: { type: Number, required: true },
			store_place_names: { type: Boolean, required: true },
			samples: { type: Number, default: 1 },
			sample_spacing_sec: { type: Number, default: 0 },
			map_points: { type: Number, default: 1 },
		},
		expected_duration_ms: { type: Number, default: null },
		targets: { type: [{ _id: false, key: String, place_id: String }], default: [] },
		estimate: {
			keywords: Number,
			gridSize: Number,
			points: Number,
			samples: Number,
			mapPoints: Number,
			idsOnly: callRangeSchema,
			pro: callRangeSchema,
			details: callRangeSchema,
			total: callRangeSchema,
		},
		dev_capped: { type: Boolean, default: false },
		tracker: {
			type: [
				{
					_id: false,
					keyword: String,
					cells: [
						{
							_id: false,
							point: { label: String, lat: Number, lng: Number },
							byTarget: { type: Map, of: rankCellSchema },
							// First 3 place IDs at this point (calibration against Google Maps).
							top3: { type: [String], default: [] },
							result_count: { type: Number, default: null },
							more_results: { type: Boolean, default: false },
						},
					],
					summary: { type: Map, of: trackerSummarySchema },
				},
			],
			default: [],
		},
		grid: {
			type: [
				{
					_id: false,
					keyword: String,
					size: Number,
					spacing_km: Number,
					points: [
						{
							_id: false,
							row: Number,
							col: Number,
							lat: Number,
							lng: Number,
							byTarget: { type: Map, of: rankCellSchema },
							// First 3 place IDs at this point (calibration against Google Maps).
							top3: { type: [String], default: [] },
							result_count: { type: Number, default: null },
							more_results: { type: Boolean, default: false },
						},
					],
					summary: { type: Map, of: summarySchema },
				},
			],
			default: [],
		},
		mapList: {
			type: [
				{
					_id: false,
					keyword: String,
					point: { type: String, default: 'C' },
					results: [
						{
							_id: false,
							rank: Number,
							place_id: String,
							name: { type: String, default: null },
							address: { type: String, default: null },
							lat: { type: Number, default: null },
							lng: { type: Number, default: null },
							is_self: Boolean,
							target_key: { type: String, default: null },
						},
					],
				},
			],
			default: [],
		},
		overall: {
			type: Map,
			of: new Schema<OverallDoc>(
				{ overallAvgRank: { type: Number, default: null }, change: { type: Number, default: null }, comparable_keywords: Number, keywords_total: Number },
				{ _id: false },
			),
			default: {},
		},
		api_calls: {
			ids_only: { type: Number, default: 0 },
			pro: { type: Number, default: 0 },
			details: { type: Number, default: 0 },
		},
		run_errors: {
			type: [
				{
					_id: false,
					keyword: { type: String, default: null },
					section: { type: String, enum: ['tracker', 'grid', 'map', 'center', 'run'] },
					point: { type: new Schema({ lat: Number, lng: Number }, { _id: false }), default: null },
					message: String,
				},
			],
			default: [],
		},
	},
	{ collection: 'rank_runs' },
);

rankRunSchema.plugin(toJSON);
rankRunSchema.plugin(addTimestamps);

// History per location, newest first.
rankRunSchema.index({ location_id: 1, run_at: -1 });
// Stuck-run guard.
rankRunSchema.index({ status: 1, started_at: 1 });
// At most ONE queued/running run per location, enforced by the database (no race on "run now").
rankRunSchema.index(
	{ location_id: 1 },
	{ unique: true, partialFilterExpression: { active: true }, name: 'one_active_run_per_location' },
);

export const RankRun: Model<IRankRun> = mongoose.model<IRankRun>('RankRun', rankRunSchema);
