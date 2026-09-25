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
	cells: { point: { label: string; lat: number; lng: number }; byTarget: Record<string, RankCellDoc> }[];
	summary: Record<string, TrackerSummaryDoc>;
}

export interface GridSectionDoc {
	keyword: string;
	size: number;
	spacing_km: number;
	points: { row: number; col: number; lat: number; lng: number; byTarget: Record<string, RankCellDoc> }[];
	summary: Record<string, SummaryDoc>;
}

export interface MapListResultDoc {
	rank: number;
	place_id: string;
	name: string | null;
	is_self: boolean;
	target_key: string | null;
}

export interface MapListSectionDoc {
	keyword: string;
	results: MapListResultDoc[];
}

export interface OverallDoc {
	overallAvgRank: number | null;
	change: number | null;
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
	idsOnly: CallRangeDoc;
	pro: CallRangeDoc;
	details: CallRangeDoc;
	total: CallRangeDoc;
}

export interface IRankRun extends Document {
	_id: Types.ObjectId;
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
		tracker_offset_km: number;
		radius_m: number;
		store_place_names: boolean;
	};
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

const rankCellSchema = new Schema<RankCellDoc>(
	{
		rank: { type: Number, default: null },
		status: { type: String, enum: ['ok', 'not_found', 'error'], required: true },
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
			tracker_offset_km: { type: Number, required: true },
			radius_m: { type: Number, required: true },
			store_place_names: { type: Boolean, required: true },
		},
		targets: { type: [{ _id: false, key: String, place_id: String }], default: [] },
		estimate: {
			keywords: Number,
			gridSize: Number,
			points: Number,
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
					results: [
						{
							_id: false,
							rank: Number,
							place_id: String,
							name: { type: String, default: null },
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
				{ overallAvgRank: { type: Number, default: null }, change: { type: Number, default: null } },
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
