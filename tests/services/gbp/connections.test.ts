import { Agenda } from 'agenda';
import mongoose, { Types } from 'mongoose';
import { ConnectionRef, mapLocation } from '../../../src/clients/gbpClient';
import { GbpLocation, RawLocation } from '../../../src/clients/types/gbp';
import { AGENDA_COLLECTION, createAgenda, stopAgenda } from '../../../src/configs/agenda';
import { tokenTypes } from '../../../src/configs/constantTypes';
import { JOB_NAMES } from '../../../src/jobs/jobNames';
import { User, UserAuth, UserGBP } from '../../../src/models';
import { createBindingService } from '../../../src/services/gbp/binding.service';
import { connectionForBinding, resolveConnection } from '../../../src/services/gbp/connections';
import { createDiscoveryService } from '../../../src/services/gbp/discovery.service';
import { createTokenStore } from '../../../src/services/gbp/tokenStore';
import { createTokenCrypto } from '../../../src/utils/tokenCrypto';
import { loadGbpFixture } from '../../helpers/fakeTransport';
import { clearDb, createLocation, createUser, startTestDb } from '../../helpers/mongoose';

jest.mock('../../../src/configs/mongoConnection', () => ({ agenda: {} }));

// Several Google accounts per MyPageSEO user (Phase 7a): an agency connects each client's account.
// Account A can see profile A, account B can see profile B.

const BASE = mapLocation(loadGbpFixture<RawLocation>('location')) as GbpLocation;
const PROFILE_A: GbpLocation = { ...BASE, name: 'locations/300000000000000000001', title: 'Client A Plumbing', placeId: 'ChIJclientAplace00000001' };
const PROFILE_B: GbpLocation = { ...BASE, name: 'locations/300000000000000000002', title: 'Client B Dental', placeId: 'ChIJclientBplace00000001' };
const SUB_A = 'sub-account-a';
const SUB_B = 'sub-account-b';
const expiry = new Date('2030-01-01T00:00:00Z');

const tokens = createTokenStore(createTokenCrypto('a1'.repeat(32)));

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

/** A fake Google: each account can only read its own profile; getLocation uses the connection's token. */
const setup = () => {
	const calls: { sub: string | null | undefined; name: string }[] = [];
	const revoked: string[] = [];
	const visible: Record<string, GbpLocation> = { [SUB_A]: PROFILE_A, [SUB_B]: PROFILE_B };
	const client = {
		getLocation: async (conn: ConnectionRef, name: string) => {
			calls.push({ sub: conn.googleSub, name });
			const stored = await tokens.load(conn.userId, tokenTypes.GBP, conn.googleSub);
			if (!stored) throw new Error('no token for this connection');
			const profile = visible[String(conn.googleSub)];
			if (profile?.name !== name) throw new Error('forbidden');
			return profile;
		},
		listAccounts: async (conn: ConnectionRef) => [
			{ name: `accounts/${String(conn.googleSub)}`, accountName: String(conn.googleSub), type: 'PERSONAL', role: 'OWNER', verificationState: null },
		],
		listLocations: async (conn: ConnectionRef) => [visible[String(conn.googleSub)]],
		revoke: async (token: string) => void revoked.push(token),
	};
	const binding = createBindingService({ client, tokens, agenda });
	const discovery = createDiscoveryService({ client, tokens });
	return { binding, discovery, calls, revoked };
};

const connect = async (userId: Types.ObjectId, sub: string, email: string) =>
	tokens.save(userId, tokenTypes.GBP, { accessToken: `ya29.${sub}`, refreshToken: `1//${sub}`, expiryDate: expiry, googleSub: sub, googleEmail: email });

const jobs = (name: string, locationId: unknown) =>
	mongoose.connection.collection(AGENDA_COLLECTION).countDocuments({ name, 'data.location_id': String(locationId) });

describe('two Google accounts on one user', () => {
	it('binds one profile from each, disconnects A, and B keeps working', async () => {
		const { user } = await createUser('agency@test.dev');
		const uid = user._id as Types.ObjectId;
		await User.updateOne({ _id: uid }, { is_gbp_connected: true });
		await connect(uid, SUB_A, 'a@client.test');
		await connect(uid, SUB_B, 'b@client.test');
		const locA = await createLocation(uid, { place_id: null });
		const locB = await createLocation(uid, { place_id: null });
		const { binding, discovery, calls, revoked } = setup();

		// Profiles are grouped per Google account.
		const { connections } = await discovery.listAllLocations(uid);
		expect(connections.map((c) => [c.label, c.locations.map((l) => l.title)])).toEqual([
			['Connected as a@client.test', ['Client A Plumbing']],
			['Connected as b@client.test', ['Client B Dental']],
		]);

		// Binding needs google_sub when several accounts are connected.
		await expect(binding.bindLocation(uid, { location_id: String(locA._id), gbpAccountId: 'accounts/x', gbpLocationId: PROFILE_A.name })).rejects.toMatchObject({
			statusCode: 400,
			message: 'Several Google accounts are connected: google_sub is required.',
		});
		await binding.bindLocation(uid, { location_id: String(locA._id), gbpAccountId: 'accounts/x', gbpLocationId: PROFILE_A.name, google_sub: SUB_A });
		await binding.bindLocation(uid, { location_id: String(locB._id), gbpAccountId: 'accounts/y', gbpLocationId: PROFILE_B.name, google_sub: SUB_B });
		expect(await UserGBP.find({ user_id: uid }).sort({ google_sub: 1 }).select({ google_sub: 1, _id: 0 }).lean()).toEqual([
			{ google_sub: SUB_A },
			{ google_sub: SUB_B },
		]);

		await agenda.schedule(new Date('2030-01-01T00:00:00Z'), JOB_NAMES.GBP_SYNC, { location_id: String(locA._id) });
		await agenda.schedule(new Date('2030-01-01T00:00:00Z'), JOB_NAMES.GBP_SYNC, { location_id: String(locB._id) });

		// Disconnect A: only A's token, binding and jobs go.
		await expect(binding.disconnect(uid)).rejects.toMatchObject({ statusCode: 400 });
		expect(await binding.disconnect(uid, SUB_A)).toEqual({ revoked: true, bindings_removed: 1, google_email: 'a@client.test' });
		expect(revoked).toEqual([`1//${SUB_A}`]);
		expect(await tokens.load(uid, tokenTypes.GBP, SUB_A)).toBeNull();
		expect(await UserGBP.countDocuments({ location_id: locA._id })).toBe(0);
		expect(await jobs(JOB_NAMES.GBP_SYNC, locA._id)).toBe(0);

		expect(await tokens.load(uid, tokenTypes.GBP, SUB_B)).toMatchObject({ refreshToken: `1//${SUB_B}`, googleEmail: 'b@client.test' });
		expect(await UserGBP.countDocuments({ location_id: locB._id, google_sub: SUB_B })).toBe(1);
		expect(await jobs(JOB_NAMES.GBP_SYNC, locB._id)).toBe(1);
		expect((await User.findById(uid))?.is_gbp_connected).toBe(true);

		// B still works: its binding resolves to B's connection, which can still read the profile.
		const bBinding = await UserGBP.findOne({ location_id: locB._id }).lean();
		calls.length = 0;
		const client = setup();
		await expect(
			client.binding.bindLocation(uid, { location_id: String(locB._id), gbpAccountId: 'accounts/y', gbpLocationId: PROFILE_B.name }),
		).resolves.toMatchObject({ binding: { gbpLocationId: PROFILE_B.name } }); // one connection left: google_sub optional again
		expect(connectionForBinding(bBinding as { user_id: unknown; google_sub: string })).toEqual({ userId: String(uid), googleSub: SUB_B });

		// Disconnecting the last account clears the flag.
		await client.binding.disconnect(uid);
		expect((await User.findById(uid))?.is_gbp_connected).toBe(false);
	});

	it('unbind deletes a connection only with its last binding; the other account is untouched', async () => {
		const { user } = await createUser('agency2@test.dev');
		const uid = user._id as Types.ObjectId;
		await connect(uid, SUB_A, 'a@client.test');
		await connect(uid, SUB_B, 'b@client.test');
		const locA = await createLocation(uid, { place_id: null });
		const locB = await createLocation(uid, { place_id: null });
		const { binding } = setup();
		await binding.bindLocation(uid, { location_id: String(locA._id), gbpAccountId: 'accounts/x', gbpLocationId: PROFILE_A.name, google_sub: SUB_A });
		await binding.bindLocation(uid, { location_id: String(locB._id), gbpAccountId: 'accounts/y', gbpLocationId: PROFILE_B.name, google_sub: SUB_B });

		expect((await binding.unbindLocation(uid, String(locA._id))).tokens_deleted).toBe(true);
		expect(await tokens.load(uid, tokenTypes.GBP, SUB_A)).toBeNull();
		expect(await tokens.load(uid, tokenTypes.GBP, SUB_B)).not.toBeNull();
	});

	it('resolves connections: explicit, only one, ambiguous, unknown', async () => {
		const { user } = await createUser('r@test.dev');
		const uid = user._id as Types.ObjectId;
		await expect(resolveConnection(uid, undefined, tokens)).rejects.toThrow(/not connected/);
		await connect(uid, SUB_A, 'a@client.test');
		await expect(resolveConnection(uid, undefined, tokens)).resolves.toEqual({ userId: uid, googleSub: SUB_A });
		await connect(uid, SUB_B, 'b@client.test');
		await expect(resolveConnection(uid, undefined, tokens)).rejects.toMatchObject({ statusCode: 400 });
		await expect(resolveConnection(uid, SUB_B, tokens)).resolves.toEqual({ userId: uid, googleSub: SUB_B });
		await expect(resolveConnection(uid, 'sub-unknown', tokens)).rejects.toMatchObject({ statusCode: 400, message: 'That Google account is not connected.' });
	});

	it('keeps a pre-7a connection (no google_sub) working, and upgrades it on reconnect instead of duplicating', async () => {
		const { user } = await createUser('legacy@test.dev');
		const uid = user._id as Types.ObjectId;
		await UserAuth.create({ user_id: uid, token_type: tokenTypes.GBP, access_token: 'old-a', refresh_token: 'old-r', expiry_date: expiry });
		const location = await createLocation(uid);
		await UserGBP.create({ user_id: uid, location_id: location._id, gbpAccountId: 'accounts/1', gbpLocationId: 'locations/1' });

		const legacyBinding = await UserGBP.findOne({ location_id: location._id }).lean();
		const conn = connectionForBinding(legacyBinding as { user_id: unknown; google_sub?: null });
		expect(await tokens.load(conn.userId, tokenTypes.GBP, conn.googleSub)).toMatchObject({ refreshToken: 'old-r', googleSub: null });

		await connect(uid, SUB_A, 'a@client.test');
		expect(await UserAuth.countDocuments({ user_id: uid })).toBe(1);
		expect(await tokens.load(uid, tokenTypes.GBP)).toMatchObject({ googleSub: SUB_A, refreshToken: `1//${SUB_A}` });
	});
});
