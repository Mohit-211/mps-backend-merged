import { CitationCountry } from './constants';

// Directory suggestions for a location (Phase 16), pure. A directory matches when it is active, lists
// the location's country, fits the location's region (if it has regions), and either has no categories
// (fits every business) or shares a category group with the location.

export interface MatchLocation {
	country: CitationCountry;
	/** 2-letter state / province code, or null when unknown. */
	region: string | null;
	/** Directory-category ids (as strings) the location's business categories belong to. */
	categoryIds: string[];
}

export interface MatchDirectory {
	id: string;
	is_active: boolean;
	countries: string[];
	regions: string[];
	category_ids: string[];
}

export const directoryMatches = (loc: MatchLocation, dir: MatchDirectory): boolean => {
	if (!dir.is_active || !dir.countries.includes(loc.country)) return false;
	if (dir.regions.length > 0 && (!loc.region || !dir.regions.includes(loc.region))) return false;
	if (dir.category_ids.length === 0) return true;
	return dir.category_ids.some((c) => loc.categoryIds.includes(c));
};

export const matchDirectories = (loc: MatchLocation, directories: MatchDirectory[]): string[] =>
	directories.filter((d) => directoryMatches(loc, d)).map((d) => d.id);
