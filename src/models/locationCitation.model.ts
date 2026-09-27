import { Document, Model, Schema, Types, model } from 'mongoose';
import { CITATION_SOURCES, CITATION_STATUSES, CitationSource, CitationStatus, NAP_FIELDS, NapField } from '../citations/constants';

// A location's citation list (Phase 16): one directory on one location, kept by platform admins.
// `active: false` = taken off the list (history kept; re-adding restores it). `mismatch_fields` is
// computed on the server from `nap_found` against the location's NAP.

export interface NapFound {
	name: string | null;
	address: string | null;
	phone: string | null;
	website: string | null;
}

export interface ILocationCitation extends Document {
	_id: Types.ObjectId;
	organization_id: Types.ObjectId;
	location_id: Types.ObjectId;
	directory_id: Types.ObjectId;
	status: CitationStatus;
	listing_url: string | null;
	nap_found: NapFound;
	mismatch_fields: NapField[];
	notes: string | null;
	last_checked_at: Date | null;
	checked_by: Types.ObjectId | null;
	source: CitationSource;
	added_by: Types.ObjectId | null;
	active: boolean;
	created_at: Date;
	updated_at: Date;
}

const NapFoundSchema = new Schema<NapFound>(
	{
		name: { type: String, default: null },
		address: { type: String, default: null },
		phone: { type: String, default: null },
		website: { type: String, default: null },
	},
	{ _id: false },
);

const LocationCitationSchema = new Schema<ILocationCitation>(
	{
		organization_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
		location_id: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
		directory_id: { type: Schema.Types.ObjectId, ref: 'Directory', required: true },
		status: { type: String, enum: CITATION_STATUSES, default: 'not_checked' },
		listing_url: { type: String, default: null },
		nap_found: { type: NapFoundSchema, default: () => ({}) },
		mismatch_fields: { type: [String], enum: NAP_FIELDS, default: [] },
		notes: { type: String, default: null },
		last_checked_at: { type: Date, default: null },
		checked_by: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
		source: { type: String, enum: CITATION_SOURCES, default: 'manual' },
		added_by: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
		active: { type: Boolean, default: true },
	},
	{ collection: 'location_citations', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);
LocationCitationSchema.index({ location_id: 1, directory_id: 1 }, { unique: true });
LocationCitationSchema.index({ active: 1, status: 1, location_id: 1 });
LocationCitationSchema.index({ active: 1, last_checked_at: 1 });
LocationCitationSchema.index({ organization_id: 1, status: 1 });
LocationCitationSchema.index({ directory_id: 1 });

export const LocationCitation: Model<ILocationCitation> = model<ILocationCitation>('LocationCitation', LocationCitationSchema);
