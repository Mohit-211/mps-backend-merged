/* eslint-disable @typescript-eslint/no-unused-vars */
import app from './app';
import { DateTime } from 'luxon';
import config from './configs/config';
import logger from './configs/logger';
import http from 'http';
import https from 'https';
import fs from 'fs';

process.env.TZ = config.constants.defaultTimezone;
let server: http.Server | https.Server;
if(config.essentials.sslEnabe){
  const httpsOptions = {
    key: fs.readFileSync(`${config.essentials.sslPath}ssl.key`),
    cert: fs.readFileSync(`${config.essentials.sslPath}ssl.cert`),
    ca: fs.readFileSync(`${config.essentials.sslPath}ssl.ca`),
  };
  server = https.createServer(httpsOptions, app);
}else{
  server = http.createServer(app);
}

// Get the current date and time
const currentTime = DateTime.now();
server.listen(config.essentials.port, '0.0.0.0',() => {
  logger.info(
    `Server is working fine 😊 & listening on PORT: ${config.essentials.port} | SSL status ${config.essentials.sslEnabe} | Default Timezone: ${process.env.TZ} | Current date and time: ${currentTime.toFormat('yyyy-MM-dd HH:mm:ss')}`
  );
});

// Server exit operations
const exitHandler = () => {
  if (server) {
    server.close(() => {
      logger.info('Server closed');
      process.exit(1);
    });
  } else {
    process.exit(1);
  }
};

// Unexpected error handler
const unexpectedErrorHandler = (error: Error) => {
  logger.error(error);
  exitHandler();
};

process.on('uncaughtException', unexpectedErrorHandler);
process.on('unhandledRejection', unexpectedErrorHandler as unknown as NodeJS.RejectionHandledListener);
process.on('SIGTERM', exitHandler);