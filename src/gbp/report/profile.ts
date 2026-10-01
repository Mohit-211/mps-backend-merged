import { GbpHoursPeriod, IGbpProfileSnapshot } from '../../models/gbpData.model';

// The owner's Business Profile as last synced (2026-10-02), for the GBP Overview / Audit pages:
// what the profile shows today, from the latest profile snapshot. Pure.

export interface ProfileServiceItem {
	name: string;
	description: string | null;
	/** "structured" = a Google service type; "free_form" = the owner's own label. */
	kind: 'structured' | 'free_form';
	price: { currency: string; amount: number } | null;
}

export interface ProfileSection {
	available: true;
	taken_at: Date;
	title: string | null;
	description: string | null;
	primary_category: string | null;
	additional_categories: string[];
	regular_hours: GbpHoursPeriod[];
	special_hour_dates: string[];
	primary_phone: string | null;
	additional_phones: string[];
	website: string | null;
	service_area: { business_type: string | null; place_count: number; region_code: string | null };
	labels: string[];
	open_status: string | null;
	/**
	 * Attribute ids (e.g. "has_wheelchair_accessible_entrance") with their values, and since 2026-10-02 Google's
	 * English `display_name`, `group` and `value_labels` (null when Google's names couldn't be read).
	 */
	attributes: { name: string; value_type: string | null; values: unknown[]; display_name: string | null; group: string | null; value_labels: string[] | null }[];
	service_items: ProfileServiceItem[];
	maps_uri: string | null;
	/** Google's "write a review" link: for "ask for a review" buttons. */
	new_review_uri: string | null;
	latlng: { latitude: number; longitude: number } | null;
}

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === 'object' ? (v as Raw) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/** "job_type_id:boiler_repair" → "Boiler repair". */
const humanize = (id: string): string => {
	const tail = id.split(':').pop() ?? id;
	const words = tail.replace(/[_-]+/g, ' ').trim();
	return words ? words[0].toUpperCase() + words.slice(1) : id;
};

const priceOf = (raw: unknown): ProfileServiceItem['price'] => {
	const p = obj(raw);
	const currency = str(p.currencyCode);
	if (!currency) return null;
	const units = Number(p.units ?? 0);
	const nanos = Number(p.nanos ?? 0);
	const amount = Math.round((units + nanos / 1e9) * 100) / 100;
	return Number.isFinite(amount) ? { currency, amount } : null;
};

export const mapServiceItems = (raw: unknown): ProfileServiceItem[] => {
	const items = Array.isArray(raw) ? raw : [];
	const out: ProfileServiceItem[] = [];
	for (const item of items) {
		const i = obj(item);
		const structured = obj(i.structuredServiceItem);
		const free = obj(i.freeFormServiceItem);
		const typeId = str(structured.serviceTypeId);
		if (typeId) {
			out.push({ name: humanize(typeId), description: str(structured.description), kind: 'structured', price: priceOf(i.price) });
			continue;
		}
		const label = obj(free.label);
		const name = str(label.displayName);
		if (name) out.push({ name, description: str(label.description), kind: 'free_form', price: priceOf(i.price) });
	}
	return out;
};

export const profileSection = (snapshot: Pick<IGbpProfileSnapshot, 'taken_at' | 'profile' | 'attributes' | 'raw_location'>): ProfileSection | null => {
	const p = snapshot.profile;
	if (!p) return null;
	return {
		available: true,
		taken_at: snapshot.taken_at,
		title: p.title,
		description: p.description,
		primary_category: p.primary_category,
		additional_categories: [...p.additional_categories],
		regular_hours: [...p.regular_hours],
		special_hour_dates: [...p.special_hour_dates],
		primary_phone: p.primary_phone,
		additional_phones: [...p.additional_phones],
		website: p.website,
		service_area: { ...p.service_area },
		labels: [...p.labels],
		open_status: p.open_status,
		attributes: (snapshot.attributes ?? []).map((a) => ({
			name: a.name,
			value_type: a.value_type,
			values: [...(a.values ?? [])],
			display_name: a.display_name ?? null,
			group: a.group ?? null,
			value_labels: a.value_labels ? [...a.value_labels] : null,
		})),
		service_items: mapServiceItems(snapshot.raw_location?.serviceItems),
		maps_uri: p.maps_uri,
		new_review_uri: p.new_review_uri,
		latlng: p.latlng,
	};
};
