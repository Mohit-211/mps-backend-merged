import { Document, Model, Schema, Types, model } from 'mongoose';

// Directory categories (Phase 16): industry groups for citation directories (e.g. "Home services"),
// each mapped to many GBP business categories (`BusinessCategory`, the 4,101 Google category names).
// A location matches a group when one of its business categories is in the group.

export interface IDirectoryCategory extends Document {
	_id: Types.ObjectId;
	name: string;
	slug: string;
	business_category_ids: Types.ObjectId[];
	is_active: boolean;
	created_by: Types.ObjectId | null;
	updated_by: Types.ObjectId | null;
	created_at: Date;
	updated_at: Date;
}

const DirectoryCategorySchema = new Schema<IDirectoryCategory>(
	{
		name: { type: String, required: true, trim: true },
		slug: { type: String, required: true, trim: true, lowercase: true },
		business_category_ids: { type: [Schema.Types.ObjectId], ref: 'BusinessCategory', default: [] },
		is_active: { type: Boolean, default: true },
		created_by: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
		updated_by: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
	},
	{ collection: 'directory_categories', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);
DirectoryCategorySchema.index({ slug: 1 }, { unique: true });
DirectoryCategorySchema.index({ business_category_ids: 1 });

export const DirectoryCategory: Model<IDirectoryCategory> = model<IDirectoryCategory>('DirectoryCategory', DirectoryCategorySchema);
