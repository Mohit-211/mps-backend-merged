import { Types } from 'mongoose';
import { GbpAccessNotApprovedError, GbpApiError, mapAccount, mapLocation } from '../../../src/clients/gbpClient';
import { GbpAccount, GbpLocation, RawAccountsPage, RawLocationsPage } from '../../../src/clients/types/gbp';
import { HttpRequestError } from '../../../src/clients/http';
import { UserGBP } from '../../../src/models';
import { createDiscoveryService, formatAddress } from '../../../src/services/gbp/discovery.service';
import { ConnectionInfo } from '../../../src/services/gbp/tokenStore';
import { loadGbpFixture } from '../../helpers/fakeTransport';
import { clearDb, createLocation, createUser, startTestDb } from '../../helpers/mongoose';

jest.mock('../../../src/configs/mongoConnection', () => ({ agenda: {} }));

const accountsFrom = (...pages: string[]): GbpAccount[] =>
	pages.flatMap((p) => (loadGbpFixture<RawAccountsPage>(p).accounts ?? []).map((a) => mapAccount(a) as GbpAccount));
const locationsFrom = (...pages: string[]): GbpLocation[] =>
	pages.flatMap((p) => (loadGbpFixture<RawLocationsPage>(p).locations ?? []).map((l) => mapLocation(l) as GbpLocation));

const ACCOUNTS = accountsFrom('accounts_p1', 'accounts_p2');
const ONE: ConnectionInfo[] = [{ googleSub: 'sub-a', googleEmail: 'a@example.test', status: 'active', expiryDate: null }];
const one = { listConnections: async () => ONE };
const LOCATIONS = locationsFrom('locations_p1', 'locations_p2');

let db: { stop: () => Promise<void> };
beforeAll(async () => {
	db = await startTestDb();
});
afterAll(async () => db.stop());
beforeEach(async () => clearDb());

describe('formatAddress', () => {
	it('joins the storefront address, and is null without one', () => {
		expect(formatAddress(LOCATIONS[0].storefrontAddress)).toBe('100 Example St, Suite 5, Dallas, TX 75201');
		expect(formatAddress(LOCATIONS[1].storefrontAddress)).toBe('1 Sample Ave, Fredericton, NB E3B 1A1');
		expect(formatAddress(null)).toBeNull();
	});
});

describe('listAllLocations', () => {
	it('covers every account and every location, marks bound ones, and makes no Places calls', async () => {
		const { user } = await createUser('a@test.dev');
		const location = await createLocation(user._id as Types.ObjectId);
		await UserGBP.create({
			user_id: user._id,
			location_id: location._id,
			gbpAccountId: ACCOUNTS[0].name,
			gbpLocationId: LOCATIONS[0].name,
		});
		const listed: string[] = [];
		const service = createDiscoveryService({
			client: {
				listAccounts: async () => ACCOUNTS,
				listLocations: async (_c, account) => {
					listed.push(account);
					return account === ACCOUNTS[0].name ? LOCATIONS.slice(0, 2) : account === ACCOUNTS[2].name ? LOCATIONS.slice(2) : [];
				},
			},
			tokens: one,
		});
		const { connections } = await service.listAllLocations(user._id);
		expect(connections).toHaveLength(1);
		const result = connections[0];
		expect(result).toMatchObject({ google_sub: 'sub-a', google_email: 'a@example.test', label: 'Connected as a@example.test', status: 'ok' });
		expect(listed).toEqual(ACCOUNTS.map((a) => a.name));
		expect(result.accounts).toBe(3);
		expect(result.errors).toEqual([]);
		expect(result.locations.map((l) => l.gbpLocationId)).toEqual(LOCATIONS.map((l) => l.name));
		expect(result.locations[0]).toMatchObject({
			google_sub: 'sub-a',
			gbpAccountId: 'accounts/100000000000000000001',
			accountName: 'Example Owner',
			title: 'Example Plumbing Co',
			address: '100 Example St, Suite 5, Dallas, TX 75201',
			country: 'United States',
			state: 'TX',
			city: 'Dallas',
			zip_code: '75201',
			mobile: '(214) 555-0100',
			business_category: 'Plumber',
			place_id: 'ChIJfakeGbpPlace000000001',
			bound_location_id: String(location._id),
		});
		expect(result.locations[1]).toMatchObject({ country: 'Canada', bound_location_id: null });
		// Service-area business: no storefront, no website.
		expect(result.locations[2]).toMatchObject({ address: null, country: null, websiteUri: 'NA', place_id: null });
	});

	it('lists a location shared by two accounts once', async () => {
		const { user } = await createUser('b@test.dev');
		const service = createDiscoveryService({
			client: { listAccounts: async () => ACCOUNTS.slice(0, 2), listLocations: async () => LOCATIONS.slice(0, 1) },
			tokens: one,
		});
		expect((await service.listAllLocations(user._id)).connections[0].locations).toHaveLength(1);
	});

	it('keeps going when one account fails, and reports it', async () => {
		const { user } = await createUser('c@test.dev');
		const service = createDiscoveryService({
			client: {
				listAccounts: async () => ACCOUNTS,
				listLocations: async (_c, account) => {
					if (account === ACCOUNTS[1].name) throw new GbpApiError('GBP locations.list failed: internal', { status: 500 }, 2);
					return account === ACCOUNTS[0].name ? LOCATIONS.slice(0, 2) : [];
				},
			},
			tokens: one,
		});
		const result = (await service.listAllLocations(user._id)).connections[0];
		expect(result.locations).toHaveLength(2);
		expect(result.errors).toEqual([{ account: ACCOUNTS[1].name, message: 'GBP locations.list failed: internal' }]);
	});

	it('reports a connection-wide failure (quota 0) on its own group and keeps the other accounts', async () => {
		const { user } = await createUser('d@test.dev');
		const quota0 = new GbpAccessNotApprovedError(
			new HttpRequestError({ code: 'HTTP_ERROR', status: 429, message: 'Quota exceeded', quotaLimitValue: '0' }),
			1,
		);
		const two: ConnectionInfo[] = [...ONE, { googleSub: 'sub-b', googleEmail: 'b@example.test', status: 'active', expiryDate: null }];
		const service = createDiscoveryService({
			client: {
				listAccounts: async (conn) => {
					if (conn.googleSub === 'sub-a') throw quota0;
					return ACCOUNTS.slice(0, 1);
				},
				listLocations: async () => LOCATIONS.slice(0, 1),
			},
			tokens: { listConnections: async () => two },
		});
		const { connections } = await service.listAllLocations(user._id);
		expect(connections[0]).toMatchObject({ google_sub: 'sub-a', status: 'error', locations: [] });
		expect(connections[0].error).toMatch(/^GBP API access not approved \(quota 0\)/);
		expect(connections[1]).toMatchObject({ google_sub: 'sub-b', status: 'ok', label: 'Connected as b@example.test' });
		expect(connections[1].locations[0].google_sub).toBe('sub-b');
	});

	it('shows a revoked connection without calling Google, and 400s with no connection', async () => {
		const { user } = await createUser('e@test.dev');
		const listAccounts = jest.fn();
		const service = createDiscoveryService({
			client: { listAccounts, listLocations: jest.fn() },
			tokens: { listConnections: async () => [{ ...ONE[0], status: 'revoked' as const }] },
		});
		expect((await service.listAllLocations(user._id)).connections[0]).toMatchObject({ status: 'revoked' });
		expect(listAccounts).not.toHaveBeenCalled();
		const none = createDiscoveryService({ client: { listAccounts, listLocations: jest.fn() }, tokens: { listConnections: async () => [] } });
		await expect(none.listAllLocations(user._id)).rejects.toMatchObject({ statusCode: 400 });
	});
});
