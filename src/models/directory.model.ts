import { Document, Model, Schema, Types, model } from 'mongoose';
import { CITATION_COUNTRIES, CitationCountry, DIRECTORY_TYPES, DirectoryType } from '../citations/constants';

// Citation directories (Phase 16): the master list platform admins maintain (CRUD + CSV). `category_ids`
// empty = the directory fits every business; a niche directory has at least one. `regions` (state /
// province codes) limits a directory to part of a country, e.g. a state chamber of commerce.

export interface IDirectory extends Document {
	_id: Types.ObjectId;
	name: string;
	url: string;
	/** The URL's host without `www.` (unique; the CSV upsert key). */
	domain: string;
	type: DirectoryType;
	category_ids: Types.ObjectId[];
	countries: CitationCountry[];
	regions: string[];
	authority: number | null;
	notes: string | null;
	is_active: boolean;
	created_by: Types.ObjectId | null;
	updated_by: Types.ObjectId | null;
	created_at: Date;
	updated_at: Date;
}

const DirectorySchema = new Schema<IDirectory>(
	{
		name: { type: String, required: true, trim: true },
		url: { type: String, required: true, trim: true },
		domain: { type: String, required: true, trim: true, lowercase: true },
		type: { type: String, enum: DIRECTORY_TYPES, required: true },
		category_ids: { type: [Schema.Types.ObjectId], ref: 'DirectoryCategory', default: [] },
		countries: { type: [String], enum: CITATION_COUNTRIES, default: [] },
		regions: { type: [String], default: [] },
		authority: { type: Number, min: 0, max: 100, default: null },
		notes: { type: String, default: null },
		is_active: { type: Boolean, default: true },
		created_by: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
		updated_by: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
	},
	{ collection: 'directories', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);
DirectorySchema.index({ domain: 1 }, { unique: true });
DirectorySchema.index({ is_active: 1, countries: 1, type: 1 });
DirectorySchema.index({ category_ids: 1 });

export const Directory: Model<IDirectory> = model<IDirectory>('Directory', DirectorySchema);
