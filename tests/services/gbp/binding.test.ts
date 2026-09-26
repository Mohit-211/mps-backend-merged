import { Agenda } from 'agenda';
import mongoose, { Types } from 'mongoose';
import { GbpApiError, mapLocation } from '../../../src/clients/gbpClient';
import { GbpLocation, RawLocation } from '../../../src/clients/types/gbp';
import { AGENDA_COLLECTION, createAgenda, stopAgenda } from '../../../src/configs/agenda';
import { postPublishStatus, tokenTypes } from '../../../src/configs/constantTypes';
import { JOB_NAMES } from '../../../src/jobs/jobNames';
import { GBPPost, Location, User, UserAuth, UserGBP } from '../../../src/models';
import { UNBOUND_REASON, createBindingService } from '../../../src/services/gbp/binding.service';
import { createTokenStore } from '../../../src/services/gbp/tokenStore';
import { createTokenCrypto } from '../../../src/utils/tokenCrypto';
import { loadGbpFixture } from '../../helpers/fakeTransport';
import { clearDb, createLocation, createUser, startTestDb } from '../../helpers/mongoose';

// Importing the models barrel pulls services that import mongoConnection (would connect to .env).
jest.mock('../../../src/configs/mongoConnection', () => ({ agenda: {} }));

const GBP_LOCATION = mapLocation(loadGbpFixture<RawLocation>('location')) as GbpLocation;
const GBP_PLACE_ID = 'ChIJfakeGbpPlace000000001';
const ACCOUNT = 'accounts/100000000000000000001';
const expiry = new Date('2030-01-01T00:00:00Z');

const tokens = createTokenStore(createTokenCrypto('d'.repeat(64)));

let db: { stop: () => Promise<void> };
let agenda: Agenda;
beforeAll(async () => {
	db = await startTestDb();
	await Promise.all([UserAuth.syncIndexes(), UserGBP.syncIndexes()]);
	const { host, port } = mongoose.connection;
	agenda = createAgenda({ address: `mongodb://${host}:${port}/mps_test` });
	await new Promise<void>((resolve) => agenda.once('ready', () => resolve()));
}, 60000);
afterAll(async () => {
	await stopAgenda(agenda);
	await db.stop();
});
beforeEach(async () => clearDb());

const setup = (getLocation?: (userId: unknown, name: string) => Promise<GbpLocation>) => {
	const revoked: string[] = [];
	const service = createBindingService({
		client: {
			getLocation: getLocation ?? (async () => GBP_LOCATION),
			revoke: async (token: string) => {
				revoked.push(token);
			},
		},
		tokens,
		agenda,
	});
	return { service, revoked };
};

const connectedUser = async (email: string) => {
	const { user } = await createUser(email);
	await User.updateOne({ _id: user._id }, { is_gbp_connected: true });
	await tokens.save(user._id, tokenTypes.GBP, { accessToken: 'ya29.FAKE', refreshToken: '1//FAKE', expiryDate: expiry });
	return user;
};

const bindInput = (locationId: unknown, gbpLocationId = GBP_LOCATION.name) => ({
	location_id: String(locationId),
	gbpAccountId: ACCOUNT,
	gbpLocationId,
});

const jobsFor = (name: string) => mongoose.connection.collection(AGENDA_COLLECTION).countDocuments({ name });

describe('bind', () => {
	it('binds with data read from Google and sets place_id + coordinates when empty', async () => {
		const user = await connectedUser('a@test.dev');
		const location = await createLocation(user._id as Types.ObjectId, { place_id: null, lat: null, lng: null });
		const { service } = setup();
		const result = await service.bindLocation(user._id, bindInput(location._id));
		expect(result).toMatchObject({
			binding: { gbpLocationId: GBP_LOCATION.name, title: 'Example Plumbing Co', place_id: GBP_PLACE_ID },
			place_id: { location: GBP_PLACE_ID, gbp: GBP_PLACE_ID, status: 'set' },
			coordinates: 'set',
		});
		const saved = await Location.findById(location._id);
		expect(saved).toMatchObject({ place_id: GBP_PLACE_ID, lat: 32.7801, lng: -96.8005 });
		const binding = await UserGBP.findOne({ location_id: location._id }).lean();
		expect(binding).toMatchObject({ gbpAccountId: ACCOUNT, place_id: GBP_PLACE_ID, title: 'Example Plumbing Co' });
	});

	it('reports a match, and a conflict without overwriting', async () => {
		const user = await connectedUser('b@test.dev');
		const same = await createLocation(user._id as Types.ObjectId, { place_id: GBP_PLACE_ID });
		const other = await createLocation(user._id as Types.ObjectId, { place_id: 'ChIJsomethingElse0000001' });
		const { service } = setup();
		expect((await service.bindLocation(user._id, bindInput(same._id))).place_id.status).toBe('match');
		await UserGBP.deleteMany({});
		const conflict = await service.bindLocation(user._id, bindInput(other._id));
		expect(conflict.place_id).toEqual({ location: 'ChIJsomethingElse0000001', gbp: GBP_PLACE_ID, status: 'conflict' });
		expect(conflict.coordinates).toBe('kept');
		expect((await Location.findById(other._id))?.place_id).toBe('ChIJsomethingElse0000001');
	});

	it("refuses another user's location (404) and a GBP location the account cannot access (400)", async () => {
		const owner = await connectedUser('owner@test.dev');
		const intruder = await connectedUser('intruder@test.dev');
		const location = await createLocation(owner._id as Types.ObjectId);
		await expect(setup().service.bindLocation(intruder._id, bindInput(location._id))).rejects.toMatchObject({ statusCode: 404 });

		const forbidden = setup(async () => {
			throw new GbpApiError('GBP locations.get failed: The caller does not have permission', { status: 403 }, 1);
		});
		await expect(forbidden.service.bindLocation(owner._id, bindInput(location._id))).rejects.toMatchObject({
			statusCode: 400,
			message: 'The connected Google account cannot access this Business Profile location.',
		});
		expect(await UserGBP.countDocuments({})).toBe(0);
	});

	it('rebinding a location replaces its binding; one GBP location cannot be bound to two locations', async () => {
		const user = await connectedUser('c@test.dev');
		const first = await createLocation(user._id as Types.ObjectId);
		const second = await createLocation(user._id as Types.ObjectId);
		const { service } = setup();
		await service.bindLocation(user._id, bindInput(first._id));
		await service.bindLocation(user._id, bindInput(first._id));
		expect(await UserGBP.countDocuments({ location_id: first._id })).toBe(1);
		await expect(service.bindLocation(user._id, bindInput(second._id))).rejects.toMatchObject({ statusCode: 409 });
	});

	it('validates the Google resource names', async () => {
		const user = await connectedUser('d@test.dev');
		const location = await createLocation(user._id as Types.ObjectId);
		const { service } = setup();
		await expect(service.bindLocation(user._id, { ...bindInput(location._id), gbpAccountId: 'accounts/../x' })).rejects.toMatchObject({ statusCode: 400 });
		await expect(service.bindLocation(user._id, bindInput(location._id, 'locations/1?x=y'))).rejects.toMatchObject({ statusCode: 400 });
	});
});

describe('unbind (C12)', () => {
	const schedulePost = async (userId: unknown, locationId: unknown, gbpLocationId: string) => {
		const post = await GBPPost.create({
			created_by: userId,
			location_id: locationId,
			gbpAccountId: ACCOUNT,
			gbpLocationId,
			languageCode: 'en',
			topicType: 'STANDARD',
			summary: 'Spring special',
			status: postPublishStatus.scheduled,
			is_scheduled: true,
			is_posted: false,
		});
		await agenda.schedule(new Date('2030-01-01T00:00:00Z'), JOB_NAMES.POST_TO_GBP, {
			gbpPostObj: { gbpPostID: post._id, gbpLocationId },
		});
		return post;
	};

	it('bind → unbind leaves no binding, no tokens and no scheduled jobs', async () => {
		const user = await connectedUser('e@test.dev');
		const location = await createLocation(user._id as Types.ObjectId);
		const { service } = setup();
		await service.bindLocation(user._id, bindInput(location._id));
		await agenda.schedule(new Date('2030-01-01T00:00:00Z'), JOB_NAMES.GBP_SYNC, { location_id: String(location._id) });
		const post = await schedulePost(user._id, location._id, GBP_LOCATION.name);
		expect(await jobsFor(JOB_NAMES.GBP_SYNC)).toBe(1);

		const result = await service.unbindLocation(user._id, String(location._id));
		expect(result).toEqual({ unbound: true, jobs_cancelled: { gbp_sync: 1, scheduled_posts: 1 }, tokens_deleted: true });
		expect(await UserGBP.countDocuments({})).toBe(0);
		expect(await UserAuth.countDocuments({ user_id: user._id, token_type: tokenTypes.GBP })).toBe(0);
		expect(await jobsFor(JOB_NAMES.GBP_SYNC)).toBe(0);
		expect(await jobsFor(JOB_NAMES.POST_TO_GBP)).toBe(0);
		expect(await GBPPost.findById(post._id).lean()).toMatchObject({ status: postPublishStatus.rejected, last_error: UNBOUND_REASON });
		expect((await User.findById(user._id))?.is_gbp_connected).toBe(false);
	});

	it('keeps the tokens while another binding still needs them, and leaves other locations alone', async () => {
		const user = await connectedUser('f@test.dev');
		const a = await createLocation(user._id as Types.ObjectId);
		const b = await createLocation(user._id as Types.ObjectId);
		const locB: GbpLocation = { ...GBP_LOCATION, name: 'locations/200000000000000000009' };
		const { service } = setup(async (_u, name) => (name === locB.name ? locB : GBP_LOCATION));
		await service.bindLocation(user._id, bindInput(a._id));
		await service.bindLocation(user._id, bindInput(b._id, locB.name));
		await agenda.schedule(new Date('2030-01-01T00:00:00Z'), JOB_NAMES.GBP_SYNC, { location_id: String(b._id) });
		await schedulePost(user._id, b._id, locB.name);

		const result = await service.unbindLocation(user._id, String(a._id));
		expect(result.tokens_deleted).toBe(false);
		expect(result.jobs_cancelled).toEqual({ gbp_sync: 0, scheduled_posts: 0 });
		expect(await tokens.load(user._id, tokenTypes.GBP)).not.toBeNull();
		expect(await UserGBP.countDocuments({ location_id: b._id })).toBe(1);
		expect(await jobsFor(JOB_NAMES.GBP_SYNC)).toBe(1);
		expect(await jobsFor(JOB_NAMES.POST_TO_GBP)).toBe(1);
	});

	it('404s for an unbound location', async () => {
		const user = await connectedUser('g@test.dev');
		const location = await createLocation(user._id as Types.ObjectId);
		await expect(setup().service.unbindLocation(user._id, String(location._id))).rejects.toMatchObject({ statusCode: 404 });
	});
});

describe('disconnect', () => {
	it('revokes at Google and removes every binding, job and token', async () => {
		const user = await connectedUser('h@test.dev');
		const a = await createLocation(user._id as Types.ObjectId);
		const { service, revoked } = setup();
		await service.bindLocation(user._id, bindInput(a._id));
		await agenda.schedule(new Date('2030-01-01T00:00:00Z'), JOB_NAMES.GBP_SYNC, { location_id: String(a._id) });

		expect(await service.disconnect(user._id)).toEqual({ revoked: true, bindings_removed: 1, google_email: null });
		expect(revoked).toEqual(['1//FAKE']);
		expect(await UserGBP.countDocuments({})).toBe(0);
		expect(await UserAuth.countDocuments({ token_type: tokenTypes.GBP })).toBe(0);
		expect(await jobsFor(JOB_NAMES.GBP_SYNC)).toBe(0);
		expect((await User.findById(user._id))?.is_gbp_connected).toBe(false);
	});

	it('still cleans up locally when Google revocation fails', async () => {
		const user = await connectedUser('i@test.dev');
		const service = createBindingService({
			client: {
				getLocation: async () => GBP_LOCATION,
				revoke: async () => {
					throw new GbpApiError('GBP oauth.revoke failed', { status: 500 }, 2);
				},
			},
			tokens,
			agenda,
		}).disconnect;
		expect(await service(user._id)).toEqual({ revoked: false, bindings_removed: 0, google_email: null });
		expect(await UserAuth.countDocuments({ user_id: user._id })).toBe(0);
	});
});
