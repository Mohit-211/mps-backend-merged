import Agenda from 'agenda';
import config from './config';
import logger from './logger';

// Agenda instance and lifecycle. Jobs are registered in src/jobs/index.ts (defineAllJobs).
//
// Agenda gets its OWN MongoDB connection (db.address) instead of Mongoose's connection:
// agenda@5 is built for the MongoDB driver 4 it bundles, and on Mongoose's driver-6 connection
// its index-creation callback never fires, so it never became ready and never started (AUDIT C25).
// The connection uses the existing MONGODB_* settings and the `agendaJobs` collection.

export const AGENDA_COLLECTION = 'agendaJobs';
const STOP_TIMEOUT_MS = 10000;

export interface AgendaConnection {
	address: string;
	username?: string;
	password?: string;
	authSource?: string;
}

export interface CreateAgendaOptions {
	processEvery?: string;
}

const connectionFromConfig = (): AgendaConnection => ({
	address: config.databases.mongodb.url,
	username: config.databases.mongodb.user,
	password: config.databases.mongodb.password,
	authSource: config.databases.mongodb.authSource,
});

export const createAgenda = (
	connection: AgendaConnection = connectionFromConfig(),
	options: CreateAgendaOptions = {},
): Agenda => {
	const auth =
		connection.username && connection.password
			? { auth: { username: connection.username, password: connection.password }, authSource: connection.authSource }
			: {};
	const agenda = new Agenda(
		{
			db: { address: connection.address, collection: AGENDA_COLLECTION, options: auth },
			processEvery: options.processEvery ?? '1 minute',
		},
		(error) => {
			// Called once the connection and index are ready, or with the connection error.
			if (error) logger.error(`Agenda could not connect to MongoDB: ${error.message}`);
		},
	);
	agenda.on('ready', () => logger.info('✅ Agenda connected and ready.'));
	agenda.on('error', (error: Error) => logger.error(`Agenda error: ${error.message}`));
	return agenda;
};

let singleton: Agenda | undefined;

/** The application's agenda instance, created on first use. */
export const getAgenda = (): Agenda => {
	if (!singleton) singleton = createAgenda();
	return singleton;
};

/** Starts processing jobs. Resolves once agenda is connected and polling. */
export const startAgenda = async (agenda: Agenda = getAgenda()): Promise<void> => {
	await agenda.start();
	logger.info('🚀 Agenda has started and is processing jobs.');
};

/** Stops processing (unlocking this instance's running jobs) and closes agenda's connection. */
export const stopAgenda = async (agenda: Agenda | undefined = singleton): Promise<void> => {
	if (!agenda) return;
	const stop = (async () => {
		await agenda.stop();
		await agenda.close({ force: false });
	})();
	const timeout = new Promise<void>((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS).unref());
	await Promise.race([stop, timeout]);
	logger.info('Agenda stopped.');
};
