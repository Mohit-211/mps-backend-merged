import { Agenda } from 'agenda';
import { Types } from 'mongoose';
import { mapLocation } from '../../../src/clients/gbpClient';
import { HttpRequestError } from '../../../src/clients/http';
import { PlacesApiError } from '../../../src/clients/placesClient';
import { GbpLocation, RawLocation } from '../../../src/clients/types/gbp';
import { SearchTextIdsParams } from '../../../src/clients/types/places';
import { tokenTypes } from '../../../src/configs/constantTypes';
import { ILocation, Location, UserAuth, UserGBP } from '../../../src/models';
import { createBindingService } from '../../../src/services/gbp/binding.service';
import { createTokenStore } from '../../../src/services/gbp/tokenStore';
import { createCenterService } from '../../../src/services/onboarding/center.service';
import { createOnboardingService } from '../../../src/services/onboarding/onboarding.service';
import { EnqueueResult } from '../../../src/services/ranking/rankRun.service';
import { updateTracking } from '../../../src/services/ranking/tracking.service';
import { createTokenCrypto } from '../../../src/utils/tokenCrypto';
import { loadGbpFixture } from '../../helpers/fakeTransport';
import { clearDb, createLocation, createUser, startTestDb } from '../../helpers/mongoose';

jest.mock('../../../src/configs/mongoConnection', () => ({ agenda: {} }));

const FREDERICTON = { latitude: 45.9635895, longitude: -66.6431151 };

const setupCenter = (opts: { noResult?: boolean; fail?: boolean } = {}) => {
	const searches: SearchTextIdsParams[] = [];
	const details: string[] = [];
	const reserved: number[] = [];
	const service = createCenterService({
		places: {
			searchTextIds: async (params) => {
				searches.push(params);
				if (opts.fail) throw new PlacesApiError(new HttpRequestError({ code: 'HTTP_ERROR', status: 500, message: 'x' }), 2);
				return { places: opts.noResult ? [] : [{ id: 'ChIJcityFredericton0001' }], pagesFetched: 1, apiCalls: 1, stoppedEarly: false };
			},
			getPlaceDetails: async (id, fields) => {
				details.push(`${id}:${fields.join(',')}`);
				return { details: { id, location: FREDERICTON }, apiCalls: 1 };
			},
		},
		usage: { reserve: async (_u, n) => void reserved.push(n) },
	});
	return { service, searches, details, reserved };
};

let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
	await Promise.all([UserAuth.syncIndexes(), UserGBP.syncIndexes()]);
});
afterAll(async () => db.stop());
beforeEach(async () => clearDb());

describe('manual center (city / ZIP)', () => {
	it('resolves with 1 IDs-only search (no location bias) + 1 Details `location`, saves it as manual', async () => {
		const { user } = await createUser('u@test.dev');
		const location = await createLocation(user._id as Types.ObjectId, { lat: null, lng: null });
		await Location.updateOne({ _id: location._id }, { $set: { competitor_suggestions: { generated_at: new Date(), keywords_version: 1, keywords_used: [], api_calls: 1, results: [] } } });
		const { service, searches, details, reserved } = setupCenter();
		const result = await service.setCenter(location, user._id, '  Fredericton, NB ');
		expect(searches).toEqual([{ textQuery: 'Fredericton, NB', regionCode: 'ca', maxPages: 1 }]);
		expect(searches[0]).not.toHaveProperty('center');
		expect(details).toEqual(['ChIJcityFredericton0001:location']);
		expect(reserved).toEqual([2]);
		expect(result).toEqual({ lat: FREDERICTON.latitude, lng: FREDERICTON.longitude, center_source: 'manual', center_label: 'Fredericton, NB', api_calls: 2 });
		const saved = await Location.findById(location._id).lean();
		expect(saved).toMatchObject({ lat: FREDERICTON.latitude, lng: FREDERICTON.longitude, center_source: 'manual', center_label: 'Fredericton, NB' });
		expect(saved?.competitor_suggestions).toBeUndefined(); // old suggestions dropped
	});

	it('404s when nothing is found, 502 when Google fails, 400 for an unsupported country', async () => {
		const { user } = await createUser('u@test.dev');
		const location = await createLocation(user._id as Types.ObjectId, { lat: null, lng: null });
		await expect(setupCenter({ noResult: true }).service.setCenter(location, user._id, 'Nowhereville')).rejects.toMatchObject({ statusCode: 404 });
		await expect(setupCenter({ fail: true }).service.setCenter(location, user._id, 'Fredericton')).rejects.toMatchObject({ statusCode: 502 });
		const uk = await createLocation(user._id as Types.ObjectId, { country: 'United Kingdom' });
		await expect(setupCenter().service.setCenter(uk, user._id, 'London')).rejects.toMatchObject({ statusCode: 400 });
		expect((await Location.findById(location._id))?.lat).toBeNull();
	});
});

describe('service-area onboarding: profile → center → keywords → competitors → complete', () => {
	it('adds the center step, blocks completion without it, then completes', async () => {
		const tokens = createTokenStore(createTokenCrypto('c3'.repeat(32)));
		const { user } = await createUser('sab@test.dev');
		await tokens.save(user._id, tokenTypes.GBP, { accessToken: 'a', refreshToken: 'r', expiryDate: new Date('2030-01-01'), googleSub: 'sub-1', googleEmail: 'o@x.test' });
		const sab: GbpLocation = {
			...(mapLocation(loadGbpFixture<RawLocation>('location')) as GbpLocation),
			storefrontAddress: null,
			serviceAreaRegionCode: 'CA',
			latlng: null,
		};
		const client = { getLocation: async () => sab, revoke: async () => undefined };
		const enqueued: string[] = [];
		const onboarding = createOnboardingService({
			client,
			tokens,
			binding: createBindingService({ client, tokens, agenda: {} as Agenda }),
			discovery: { listAllLocations: async () => ({ connections: [] }) },
			enqueue: async (loc: ILocation): Promise<EnqueueResult> => {
				enqueued.push(String(loc._id));
				return { run_id: 'run-1', status: 'queued', existing: false, estimate: {} as EnqueueResult['estimate'], dev_capped: false };
			},
		});

		const selected = await onboarding.selectProfile(user._id, { gbpAccountId: 'accounts/1', gbpLocationId: sab.name });
		expect(selected).toMatchObject({ created: true, center_needed: true, location: { lat: null, lng: null } });
		const reload = async () => (await Location.findById(selected.location.location_id)) as ILocation;
		expect((await reload()).onboarding?.step).toBe('center_needed');

		// Keywords are saved, but the flow stays on the center step.
		const kw = await updateTracking(await reload(), { keywords: ['plumber'] });
		expect(kw.onboarding_step).toBe('center_needed');
		await expect(onboarding.complete(user._id, selected.location.location_id)).rejects.toMatchObject({
			statusCode: 400,
			message: 'Set the business center first (city or ZIP).',
		});

		const center = await setupCenter().service.setCenter(await reload(), user._id, 'E3B 1A1');
		expect(center.onboarding_step).toBe('center_set');
		expect((await updateTracking(await reload(), { keywords: ['plumber', 'drain cleaning'] })).onboarding_step).toBe('keywords_set');
		expect((await updateTracking(await reload(), { competitors: [] })).onboarding_step).toBe('competitors_set');
		await expect(onboarding.complete(user._id, selected.location.location_id)).resolves.toMatchObject({ completed: true });
		expect(enqueued).toHaveLength(1);
		expect(await reload()).toMatchObject({ center_source: 'manual', center_label: 'E3B 1A1' });
	});

	it('a storefront profile skips the center step and records center_source gbp', async () => {
		const tokens = createTokenStore(createTokenCrypto('c4'.repeat(32)));
		const { user } = await createUser('store@test.dev');
		await tokens.save(user._id, tokenTypes.GBP, { accessToken: 'a', refreshToken: 'r', expiryDate: new Date('2030-01-01'), googleSub: 'sub-2' });
		const profile = mapLocation(loadGbpFixture<RawLocation>('location')) as GbpLocation;
		const client = { getLocation: async () => profile, revoke: async () => undefined };
		const onboarding = createOnboardingService({
			client,
			tokens,
			binding: createBindingService({ client, tokens, agenda: {} as Agenda }),
			discovery: { listAllLocations: async () => ({ connections: [] }) },
		});
		const selected = await onboarding.selectProfile(user._id, { gbpAccountId: 'accounts/1', gbpLocationId: profile.name });
		expect(selected.center_needed).toBe(false);
		expect(await Location.findById(selected.location.location_id).lean()).toMatchObject({ center_source: 'gbp', onboarding: { step: 'profile_selected' } });
	});
});
