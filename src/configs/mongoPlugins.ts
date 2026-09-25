import { Schema } from 'mongoose';

export function globalQueryFilters(schema: Schema): void {
	schema.pre('find', function (next) {
		this.where({ deleted_at: null });
		next();
	});

	schema.pre('findOne', function (next) {
		this.where({ deleted_at: null });
		next();
	});

	schema.pre('findOneAndUpdate', function (next) {
		this.where({ deleted_at: null });
		next();
	});

	schema.pre('countDocuments', function (next) {
		this.where({ deleted_at: null });
		next();
	});

	schema.pre('updateMany', function (next) {
		this.where({ deleted_at: null });
		next();
	});
};

export function toJSON(schema: Schema): void {
	schema.set('toJSON', {
		virtuals: true,
		transform: function (doc, ret) {
			ret.id = ret._id;
			delete ret.id;
			delete ret.__v;
		},
	});

	schema.set('toObject', {
		virtuals: true,
	});
	schema.set('versionKey', false);
};

export function addTimestamps(schema: Schema): void {
	schema.add({
		created_at: { type: Date, default: Date.now },
		updated_at: { type: Date, default: Date.now },
	});

	schema.pre('save', function (next) {
		if (this.isNew) {
			this.set({ created_at: new Date() });
		}
		this.set({ updated_at: new Date() });
		next();
	});

	schema.pre('updateOne', function (next) {
		this.set({ updated_at: new Date() });
		next();
	});

	schema.pre('findOneAndUpdate', function (next) {
		this.set({ updated_at: new Date() });
		next();
	});

	schema.pre('updateMany', function (next) {
		this.set({ updated_at: new Date() });
		next();
	});

	schema.pre('findOneAndDelete', function (next) {
		this.set({ deleted_at: new Date(), is_active: false });
		next();
	});

	schema.pre('deleteOne', function (next) {
		this.set({ deleted_at: new Date(), is_active: false });
		next();
	});

	schema.pre('deleteMany', function (next) {
		this.set({ deleted_at: new Date(), is_active: false });
		next();
	});
};