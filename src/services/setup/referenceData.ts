import fs from 'fs';
import path from 'path';
import { Model } from 'mongoose';
import { BusinessCategory, City, Country, Language, Role, State, Timezone } from '../../models';

// Fresh setup (Phase 13b): reference data from dumps/ (roles, countries, states, cities, languages, time
// zones, business categories). Idempotent: rows are matched on their natural key, so a re-run adds only
// what is missing and never duplicates.

export const DUMP_DIR = path.resolve(__dirname, '../../../dumps');

type Row = Record<string, unknown>;
const read = (dir: string, file: string): Row[] => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as Row[];

/** Inserts the rows whose key isn't there yet (existing keys are read once); returns how many were inserted. */
const upsertAll = async (model: Model<never>, rows: Row[], key: (r: Row) => Row): Promise<number> => {
	const fields = Object.keys(key(rows[0] ?? {}));
	const keyOf = (r: Row) => fields.map((f) => String(r[f] ?? '')).join('|');
	const existing = new Set(((await model.collection.find({}).project(Object.fromEntries(fields.map((f) => [f, 1]))).toArray()) as Row[]).map(keyOf));
	const missing: Row[] = [];
	for (const r of rows) {
		const k = keyOf(r);
		if (existing.has(k)) continue;
		existing.add(k);
		missing.push(r);
	}
	for (let i = 0; i < missing.length; i += 5000) await model.insertMany(missing.slice(i, i + 5000) as never[], { ordered: false });
	return missing.length;
};

export interface ReferenceDataResult {
	roles: number;
	countries: number;
	states: number;
	cities: number;
	languages: number;
	timezones: number;
	business_categories: number;
}

export const seedReferenceData = async (dumpDir: string = DUMP_DIR): Promise<ReferenceDataResult> => {
	const m = <T>(x: T) => x as unknown as Model<never>;
	const roles = await upsertAll(m(Role), read(dumpDir, 'roles.json'), (r) => ({ role_id: r.role_id }));
	const countries = await upsertAll(m(Country), read(dumpDir, 'countries.json'), (r) => ({ iso3: r.iso3 }));
	const countryIds = new Map((await Country.find({}).select({ iso3: 1 }).lean<{ _id: unknown; iso3: string }[]>()).map((c) => [c.iso3, c._id]));
	const stateRows = read(dumpDir, 'states.json').filter((s) => countryIds.has(String(s.country_code))).map((s) => ({ ...s, country_id: countryIds.get(String(s.country_code)) }));
	const states = await upsertAll(m(State), stateRows, (r) => ({ country_code: r.country_code, state_code: r.state_code }));
	const stateIds = new Map((await State.find({}).select({ country_code: 1, state_code: 1 }).lean<{ _id: unknown; country_code: string; state_code: string }[]>()).map((s) => [`${s.country_code}|${s.state_code}`, s._id]));
	const cityRows = read(dumpDir, 'cities.json')
		.filter((c) => countryIds.has(String(c.country_code)) && stateIds.has(`${c.country_code}|${c.state_code}`))
		.map((c) => ({ ...c, country_id: countryIds.get(String(c.country_code)), state_id: stateIds.get(`${c.country_code}|${c.state_code}`) }));
	const cities = await upsertAll(m(City), cityRows, (r) => ({ name: r.name, country_code: r.country_code, state_code: r.state_code }));
	const languages = await upsertAll(m(Language), read(dumpDir, 'languages.json'), (r) => ({ slug: r.slug }));
	const timezones = await upsertAll(m(Timezone), read(dumpDir, 'timezones.json'), (r) => ({ time_zone: r.time_zone }));
	const business_categories = await upsertAll(m(BusinessCategory), read(dumpDir, 'businessCategory.json'), (r) => ({ slug: r.slug }));
	return { roles, countries, states, cities, languages, timezones, business_categories };
};
