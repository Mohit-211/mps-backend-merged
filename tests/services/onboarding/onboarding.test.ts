import { Agenda } from 'agenda';
import { Types } from 'mongoose';
import { GbpApiError, mapLocation } from '../../../src/clients/gbpClient';
import { GbpLocation, RawLocation } from '../../../src/clients/types/gbp';
import { tokenTypes } from '../../../src/configs/constantTypes';
import { ILocation, Location, Profile, UserAuth, UserGBP } from '../../../src/models';
import { createBindingService } from '../../../src/services/gbp/binding.service';
import { createTokenStore } from '../../../src/services/gbp/tokenStore';
import { createOnboardingService, locationFieldsFromProfile } from '../../../src/services/onboarding/onboarding.service';
import { nextOnboardingStep } from '../../../src/services/onboarding/steps';
import { EnqueueResult } from '../../../src/services/ranking/rankRun.service';
import { updateTracking } from '../../../src/services/ranking/tracking.service';
import { createTokenCrypto } from '../../../src/utils/tokenCrypto';
import { loadGbpFixture } from '../../helpers/fakeTransport';
import { clearDb, createLocation, createUser, keywordsOf, startTestDb } from '../../helpers/mongoose';

jest.mock('../../../src/configs/mongoConnection', () => ({ agenda: {} }));

const PROFILE = mapLocation(loadGbpFixture<RawLocation>('location')) as GbpLocation; // Dallas, US
const PLACE_ID = 'ChIJfakeGbpPlace000000001';
const ACCOUNT = 'accounts/100000000000000000001';
const tokens = createTokenStore(createTokenCrypto('f'.repeat(64)));
const syncs: string[] = [];

describe('nextOnboardingStep', () => {
	it.each([
		['profile_selected', 2, false, 'keywords_set'],
		['profile_selected', 2, true, 'competitors_set'],
		['keywords_set', 2, true, 'competitors_set'],
		['competitors_set', 2, false, null], // never backwards
		['center_needed', 2, true, null], // the center must be set first (service-area)
		['center_set', 2, false, 'keywords_set'],
		['keywords_set', 0, true, null], // keywords required
		['completed', 3, true, null],
		[undefined, 3, true, null], // not an onboarding location
	] as const)('%s + %i keywords, competitors sent=%s → %s', (current, keywordCount, competitorsSent, expected) => {
		expect(nextOnboardingStep(current, { keywordCount, competitorsSent })).toBe(expected);
	});
});

describe('locationFieldsFromProfile', () => {
	it('maps a storefront profile', () => {
		expect(locationFieldsFromProfile(PROFILE)).toEqual({
			name: 'Example Plumbing Co',
			address: '100 Example St, Suite 5, Dallas, TX 75201',
			city: 'Dallas',
			state: 'TX',
			zip_code: '75201',
			country: 'United States',
			mobile: '(214) 555-0100',
			website_URL: 'https://example-plumbing.test/',
			business_category: 'Plumber',
			place_id: PLACE_ID,
			lat: 32.7801,
			lng: -96.8005,
		});
	});

	it('maps a service-area business (country from the service area, n/a placeholders)', () => {
		const sab: GbpLocation = { ...PROFILE, storefrontAddress: null, serviceAreaRegionCode: 'CA', latlng: null, primaryPhone: null, websiteUri: null };
		expect(locationFieldsFromProfile(sab)).toMatchObject({
			address: 'Service-area business',
			city: 'n/a',
			country: 'Canada',
			mobile: 'n/a',
			website_URL: 'n/a',
			lat: null,
		});
	});
});

describe('onboarding service', () => {
	let db: { stop: () => Promise<void> };
	beforeAll(async () => {
		db = await startTestDb();
		await Promise.all([UserAuth.syncIndexes(), UserGBP.syncIndexes()]);
	});
	afterAll(async () => db.stop());
	beforeEach(async () => clearDb());

	const setup = (profile: GbpLocation = PROFILE, opts: { getLocationFails?: boolean } = {}) => {
		const gbpCalls: string[] = [];
		const enqueued: string[] = [];
		syncs.length = 0;
		const client = {
			getLocation: async (_u: unknown, name: string) => {
				gbpCalls.push(name);
				if (opts.getLocationFails) throw new GbpApiError('GBP locations.get failed: denied', { status: 403 }, 1);
				return profile;
			},
			revoke: async () => undefined,
		};
		const service = createOnboardingService({
			client,
			tokens,
			binding: createBindingService({ client, tokens, agenda: {} as Agenda }),
			discovery: { listAllLocations: async () => ({ connections: [] }) },
			enqueue: async (location: ILocation): Promise<EnqueueResult> => {
				enqueued.push(String(location._id));
				return { run_id: 'run-1', status: 'queued', existing: false, estimate: {} as EnqueueResult['estimate'], dev_capped: false };
			},
			enqueueSync: async (location: ILocation) => {
				syncs.push(String(location._id));
				return { sync_id: 'sync-1', status: 'queued', existing: false, estimated_calls: 7 };
			},
		});
		return { service, gbpCalls, enqueued };
	};

	const connectedUser = async (email: string) => {
		const { user } = await createUser(email);
		await Profile.create({ user_id: user._id, name: 'Owner', no_of_locations: 0 });
		await tokens.save(user._id, tokenTypes.GBP, {
			accessToken: 'ya29.FAKE',
			refreshToken: '1//FAKE',
			expiryDate: new Date(Date.now() + 3600_000),
			googleEmail: 'owner@example.test',
			googleSub: '1',
		});
		return user;
	};

	const select = { gbpAccountId: ACCOUNT, gbpLocationId: PROFILE.name };

	it('creates a location from the profile, binds it with one GBP call, and starts onboarding', async () => {
		const user = await connectedUser('a@test.dev');
		const { service, gbpCalls } = setup();
		const result = await service.selectProfile(user._id, select);
		expect(gbpCalls).toEqual([PROFILE.name]);
		expect(result.created).toBe(true);
		expect(result.location).toMatchObject({ name: 'Example Plumbing Co', place_id: PLACE_ID, lat: 32.7801, lng: -96.8005 });
		expect(result.binding.place_id.status).toBe('match');
		const saved = await Location.findById(result.location.location_id).lean();
		expect(saved).toMatchObject({ country: 'United States', city: 'Dallas', mobile: '(214) 555-0100', onboarding: { step: 'profile_selected', completed_at: null } });
		expect(await UserGBP.countDocuments({ location_id: saved?._id, is_active: true })).toBe(1);
		expect((await Profile.findOne({ user_id: user._id }))?.no_of_locations).toBe(1);
	});

	it('links an existing location with the same place_id instead of duplicating it', async () => {
		const user = await connectedUser('b@test.dev');
		const existing = await createLocation(user._id as Types.ObjectId, { place_id: PLACE_ID });
		const result = await setup().service.selectProfile(user._id, select);
		expect(result).toMatchObject({ created: false, location: { location_id: String(existing._id) } });
		expect(await Location.countDocuments({ created_by: user._id })).toBe(1);
		expect((await Profile.findOne({ user_id: user._id }))?.no_of_locations).toBe(0);
	});

	it('links an explicit location_id (and reports a place_id conflict without overwriting)', async () => {
		const user = await connectedUser('c@test.dev');
		const mine = await createLocation(user._id as Types.ObjectId, { place_id: 'ChIJdifferentPlace0000001' });
		const result = await setup().service.selectProfile(user._id, { ...select, location_id: String(mine._id) });
		expect(result.created).toBe(false);
		expect(result.binding.place_id.status).toBe('conflict');
		expect((await Location.findById(mine._id))?.place_id).toBe('ChIJdifferentPlace0000001');
	});

	it("refuses another user's location_id, a non-US/CA profile and an inaccessible profile", async () => {
		const owner = await connectedUser('owner@test.dev');
		const intruder = await connectedUser('intruder@test.dev');
		const theirs = await createLocation(owner._id as Types.ObjectId);
		await expect(setup().service.selectProfile(intruder._id, { ...select, location_id: String(theirs._id) })).rejects.toMatchObject({ statusCode: 404 });
		const uk: GbpLocation = { ...PROFILE, storefrontAddress: { ...(PROFILE.storefrontAddress as NonNullable<GbpLocation['storefrontAddress']>), regionCode: 'GB' } };
		await expect(setup(uk).service.selectProfile(owner._id, select)).rejects.toMatchObject({
			statusCode: 400,
			message: 'Only US and Canadian businesses are supported.',
		});
		await expect(setup(PROFILE, { getLocationFails: true }).service.selectProfile(owner._id, select)).rejects.toMatchObject({ statusCode: 400 });
		expect(await Location.countDocuments({ created_by: owner._id })).toBe(1);
	});

	it('accepts a service-area business', async () => {
		const user = await connectedUser('d@test.dev');
		const sab: GbpLocation = { ...PROFILE, storefrontAddress: null, serviceAreaRegionCode: 'US', latlng: null };
		const result = await setup(sab).service.selectProfile(user._id, select);
		expect(result.location).toMatchObject({ address: 'Service-area business', lat: null, place_id: PLACE_ID });
	});

	it('advances steps through tracking updates, then completes (rank run + sync request), idempotently', async () => {
		const user = await connectedUser('e@test.dev');
		const { service, enqueued } = setup();
		const { location } = await service.selectProfile(user._id, select);
		const reload = async () => (await Location.findById(location.location_id)) as ILocation;

		await expect(service.complete(user._id, location.location_id)).rejects.toMatchObject({ statusCode: 400, message: 'Add at least one keyword first.' });
		const afterKeywords = await updateTracking(await reload(), { keywords: ['plumber', 'emergency plumber'] });
		expect(afterKeywords.onboarding_step).toBe('keywords_set');
		await updateTracking(await reload(), { competitors: [] });
		expect((await reload()).onboarding?.step).toBe('competitors_set');

		const done = await service.complete(user._id, location.location_id);
		expect(done).toMatchObject({ completed: true, rank_run: { run_id: 'run-1', status: 'queued' } });
		expect(done.gbp_sync).toEqual({ sync_id: 'sync-1', status: 'queued', existing: false });
		expect(done.refresh?.anchor_day).toBeGreaterThanOrEqual(1);
		expect(done.refresh?.next_refresh_at).toBeInstanceOf(Date);
		const saved = await reload();
		expect(saved.onboarding).toMatchObject({ step: 'completed' });
		expect(saved.onboarding?.completed_at).toBeInstanceOf(Date);
		expect(saved.refresh).toMatchObject({ anchor_day: done.refresh?.anchor_day });
		expect(syncs).toHaveLength(1);

		const again = await service.complete(user._id, location.location_id);
		expect(again.completed).toBe(true);
		expect(enqueued).toHaveLength(1);
		// Tracking changes after completion no longer touch the step.
		await updateTracking(await reload(), { keywords: ['plumber'] });
		expect((await reload()).onboarding?.step).toBe('completed');
	});

	it('complete requires a bound profile', async () => {
		const user = await connectedUser('f@test.dev');
		const loc = await createLocation(user._id as Types.ObjectId, { tracking: { keywords: keywordsOf('plumber') } });
		await expect(setup().service.complete(user._id, String(loc._id))).rejects.toMatchObject({
			statusCode: 400,
			message: 'Select a Business Profile for this location first.',
		});
	});

	it('reports the connection and unfinished onboarding locations first', async () => {
		const user = await connectedUser('g@test.dev');
		const { service } = setup();
		const { location } = await service.selectProfile(user._id, select);
		await Location.create({ ...locationFieldsFromProfile(PROFILE), place_id: 'ChIJother00000000000001', name: 'Done Co', created_by: user._id, onboarding: { step: 'completed', started_at: new Date(), completed_at: new Date() } });
		await createLocation(user._id as Types.ObjectId); // legacy location: not listed
		const state = await service.getState(user._id);
		expect(state.gbp).toEqual({ connected: true, connections: [{ google_sub: '1', google_email: 'owner@example.test', status: 'active' }] });
		expect(state.locations.map((l) => l.name)).toEqual(['Example Plumbing Co', 'Done Co']);
		expect(state.locations[0]).toMatchObject({ location_id: location.location_id, onboarding: { step: 'profile_selected' } });

		const { user: fresh } = await createUser('fresh@test.dev');
		expect((await service.getState(fresh._id)).gbp).toEqual({ connected: false, connections: [] });
	});
});
