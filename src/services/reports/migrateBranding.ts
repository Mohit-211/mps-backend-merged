import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import mongoose, { Types } from 'mongoose';
import { IOrganization, Location, Organization, OrganizationBranding } from '../../models';
import { MAX_LOGO_BYTES, imageTypeOf } from './branding.service';
import { ReportStorage, reportStorage } from './storage';

// Phase 12 migration: each agency organization without branding gets its legacy white-label profile
// (the primary one, else the newest; per location in the old model) as organization branding.
// name → agency_name, header → contact_text, footer → footer_text, colour name → primary colour,
// and the logo is copied from the public uploads folder into private storage (PNG/JPEG ≤ 512 KB only).
// Existing branding is never overwritten, so it is idempotent. Business organizations are skipped.

export const LEGACY_COLORS: Record<string, string | null> = { red: '#b91c1c', blue: '#1d4ed8', default: null, minimal: null };

export interface BrandingMigrationRow {
	organization_id: string;
	organization: string;
	result: 'migrated' | 'has_branding' | 'no_profile';
	logo: 'copied' | 'none' | 'missing_file' | 'unsupported' | null;
}

interface LegacyProfile {
	_id: Types.ObjectId;
	name?: string;
	header?: string;
	footer?: string;
	color?: string;
	file_name?: string | null;
	is_primary?: boolean;
	created_at?: Date;
}

const trimTo = (v: string | undefined, max: number): string | null => (v && v.trim() ? v.trim().slice(0, max) : null);

export const migrateBranding = async (opts: { uploadsDir: string; storage?: ReportStorage; dryRun?: boolean }): Promise<BrandingMigrationRow[]> => {
	const storage = opts.storage ?? reportStorage;
	const rows: BrandingMigrationRow[] = [];
	const orgs = await Organization.find({ type: 'agency', is_active: true }).select({ name: 1, owner_user_id: 1, branding: 1 }).lean<IOrganization[]>();
	for (const org of orgs) {
		const base = { organization_id: String(org._id), organization: org.name };
		if (org.branding) {
			rows.push({ ...base, result: 'has_branding', logo: null });
			continue;
		}
		const locationIds = await Location.find({ organization_id: org._id }).distinct('_id');
		// 13b: the legacy model is gone; the old collection is read directly (only by this migration).
		const profile = (await mongoose.connection
			.collection('whitelabel_profiles')
			.find({ is_active: true, deleted_at: null, $or: [{ location_id: { $in: locationIds } }, { created_by: org.owner_user_id }] })
			.sort({ is_primary: -1, created_at: -1 })
			.limit(1)
			.next()) as unknown as LegacyProfile | null;
		if (!profile) {
			rows.push({ ...base, result: 'no_profile', logo: null });
			continue;
		}
		let logo: OrganizationBranding['logo'] = null;
		let logoResult: BrandingMigrationRow['logo'] = 'none';
		if (profile.file_name) {
			const file = path.join(opts.uploadsDir, path.basename(profile.file_name));
			const data = await fs.readFile(file).catch(() => null);
			const type = data ? imageTypeOf(data) : null;
			if (!data) logoResult = 'missing_file';
			else if (!type || data.length > MAX_LOGO_BYTES) logoResult = 'unsupported';
			else {
				if (!opts.dryRun) await storage.write(storage.logoPath(String(org._id), type.ext), data);
				logo = { file: `logo.${type.ext}`, mime: type.mime, bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') };
				logoResult = 'copied';
			}
		}
		const branding: OrganizationBranding = {
			agency_name: trimTo(profile.name, 150),
			logo,
			primary_color: LEGACY_COLORS[profile.color ?? 'default'] ?? null,
			secondary_color: null,
			footer_text: trimTo(profile.footer, 300),
			contact_text: trimTo(profile.header, 300),
			hide_mypageseo: false,
			email_sender_name: null,
			email_reply_to: null,
			updated_at: new Date(),
		};
		// Compare-and-set: only while the organization still has no branding.
		if (!opts.dryRun) await Organization.updateOne({ _id: org._id, $or: [{ branding: null }, { branding: { $exists: false } }] }, { $set: { branding } });
		rows.push({ ...base, result: 'migrated', logo: logoResult });
	}
	return rows;
};
