// Places regionCode for a Location's country. Only the US and Canada are supported (CLAUDE.md §0).

export type RegionCode = 'us' | 'ca';

const REGIONS: Record<string, RegionCode> = {
	us: 'us',
	usa: 'us',
	'united states': 'us',
	'united states of america': 'us',
	ca: 'ca',
	can: 'ca',
	canada: 'ca',
};

const normalise = (country: string): string => country.trim().toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ');

/** Maps "US", "U.S.A.", "United States", "Canada", "CA"… to 'us' | 'ca'; throws for anything else. */
export const regionFromCountry = (country: string | null | undefined): RegionCode => {
	const region = country ? REGIONS[normalise(country)] : undefined;
	if (!region) throw new Error(`Unsupported country for ranking: "${country ?? ''}" (only US and Canada)`);
	return region;
};
