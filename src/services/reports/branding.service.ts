import crypto from 'crypto';
import httpStatus from 'http-status';
import { Types } from 'mongoose';
import logger from '../../configs/logger';
import { FrozenBranding, IOrganization, Organization, OrganizationBranding } from '../../models';
import { ApiError, apiErrorWithData } from '../../utils';
import { OrgContext } from '../org/context';
import { ReportStorage, reportStorage } from './storage';

// Organization branding for reports and report emails (Phase 12). White-label is agency-only:
// a business organization always gets the default MyPageSEO branding. The logo is stored privately
// (REPORTS_STORAGE_DIR/branding) and frozen into each report's snapshot at generation.

export const DEFAULT_BRANDING = {
	name: 'MyPageSEO',
	primary_color: '#1d4ed8',
	secondary_color: '#0f766e',
} as const;

export const MAX_LOGO_BYTES = 512 * 1024;

export type BrandingInput = Partial<
	Pick<OrganizationBranding, 'agency_name' | 'primary_color' | 'secondary_color' | 'footer_text' | 'contact_text' | 'hide_mypageseo' | 'email_sender_name' | 'email_reply_to'>
>;

type OrgForBranding = Pick<IOrganization, '_id' | 'name' | 'type'> & { branding?: OrganizationBranding | null };

const emptyBranding = (): OrganizationBranding => ({
	agency_name: null,
	logo: null,
	primary_color: null,
	secondary_color: null,
	footer_text: null,
	contact_text: null,
	hide_mypageseo: false,
	email_sender_name: null,
	email_reply_to: null,
	updated_at: null,
});

/** The branding a report uses (without the logo bytes). */
export const effectiveBranding = (org: OrgForBranding) => {
	const b = org.type === 'agency' ? { ...emptyBranding(), ...(org.branding ?? {}) } : emptyBranding();
	const agency = org.type === 'agency';
	return {
		white_label: agency,
		name: (agency ? b.agency_name || org.name : null) || DEFAULT_BRANDING.name,
		primary_color: b.primary_color || DEFAULT_BRANDING.primary_color,
		secondary_color: b.secondary_color || DEFAULT_BRANDING.secondary_color,
		footer_text: b.footer_text,
		contact_text: b.contact_text,
		hide_mypageseo: agency && b.hide_mypageseo,
		email_sender_name: b.email_sender_name,
		email_reply_to: b.email_reply_to,
		logo: b.logo,
	};
};

/** PNG or JPEG by magic bytes; null otherwise. */
export const imageTypeOf = (data: Buffer): { mime: 'image/png' | 'image/jpeg'; ext: 'png' | 'jpg' } | null => {
	if (data.length > 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
	if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
	return null;
};

/** "data:image/png;base64,…" (or bare base64) → bytes. */
export const decodeDataUrl = (input: string): Buffer => {
	const match = /^data:image\/(?:png|jpe?g);base64,(.*)$/s.exec(input.trim());
	const b64 = (match ? match[1] : input).replace(/\s+/g, '');
	if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) throw new ApiError(httpStatus.BAD_REQUEST, 'The logo must be a base64 PNG or JPEG.');
	return Buffer.from(b64, 'base64');
};

export const createBrandingService = (storage: ReportStorage = reportStorage) => {
	const load = async (organizationId: Types.ObjectId | string) => {
		const org = await Organization.findById(organizationId).select({ name: 1, type: 1, branding: 1 }).lean<OrgForBranding>();
		if (!org) throw new ApiError(httpStatus.NOT_FOUND, 'Organization not found');
		return org;
	};

	const view = (org: OrgForBranding) => {
		const b = effectiveBranding(org);
		return {
			white_label: b.white_label,
			name: b.name,
			agency_name: org.type === 'agency' ? org.branding?.agency_name ?? null : null,
			primary_color: b.primary_color,
			secondary_color: b.secondary_color,
			footer_text: b.footer_text,
			contact_text: b.contact_text,
			hide_mypageseo: b.hide_mypageseo,
			email_sender_name: b.email_sender_name,
			email_reply_to: b.email_reply_to,
			logo: b.logo ? { mime: b.logo.mime, bytes: b.logo.bytes, url: '/api/v1/organization/branding/logo' } : null,
			updated_at: org.branding?.updated_at ?? null,
		};
	};

	const get = async (ctx: OrgContext) => view(await load(ctx.organization._id));

	const requireAgency = (ctx: OrgContext) => {
		if (ctx.organization.type !== 'agency') throw apiErrorWithData(httpStatus.FORBIDDEN, 'White-label branding is available to agency organizations only.', { reason: 'agency_only' });
	};

	const update = async (ctx: OrgContext, input: BrandingInput) => {
		requireAgency(ctx);
		const org = await load(ctx.organization._id);
		// An empty string clears a text field.
		const cleaned = Object.fromEntries(Object.entries(input).map(([k, v]) => [k, v === '' ? null : v]));
		const next: OrganizationBranding = { ...emptyBranding(), ...(org.branding ?? {}), ...cleaned, updated_at: new Date() };
		await Organization.updateOne({ _id: org._id }, { $set: { branding: next } });
		logger.info(`branding: organization ${String(org._id)} updated by user ${ctx.userId}`);
		return view({ ...org, branding: next });
	};

	const setLogo = async (ctx: OrgContext, dataUrl: string) => {
		requireAgency(ctx);
		const data = decodeDataUrl(dataUrl);
		if (data.length === 0) throw new ApiError(httpStatus.BAD_REQUEST, 'The logo is empty.');
		if (data.length > MAX_LOGO_BYTES) throw apiErrorWithData(httpStatus.BAD_REQUEST, 'The logo must be 512 KB or smaller.', { reason: 'logo_too_large' });
		const type = imageTypeOf(data);
		if (!type) throw apiErrorWithData(httpStatus.BAD_REQUEST, 'The logo must be a PNG or JPEG image.', { reason: 'logo_type' });
		const orgId = String(ctx.organization._id);
		const org = await load(orgId);
		await storage.write(storage.logoPath(orgId, type.ext), data);
		const old = org.branding?.logo;
		if (old && old.file !== `logo.${type.ext}`) await storage.remove(storage.logoPath(orgId, type.ext === 'png' ? 'jpg' : 'png'));
		const logo = { file: `logo.${type.ext}`, mime: type.mime, bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') };
		const next: OrganizationBranding = { ...emptyBranding(), ...(org.branding ?? {}), logo, updated_at: new Date() };
		await Organization.updateOne({ _id: org._id }, { $set: { branding: next } });
		return view({ ...org, branding: next });
	};

	const removeLogo = async (ctx: OrgContext) => {
		requireAgency(ctx);
		const orgId = String(ctx.organization._id);
		const org = await load(orgId);
		await storage.remove(storage.logoPath(orgId, 'png'));
		await storage.remove(storage.logoPath(orgId, 'jpg'));
		const next: OrganizationBranding = { ...emptyBranding(), ...(org.branding ?? {}), logo: null, updated_at: new Date() };
		await Organization.updateOne({ _id: org._id }, { $set: { branding: next } });
		return view({ ...org, branding: next });
	};

	const readLogo = async (organizationId: Types.ObjectId | string): Promise<{ data: Buffer; mime: string } | null> => {
		const org = await load(organizationId);
		const logo = effectiveBranding(org).logo;
		if (!logo) return null;
		const data = await storage.read(storage.logoPath(String(org._id), logo.file.endsWith('.png') ? 'png' : 'jpg'));
		return data ? { data, mime: logo.mime } : null;
	};

	/** The branding frozen into a report snapshot (logo bytes included). */
	const freeze = async (organizationId: Types.ObjectId | string): Promise<FrozenBranding> => {
		const org = await load(organizationId);
		const b = effectiveBranding(org);
		const logo = await readLogo(organizationId);
		return {
			name: b.name,
			primary_color: b.primary_color,
			secondary_color: b.secondary_color,
			footer_text: b.footer_text,
			contact_text: b.contact_text,
			hide_mypageseo: b.hide_mypageseo,
			logo: logo ? { mime: logo.mime as 'image/png' | 'image/jpeg', data_base64: logo.data.toString('base64') } : null,
		};
	};

	return { get, update, setLogo, removeLogo, readLogo, freeze };
};

export const brandingService = createBrandingService();
