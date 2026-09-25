import mongoose from 'mongoose';
import config from './config';
import logger from './logger';
import Agenda from 'agenda';
import { defineAgendaJobs } from '../jobs/postToGbp';

export let agenda: Agenda;

// Connect to MongoDB with enhanced security settings
// mongoose.connect(`${config.databases.mongodb.url}?authSource=${config.databases.mongodb.user}`, {
//   user: config.databases.mongodb.user,
//   pass: config.databases.mongodb.password,

mongoose.connect(`${config.databases.mongodb.url}`, {
  user: config.databases.mongodb.user,
  pass: config.databases.mongodb.password,
  authSource: 'mps_db',
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

mongoose.connection.once('open', async () => {
  try {
    logger.info('✅ Mongoose connection opened successfully.');

        agenda = new Agenda({
      mongo: mongoose.connection.db as any,
    });

    agenda.on('ready', async () => {
      logger.info('✅ Agenda connected and ready.');
    });

    agenda.processEvery('1 minute');

    // Define your jobs
    defineAgendaJobs();

    // Start processing jobs
    await agenda.start();
    logger.info('🚀 Agenda has started and is processing jobs.');
  } catch (err) {
    logger.error('❌ Failed to initialize Agenda:', err);
  }
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
    if (agenda) {
      await agenda.stop();
    }
    await mongoose.connection.close();
    logger.warn('Mongo connection is disconnected due to application termination');
    process.exit(0);
  } catch (err) {
    console.error('Error closing MongoDB connection:', err);
    process.exit(1);
  }
});