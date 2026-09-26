import mongoose, { Schema, Model, Document } from "mongoose";
import {
  addTimestamps,
  globalQueryFilters,
  toJSON,
} from "../configs/mongoPlugins";
import httpStatus from "http-status";
import { ApiError } from "../utils";

export type TrackingFrequency = 'weekly' | 'monthly' | 'manual';

/** Ranking settings for one location (CLAUDE.md §9.1). One fixed keyword set, versioned. */
export interface ILocationTracking {
  keywords: { text: string; normalized: string }[];
  keywords_version: number;
  keywords_updated_at: Date | null;
  competitors: string[];
  grid: { size: number; spacing_km: number };
  frequency: TrackingFrequency;
  next_run_at: Date | null;
  last_run_at: Date | null;
  last_error: string | null;
}

/** In order. center_needed / center_set only occur for profiles without coordinates (service-area). */
export type OnboardingStep = 'profile_selected' | 'center_needed' | 'center_set' | 'keywords_set' | 'competitors_set' | 'completed';
export const ONBOARDING_STEPS: OnboardingStep[] = ['profile_selected', 'center_needed', 'center_set', 'keywords_set', 'competitors_set', 'completed'];

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
  /** Set by POST /onboarding/complete; the gbp-sync scheduler (Phase 7b) picks it up. */
  gbp_sync?: { requested_at: Date | null };
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
      size: { type: Number, enum: [3, 5, 7], default: 5 },
      spacing_km: { type: Number, min: 0.25, max: 5, default: 1 },
    },
    frequency: { type: String, enum: ['weekly', 'monthly', 'manual'], default: 'manual' },
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
      type: new Schema({ requested_at: { type: Date, default: null } }, { _id: false }),
      default: undefined,
    },
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
locationSchema.index({ "tracking.frequency": 1, "tracking.next_run_at": 1 });

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
