import app from './app';
import { DateTime } from 'luxon';
import config from './configs/config';
import logger from './configs/logger';
import { getAgenda, startAgenda, stopAgenda } from './configs/agenda';
import { defineAllJobs, scheduleRecurringJobs } from './jobs';
import http from 'http';

process.env.TZ = config.constants.defaultTimezone;

// Plain HTTP only: nginx terminates HTTPS (certbot) and proxies to HOST:PORT. HOST defaults to 127.0.0.1,
// so the app can't be reached around nginx. app.ts trusts the proxy's X-Forwarded-* headers.
const server = http.createServer(app);

if (config.essentials.env === 'production' && !config.paypal.webhookId) {
  logger.warn('PAYPAL_WEBHOOK_ID is not set: every PayPal webhook is refused until it is (docs/OPERATIONS.md, "PayPal setup")');
}

server.listen(config.essentials.port, config.essentials.host, () => {
  logger.info(
    `Server is working fine 😊 & listening on ${config.essentials.host}:${config.essentials.port} (HTTP, HTTPS via nginx) | Default Timezone: ${process.env.TZ} | Current date and time: ${DateTime.now().toFormat('yyyy-MM-dd HH:mm:ss')}`
  );
});

// Job processing starts only in the server process (seed scripts never process jobs).
const agenda = getAgenda();
defineAllJobs(agenda);
startAgenda(agenda)
  .then(() => scheduleRecurringJobs(agenda))
  .catch((error: Error) => logger.error(`Agenda failed to start: ${error.message}`));

// Server exit operations
const exitHandler = async () => {
  await stopAgenda().catch((error: Error) => logger.error(`Agenda failed to stop: ${error.message}`));
  server.close(() => {
    logger.info('Server closed');
    process.exit(1);
  });
};

// Unexpected error handler
const unexpectedErrorHandler = (error: Error) => {
  logger.error(error);
  exitHandler();
};

process.on('uncaughtException', unexpectedErrorHandler);
process.on('unhandledRejection', unexpectedErrorHandler as unknown as NodeJS.RejectionHandledListener);
process.on('SIGTERM', exitHandler);
// pm2 stops and restarts processes with SIGINT (then SIGKILL after kill_timeout).
process.on('SIGINT', exitHandler);