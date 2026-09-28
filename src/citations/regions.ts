import { CitationCountry } from './constants';

// US states (+ DC) and Canadian provinces / territories, for directory `regions` and location matching.

export const US_STATES: Record<string, string> = {
	AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
	DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
	KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
	MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
	NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
	PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
	VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

export const CA_PROVINCES: Record<string, string> = {
	AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick', NL: 'Newfoundland and Labrador', NS: 'Nova Scotia',
	NT: 'Northwest Territories', NU: 'Nunavut', ON: 'Ontario', PE: 'Prince Edward Island', QC: 'Quebec', SK: 'Saskatchewan', YT: 'Yukon',
};

const REGIONS: Record<CitationCountry, Record<string, string>> = { US: US_STATES, CA: CA_PROVINCES };

const fold = (v: string): string => v.normalize('NFKD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ');

/** "US", "U.S.A.", "United States", "Canada", "CA"… → 'US' | 'CA' | null. */
export const citationCountry = (country: string | null | undefined): CitationCountry | null => {
	const c = fold(country ?? '');
	if (['us', 'usa', 'united states', 'united states of america'].includes(c)) return 'US';
	if (['ca', 'can', 'canada'].includes(c)) return 'CA';
	return null;
};

/** Whether `code` (e.g. "TX", "on") is a region of the country. */
export const isRegionOf = (country: CitationCountry, code: string): boolean => Boolean(REGIONS[country][code.trim().toUpperCase()]);

/** A location's state / province ("NB", "New Brunswick", "Québec") → its 2-letter code, or null. */
export const regionCode = (country: CitationCountry, state: string | null | undefined): string | null => {
	const raw = (state ?? '').trim();
	if (!raw) return null;
	const table = REGIONS[country];
	if (table[raw.toUpperCase()]) return raw.toUpperCase();
	const folded = fold(raw);
	const hit = Object.entries(table).find(([, name]) => fold(name) === folded);
	return hit ? hit[0] : null;
};
