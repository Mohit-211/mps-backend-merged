import mongoose, { Schema, Model, Document } from "mongoose";
import {
  addTimestamps,
  globalQueryFilters,
  toJSON,
} from "../configs/mongoPlugins";
import httpStatus from "http-status";
import { ApiError } from "../utils";

/**
 * Refresh cadence (Mohit, 2026-09-26): 'auto_monthly' (default) = the monthly-refresh scheduler runs
 * this location; 'manual_only' = only POST /locations/:id/refresh.
 */
export type TrackingFrequency = 'auto_monthly' | 'manual_only';
export const TRACKING_FREQUENCIES: TrackingFrequency[] = ['auto_monthly', 'manual_only'];
export type RefreshType = 'rankings' | 'gbp';

/** Monthly automatic refresh + manual refresh limits (Phase 7b). */
export interface ILocationRefresh {
  /** Day of month (1–28) the location completed setup: the monthly refresh day. */
  anchor_day: number;
  next_refresh_at: Date | null;
  last_auto_refresh_at: Date | null;
  last_manual: { rankings: Date | null; gbp: Date | null };
  /** Phase 13a: why the last monthly refresh was skipped ('billing' = the organization was read-only). */
  skipped_reason?: string | null;
  skipped_at?: Date | null;
}

/** GBP sync bookkeeping (7a: requested_at; 7b: the rest). */
export interface ILocationGbpSync {
  requested_at: Date | null;
  last_synced_at: Date | null;
  last_status: string | null;
  last_sync_id: string | null;
  /** Set after the first successful sync: later syncs fetch rolling windows instead of the backfill. */
  backfilled_at: Date | null;
}

/** GBP report bookkeeping (Phase 7c). */
export interface ILocationGbpReport {
  /** When the pending report generation runs (debounce); null when none is pending. */
  scheduled_for: Date | null;
  last_generated_at: Date | null;
  /** Set by a manual refresh: the next generation refetches competitor Place Details older than 24 h. */
  force_competitors_at: Date | null;
}

/** Phase 17: a named set of the location's tracked keywords (normalised), for filters and group summaries. */
export interface ILocationKeywordGroup {
  _id: mongoose.Types.ObjectId;
  name: string;
  keywords: string[];
}

/** Phase 17: a tracked competitor's name, address and position (Places content, accepted ToS risk). */
export interface ILocationCompetitorInfo {
  place_id: string;
  name: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
}

/** Ranking settings for one location (CLAUDE.md §9.1). One fixed keyword set, versioned. */
export interface ILocationTracking {
  keywords: { text: string; normalized: string }[];
  keywords_version: number;
  keywords_updated_at: Date | null;
  competitors: string[];
  /** Phase 17: radius_km = center to edge; spacing_km = between neighbouring points (one is derived from the other). */
  grid: { size: number; spacing_km: number; radius_km?: number };
  frequency: TrackingFrequency;
  /** Phase 17 (max 20). */
  keyword_groups: ILocationKeywordGroup[];
  /** Phase 17: one entry per competitor that has details (filled when competitors are saved). */
  competitor_info: ILocationCompetitorInfo[];
  /** @deprecated since 7b (ignored): refresh.next_refresh_at schedules the location. */
  next_run_at: Date | null;
  last_run_at: Date | null;
  last_error: string | null;
}

/** In order. center_needed / center_set only occur for profiles without coordinates (service-area). */
export type OnboardingStep = 'profile_selected' | 'place_selected' | 'center_needed' | 'center_set' | 'keywords_set' | 'competitors_set' | 'completed';
export const ONBOARDING_STEPS: OnboardingStep[] = ['profile_selected', 'place_selected', 'center_needed', 'center_set', 'keywords_set', 'competitors_set', 'completed'];

/** How the location was added (Phase 8): a GBP profile, a Places search result, or pre-Phase 8 data. */
export type LocationSource = 'gbp' | 'places_search';
export const LOCATION_SOURCES: LocationSource[] = ['gbp', 'places_search'];

/** Latest numbers for the locations list (Phase 8), kept by the rank-run and GBP report hooks. */
export interface ILocationSummary {
  overall_avg_rank: number | null;
  overall_change: number | null;
  last_run_at: Date | null;
  gbp_score: number | null;
  gbp_grade: string | null;
  gbp_partial: boolean | null;
  public_score: number | null;
  rating: number | null;
  review_count: number | null;
  /** Phase 11 (dashboards), written after each rank run / report: */
  top3_rate?: number | null;
  rank_trend?: { run_at: Date; overall_avg_rank: number | null }[];
  movement?: LocationMovement | null;
  declines?: { keyword: string; change: number | null; label: string }[];
  key_competitor?: { place_id: string; name: string | null; avg_rank: number | null; self_avg_rank: number | null; ahead: boolean } | null;
  gbp_score_change?: number | null;
  top_fixes?: { id: string; pillar: string; label: string; fix_hint: string | null; lost: number }[];
  gbp_issues?: { id: string; label: string }[];
  reviews_available?: boolean | null;
  unreplied?: number | null;
  /** Phase 16 (citations), written after every citation change: */
  citation_score?: number | null;
  citation_grade?: string | null;
  citation_coverage?: number | null;
  /** Active entries by status (not_checked, live_correct, nap_wrong, …). */
  citation_counts?: Record<string, number> | null;
  citation_total?: number | null;
  citation_checked_at?: Date | null;
}

/** Keyword movement of the latest rank run vs the previous one (Phase 11). */
export interface LocationMovement {
  improved: number;
  declined: number;
  unchanged: number;
  entered_top_60: number;
  dropped_out_of_top_60: number;
  not_comparable: number;
}

/** Where the location's lat/lng came from: the GBP profile, a Place Details lookup, or the user (city/ZIP). */
export type CenterSource = 'gbp' | 'place_details' | 'manual';
export const CENTER_SOURCES: CenterSource[] = ['gbp', 'place_details', 'manual'];

/** First-run state for locations created or linked through onboarding (Phase 7a). */
export interface ILocationOnboarding {
  step: OnboardingStep;
  started_at: Date;
  completed_at: Date | null;
}

export interface CompetitorSuggestion {
  place_id: string;
  name: string | null;
  address: string | null;
  rating: number | null;
  userRatingCount: number | null;
  best_position: number;
  keywords: { keyword: string; position: number }[];
}

/** 24 h cache of competitor suggestions (Places content; see the Maps ToS decision). */
export interface ILocationCompetitorSuggestions {
  generated_at: Date;
  keywords_version: number;
  keywords_used: string[];
  api_calls: number;
  results: CompetitorSuggestion[];
}

export interface ILocation extends Document {
  name: string;
  address: string;
    lat?: number;
  lng?: number;
  country: string;
  state: string;
  city: string;
  zip_code: string;
  mobile: string;
  place_id: string;
  website_URL: string;
  business_category: string;
  client_id?: Schema.Types.ObjectId;
  /** Phase 8: the owning organization (access is by membership; created_by stays for audit). */
  organization_id?: mongoose.Types.ObjectId;
  source?: LocationSource;
  gbp_connected?: boolean;
  summary?: ILocationSummary;
  is_active: boolean;
  created_at: Date;
  created_by?: Schema.Types.ObjectId;
  updated_at: Date;
  updated_by?: Schema.Types.ObjectId;
  deleted_at?: Date;
  deleted_by?: Schema.Types.ObjectId;
  tracking?: ILocationTracking;
  center_source?: CenterSource | null;
  /** What the user typed for a manual center (e.g. "Fredericton, NB"). */
  center_label?: string | null;
  onboarding?: ILocationOnboarding;
  gbp_sync?: ILocationGbpSync;
  gbp_report?: ILocationGbpReport;
  refresh?: ILocationRefresh;
  /** IANA timezone (e.g. "America/Moncton"); optional. Used for the ~03:00 local monthly refresh. */
  timezone?: string | null;
  competitor_suggestions?: ILocationCompetitorSuggestions;
}

interface IModelLocation extends Model<ILocation> {
  toggleIsActiveById(locationId: string): Promise<string>;
}

const trackingSchema = new Schema<ILocationTracking>(
  {
    keywords: {
      type: [{ _id: false, text: { type: String, required: true }, normalized: { type: String, required: true } }],
      default: [],
    },
    keywords_version: { type: Number, default: 1 },
    keywords_updated_at: { type: Date, default: null },
    competitors: { type: [String], default: [] },
    grid: {
      size: { type: Number, enum: [3, 5, 7, 9, 11, 13], default: 7 },
      spacing_km: { type: Number, min: 0.1, max: 15, default: 8 / 3 }, // 7×7 reaching 8 km
      // No default: a grid saved with only a spacing gets its radius derived (withDefaults).
      radius_km: { type: Number, min: 0.5, max: 15 },
    },
    frequency: { type: String, enum: TRACKING_FREQUENCIES, default: 'auto_monthly' },
    competitor_info: {
      type: [{ _id: false, place_id: { type: String, required: true }, name: { type: String, default: null }, address: { type: String, default: null }, lat: { type: Number, default: null }, lng: { type: Number, default: null } }],
      default: [],
    },
    keyword_groups: {
      // _id explicit: implicit subdocuments here inherit the tracking schema's _id: false.
      type: [{ _id: { type: Schema.Types.ObjectId, required: true }, name: { type: String, required: true }, keywords: { type: [String], default: [] } }],
      default: [],
    },
    next_run_at: { type: Date, default: null },
    last_run_at: { type: Date, default: null },
    last_error: { type: String, default: null },
  },
  { _id: false }
);

const locationSchema = new Schema<ILocation>(
  {
    name: {
      type: String,
      trim: true,
      required: true,
    },
    address: {
      type: String,
      trim: true,
      required: true,
    },
    lat: {
      type: Number,
      default: null,
    },
    lng: {
      type: Number,
      default: null,
    },
    country: {
      type: String,
      trim: true,
      required: true,
    },
    state: {
      type: String,
      trim: true,
      required: true,
    },
    city: {
      type: String,
      trim: true,
      required: true,
    },
    zip_code: {
      type: String,
      trim: true,
      required: true,
    },
    mobile: {
      type: String,
      trim: true,
      required: true,
    },
    place_id: {
      type: String,
      trim: true,
      default: null,
    },
    website_URL: {
      type: String,
      trim: true,
      required: true,
    },
    business_category: {
      type: String,
      trim: true,
      required: true,
    },
    client_id: {
      type: Schema.Types.ObjectId,
      ref: "Client",
      required: false,
      default: null,
    },
    organization_id: { type: Schema.Types.ObjectId, ref: "Organization", default: null },
    source: { type: String, enum: LOCATION_SOURCES, required: true },
    gbp_connected: { type: Boolean, default: false },
    summary: {
      type: new Schema<ILocationSummary>(
        {
          overall_avg_rank: { type: Number, default: null },
          overall_change: { type: Number, default: null },
          last_run_at: { type: Date, default: null },
          gbp_score: { type: Number, default: null },
          gbp_grade: { type: String, default: null },
          gbp_partial: { type: Boolean, default: null },
          public_score: { type: Number, default: null },
          rating: { type: Number, default: null },
          review_count: { type: Number, default: null },
          top3_rate: { type: Number, default: null },
          rank_trend: { type: Schema.Types.Mixed, default: [] },
          movement: { type: Schema.Types.Mixed, default: null },
          declines: { type: Schema.Types.Mixed, default: [] },
          key_competitor: { type: Schema.Types.Mixed, default: null },
          gbp_score_change: { type: Number, default: null },
          top_fixes: { type: Schema.Types.Mixed, default: [] },
          gbp_issues: { type: Schema.Types.Mixed, default: [] },
          reviews_available: { type: Boolean, default: null },
          unreplied: { type: Number, default: null },
          citation_score: { type: Number, default: null },
          citation_grade: { type: String, default: null },
          citation_coverage: { type: Number, default: null },
          citation_counts: { type: Schema.Types.Mixed, default: null },
          citation_total: { type: Number, default: null },
          citation_checked_at: { type: Date, default: null },
        },
        { _id: false },
      ),
      default: undefined,
    },
    is_active: {
      type: Boolean,
      default: true,
    },
    created_at: {
      type: Date,
      default: Date.now,
    },
    created_by: {
      type: Schema.Types.ObjectId,
      default: null,
    },
    updated_at: {
      type: Date,
      default: Date.now,
    },
    updated_by: {
      type: Schema.Types.ObjectId,
      default: null,
    },
    deleted_at: {
      type: Date,
      default: null,
    },
    deleted_by: {
      type: Schema.Types.ObjectId,
      default: null,
    },
    tracking: {
      type: trackingSchema,
      default: undefined,
    },
    center_source: { type: String, enum: [...CENTER_SOURCES, null], default: null },
    center_label: { type: String, default: null },
    onboarding: {
      type: new Schema<ILocationOnboarding>(
        {
          step: { type: String, enum: ONBOARDING_STEPS, required: true },
          started_at: { type: Date, required: true },
          completed_at: { type: Date, default: null },
        },
        { _id: false },
      ),
      default: undefined,
    },
    gbp_sync: {
      type: new Schema<ILocationGbpSync>(
        {
          requested_at: { type: Date, default: null },
          last_synced_at: { type: Date, default: null },
          last_status: { type: String, default: null },
          last_sync_id: { type: String, default: null },
          backfilled_at: { type: Date, default: null },
        },
        { _id: false },
      ),
      default: undefined,
    },
    gbp_report: {
      type: new Schema<ILocationGbpReport>(
        {
          scheduled_for: { type: Date, default: null },
          last_generated_at: { type: Date, default: null },
          force_competitors_at: { type: Date, default: null },
        },
        { _id: false },
      ),
      default: undefined,
    },
    refresh: {
      type: new Schema<ILocationRefresh>(
        {
          anchor_day: { type: Number, min: 1, max: 28, required: true },
          next_refresh_at: { type: Date, default: null },
          last_auto_refresh_at: { type: Date, default: null },
          last_manual: {
            rankings: { type: Date, default: null },
            gbp: { type: Date, default: null },
          },
          skipped_reason: { type: String, default: null },
          skipped_at: { type: Date, default: null },
        },
        { _id: false },
      ),
      default: undefined,
    },
    timezone: { type: String, default: null },
    competitor_suggestions: {
      type: new Schema<ILocationCompetitorSuggestions>(
        {
          generated_at: { type: Date, required: true },
          keywords_version: { type: Number, required: true },
          keywords_used: { type: [String], default: [] },
          api_calls: { type: Number, default: 0 },
          results: {
            type: [
              new Schema<CompetitorSuggestion>(
                {
                  place_id: { type: String, required: true },
                  name: { type: String, default: null },
                  address: { type: String, default: null },
                  rating: { type: Number, default: null },
                  userRatingCount: { type: Number, default: null },
                  best_position: { type: Number, required: true },
                  keywords: [{ _id: false, keyword: String, position: Number }],
                },
                { _id: false },
              ),
            ],
            default: [],
          },
        },
        { _id: false },
      ),
      default: undefined,
    },
  },
  {
    collection: "locations",
  }
);

// Rank scheduler: due weekly/monthly locations.
// monthly-refresh scheduler: due auto_monthly locations.
locationSchema.index({ "tracking.frequency": 1, "refresh.next_refresh_at": 1 });
// Phase 8: the organization's locations list, and one active location per place_id per organization.
locationSchema.index({ organization_id: 1, is_active: 1, name: 1 });
locationSchema.index(
  { organization_id: 1, place_id: 1 },
  { unique: true, name: "org_place_active_unique", partialFilterExpression: { is_active: true, organization_id: { $type: "objectId" }, place_id: { $type: "string" } } },
);

locationSchema.plugin(globalQueryFilters);
locationSchema.plugin(toJSON);
locationSchema.plugin(addTimestamps);

locationSchema.statics.toggleIsActiveById = async function (
  locationId: string
): Promise<string> {
  try {
    const clinet = await this.findOne({ _id: locationId, is_active: true });
    if (!clinet) {
      throw new ApiError(httpStatus.NOT_FOUND, "Location not found");
    }
    clinet.is_active = !clinet.is_active;
    await clinet.save();
    return `Location is now ${clinet.is_active ? "active" : "inactive"}`;
  } catch (error) {
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message || "Error toggling location status"
    );
  }
};

export const Location: IModelLocation = mongoose.model<
  ILocation,
  IModelLocation
>("Location", locationSchema);
