import mongoose from 'mongoose';
import config from './config';
import logger from './logger';
import { getAgenda, stopAgenda } from './agenda';

// Agenda has its own connection and is started by src/server.ts (see configs/agenda.ts).
// Re-exported here so existing imports (gbpPostSchedular.service) keep working.
export const agenda = getAgenda();

// Connect to MongoDB with enhanced security settings
// mongoose.connect(`${config.databases.mongodb.url}?authSource=${config.databases.mongodb.user}`, {
//   user: config.databases.mongodb.user,
//   pass: config.databases.mongodb.password,

mongoose.connect(`${config.databases.mongodb.url}`, {
  user: config.databases.mongodb.user,
  pass: config.databases.mongodb.password,
  authSource: config.databases.mongodb.authSource,
  maxPoolSize: 10,
  socketTimeoutMS: 4500000,
  family: 4,
  serverSelectionTimeoutMS: 300000,
});
// Enable query logging
mongoose.set('debug', true);

// MongoDB connection event handlers
mongoose.connection.on('connected', () => {
  logger.info('Mongo has connected successfully 😊');
});

mongoose.connection.once('open', () => {
  logger.info('✅ Mongoose connection opened successfully.');
});

mongoose.connection.on('reconnected', () => {
  logger.info('Mongo has reconnected 😊');
});

mongoose.connection.on('error', (error) => {
  logger.warn('Mongo connection has an error', error);
  mongoose.disconnect();
});

mongoose.connection.on('disconnected', () => {
  logger.warn('Mongo connection is disconnected 🥺');
});

// Handle Node.js process termination to close MongoDB connection
process.on('SIGINT', async () => {
  try {
    await stopAgenda();
    await mongoose.connection.close();
    logger.warn('Mongo connection is disconnected due to application termination');
    process.exit(0);
  } catch (err) {
    console.error('Error closing MongoDB connection:', err);
    process.exit(1);
  }
});