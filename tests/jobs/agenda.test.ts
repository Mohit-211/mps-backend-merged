import { Agenda } from 'agenda';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { AGENDA_COLLECTION, createAgenda, startAgenda, stopAgenda } from '../../src/configs/agenda';
import { assertIdOnlyData, defineJob, scheduleJob } from '../../src/jobs/defineJob';
import { startMemoryMongo } from '../helpers/memoryMongo';

// The GBP posting job imports gbpPostSchedular.service, which imports mongoConnection; mocking it
// keeps this test from opening a real Mongoose connection.
jest.mock('../../src/configs/mongoConnection', () => ({ agenda: {} }));

const waitFor = <T>(emitter: Agenda, event: string, timeoutMs: number): Promise<T> =>
	new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`Timed out waiting for "${event}"`)), timeoutMs);
		emitter.once(event, (value: T) => {
			clearTimeout(timer);
			resolve(value);
		});
	});

describe('agenda (own connection, C25)', () => {
	let mongo: MongoMemoryServer;
	let client: MongoClient;
	let agenda: Agenda;

	beforeAll(async () => {
		mongo = await startMemoryMongo();
		client = await MongoClient.connect(mongo.getUri());
		agenda = createAgenda({ address: mongo.getUri('mps_test') });
	}, 120000);

	afterAll(async () => {
		await stopAgenda(agenda);
		await client.close();
		await mongo.stop();
	});

	it('connects on its own connection, becomes ready and starts', async () => {
		await expect(startAgenda(agenda)).resolves.toBeUndefined();
	}, 20000);

	it('runs a job scheduled a few seconds ahead, which can then be removed', async () => {
		const ran = jest.fn();
		defineJob<{ locationId: string }>(agenda, {
			name: 'test-self-check',
			concurrency: 1,
			lockLifetimeMs: 60000,
			handler: async (data) => {
				ran(data);
			},
		});
		const scheduledAt = Date.now();
		const job = await scheduleJob(agenda, 'test-self-check', new Date(Date.now() + 2000), { locationId: 'loc-1' });
		await waitFor(agenda, 'success:test-self-check', 15000);
		expect(Date.now() - scheduledAt).toBeGreaterThanOrEqual(1900);
		expect(ran).toHaveBeenCalledWith({ locationId: 'loc-1' });

		await job.remove();
		const left = await client.db('mps_test').collection(AGENDA_COLLECTION).countDocuments({ name: 'test-self-check' });
		expect(left).toBe(0);
	}, 30000);

	it('records failures through onFailure and rethrows', async () => {
		const onFailure = jest.fn(async () => undefined);
		defineJob<{ locationId: string }>(agenda, {
			name: 'test-failing',
			concurrency: 1,
			lockLifetimeMs: 60000,
			handler: async () => {
				throw new Error('boom');
			},
			onFailure,
		});
		const job = await agenda.now('test-failing', { locationId: 'loc-2' });
		await waitFor(agenda, 'fail:test-failing', 15000);
		expect(onFailure).toHaveBeenCalledWith({ locationId: 'loc-2' }, expect.objectContaining({ message: 'boom' }));
		await job.remove();
	}, 30000);

	it('registers post-to-gbp, rank-run and rank-scheduler through the job registry', async () => {
		const { defineAllJobs } = await import('../../src/jobs');
		const names = defineAllJobs(agenda);
		expect(names).toEqual(expect.arrayContaining(['post-to-gbp', 'rank-run', 'rank-scheduler']));
	});

	it('schedules rank-scheduler every 15 minutes as a single recurring job', async () => {
		// A separate agenda that is never started: the recurring job is saved but never runs here
		// (its handler needs a Mongoose connection this test file does not open).
		const { scheduleRecurringJobs } = await import('../../src/jobs');
		const idle = createAgenda({ address: mongo.getUri('mps_recurring') });
		await new Promise((resolve) => idle.once('ready', resolve));
		try {
			await scheduleRecurringJobs(idle);
			await scheduleRecurringJobs(idle); // idempotent
			const jobs = await idle.jobs({ name: 'rank-scheduler' });
			expect(jobs).toHaveLength(1);
			expect(jobs[0].attrs.repeatInterval).toBe('15 minutes');
		} finally {
			await idle.close({ force: true });
		}
	});
});

describe('IDs-only job data (C21)', () => {
	it('accepts objects of non-empty strings', () => {
		expect(() => assertIdOnlyData('x', { locationId: 'a', runId: 'b' })).not.toThrow();
	});

	it.each([
		[{ user: { _id: 'a' } }],
		[{ count: 3 }],
		[{ locationId: '' }],
		[['a']],
		[null],
	])('rejects %j', (data) => {
		expect(() => assertIdOnlyData('x', data)).toThrow(/Job "x"/);
	});

	it('refuses to schedule a payload', async () => {
		const fakeAgenda = { schedule: jest.fn() } as unknown as Agenda;
		// @ts-expect-error job data must be Record<string, string>
		await expect(scheduleJob(fakeAgenda, 'x', 'in 1 minute', { user: { email: 'a@example.com' } })).rejects.toThrow(
			'must be a non-empty ID string',
		);
		expect((fakeAgenda.schedule as jest.Mock).mock.calls).toHaveLength(0);
	});
});
