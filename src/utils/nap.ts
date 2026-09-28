// NAP (name, address, phone, website) normalisation, shared by the GBP audit report (Phase 12) and the
// citation mismatch check (Phase 16). Two values "match" when their normalised forms are equal.

export const normaliseName = (v: string | null | undefined): string | null => {
	const n = (v ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
	return n || null;
};

/** The last 10 digits (North American numbers, with or without +1). */
export const normalisePhone = (v: string | null | undefined): string | null => {
	const d = (v ?? '').replace(/\D/g, '');
	return d.length >= 10 ? d.slice(-10) : d || null;
};

export const normaliseWebsite = (v: string | null | undefined): string | null => {
	const raw = (v ?? '').trim().toLowerCase();
	if (!raw) return null;
	return raw.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '') || null;
};

const STREET_WORDS: Record<string, string> = {
	street: 'st', avenue: 'ave', av: 'ave', road: 'rd', boulevard: 'blvd', drive: 'dr', lane: 'ln', court: 'ct', place: 'pl',
	square: 'sq', terrace: 'ter', parkway: 'pkwy', highway: 'hwy', route: 'rte', circle: 'cir', crescent: 'cres', way: 'way',
	suite: 'ste', unit: 'ste', apartment: 'ste', apt: 'ste', north: 'n', south: 's', east: 'e', west: 'w',
	northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw', floor: 'fl',
};

const POSTAL = /\b(\d{5})(?:-\d{4})?\b|\b([a-z]\d[a-z])\s?(\d[a-z]\d)\b/i;

export interface NormalisedAddress {
	/** The street line's tokens, abbreviated ("123 main st ste 4"), or null when there is no street line. */
	street: string | null;
	/** ZIP (5 digits) or Canadian postal code (A1A1A1), upper case. */
	postal: string | null;
}

/** The first comma-separated part is the street line; the postal code is searched in the whole address. */
export const normaliseAddress = (v: string | null | undefined): NormalisedAddress | null => {
	const raw = (v ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').trim();
	if (!raw) return null;
	const m = POSTAL.exec(raw);
	const postal = m ? (m[1] ?? `${m[2]}${m[3]}`).toUpperCase() : null;
	const line = raw.split(',')[0].toLowerCase().replace(/#/g, ' ste ').replace(/[^a-z0-9 ]+/g, ' ');
	const tokens = line.split(/\s+/).filter(Boolean).map((t) => STREET_WORDS[t] ?? t);
	return { street: tokens.length ? tokens.join(' ') : null, postal };
};

/** Addresses match when the postal codes agree (if both have one) and the street lines agree (if both have one). */
export const sameAddress = (a: string | null | undefined, b: string | null | undefined): boolean | null => {
	const x = normaliseAddress(a);
	const y = normaliseAddress(b);
	if (!x || !y) return null;
	let compared = false;
	if (x.postal && y.postal) {
		if (x.postal !== y.postal) return false;
		compared = true;
	}
	if (x.street && y.street && /\d/.test(x.street) && /\d/.test(y.street)) {
		if (x.street !== y.street) return false;
		compared = true;
	}
	return compared ? true : null;
};

export interface NapValues {
	name?: string | null;
	address?: string | null;
	phone?: string | null;
	website?: string | null;
}

/** Fields where `found` differs from `expected`. A field missing on either side is not compared. */
export const napMismatches = (expected: NapValues, found: NapValues): ('name' | 'address' | 'phone' | 'website')[] => {
	const out: ('name' | 'address' | 'phone' | 'website')[] = [];
	const cmp = (field: 'name' | 'phone' | 'website', norm: (v: string | null | undefined) => string | null) => {
		const x = norm(expected[field]);
		const y = norm(found[field]);
		if (x && y && x !== y) out.push(field);
	};
	cmp('name', normaliseName);
	if (sameAddress(expected.address, found.address) === false) out.push('address');
	cmp('phone', normalisePhone);
	cmp('website', normaliseWebsite);
	return out;
};
