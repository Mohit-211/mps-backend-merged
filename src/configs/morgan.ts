import morgan from 'morgan';
import config from './config';
import logger from './logger';
import { DateTime } from 'luxon';
import fs from 'fs';
import path from 'path';
import { Request, Response } from 'express';
const LOG_DIR = path.resolve(__dirname, process.env.NODE_ENV === 'development' ? '../../logs' : '../../../logs');

morgan.token('message', (req: Request, res: Response) => res.locals.message || 'No message available');

const getIpFormat = (): string => (config.essentials.env === 'production' ? ':remote-addr - ' : '');
const successResponseFormat = `${getIpFormat()}:method :url :status - :response-time ms - message: :message`;
const errorResponseFormat = `${getIpFormat()}:method :url :status - :response-time ms - message: :message`;

const createLogDirectory = (logsDir: string) => {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
};

const writeLog = (logsDir: string, logMessage: string) => {
  const currentTime = DateTime.now().toFormat('yyyy-MM-dd');
  const fileName = path.join(logsDir, `${currentTime}.log`);
  try {
    if (!fs.existsSync(fileName)) {
      // If the file does not exist, create it
      fs.writeFileSync(fileName, logMessage);
    } else {
      // If the file already exists, append the log message to it
      fs.appendFileSync(fileName, logMessage);
    }
  } catch (err) {
    logger.error('Error writing to file:', err);
  }
};

export const successHandler = morgan(successResponseFormat, {
  skip: (req: Request, res: Response) => res.statusCode >= 400,
  stream: {
    write: (message: string) => {
      const currentTime = DateTime.now().toISO();
      const logMessage = `${currentTime}<=>${message.trim()}\n`;
      const logsDir = LOG_DIR;
      createLogDirectory(logsDir);
      writeLog(logsDir, logMessage);
      logger.info(logMessage);
    },
  },
});

export const errorHandler = morgan(errorResponseFormat, {
  skip: (req: Request, res: Response) => res.statusCode < 400,
  stream: {
    write: (message: string) => {
      const currentTime = DateTime.now().toISO();
      const logMessage = `${currentTime}<=> Error ${message.trim()}\n`;
      const logsDir = LOG_DIR;
      createLogDirectory(logsDir);
      writeLog(logsDir, logMessage);
      logger.error(message.trim());
    },
  },
});