import { Document, Model, Schema, Types, model } from 'mongoose';
import { CITATION_LOG_ACTIONS, CITATION_STATUSES, CitationLogAction, CitationStatus } from '../citations/constants';

// Citation history (Phase 16): one append-only row per change to a location's citation entry (who, when,
// from → to, which fields, note). Customers see these rows with the actor replaced by "MyPageSEO team".

export interface CitationActor {
	admin_id: Types.ObjectId | null;
	/** A snapshot of the admin's name at the time (admins may be renamed or removed later). */
	name: string | null;
}

export interface ICitationStatusLog extends Document {
	_id: Types.ObjectId;
	location_citation_id: Types.ObjectId;
	location_id: Types.ObjectId;
	organization_id: Types.ObjectId;
	directory_id: Types.ObjectId;
	action: CitationLogAction;
	from: CitationStatus | null;
	to: CitationStatus | null;
	changed_fields: string[];
	note: string | null;
	by: CitationActor;
	at: Date;
}

const CitationStatusLogSchema = new Schema<ICitationStatusLog>(
	{
		location_citation_id: { type: Schema.Types.ObjectId, ref: 'LocationCitation', required: true },
		location_id: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
		organization_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
		directory_id: { type: Schema.Types.ObjectId, ref: 'Directory', required: true },
		action: { type: String, enum: CITATION_LOG_ACTIONS, required: true },
		from: { type: String, enum: [...CITATION_STATUSES, null], default: null },
		to: { type: String, enum: [...CITATION_STATUSES, null], default: null },
		changed_fields: { type: [String], default: [] },
		note: { type: String, default: null },
		by: {
			admin_id: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
			name: { type: String, default: null },
		},
		at: { type: Date, required: true },
	},
	{ collection: 'citation_status_logs' },
);
CitationStatusLogSchema.index({ location_id: 1, at: -1 });
CitationStatusLogSchema.index({ location_citation_id: 1, at: -1 });
CitationStatusLogSchema.index({ at: -1 });
CitationStatusLogSchema.index({ organization_id: 1, at: -1 });

export const CitationStatusLog: Model<ICitationStatusLog> = model<ICitationStatusLog>('CitationStatusLog', CitationStatusLogSchema);
