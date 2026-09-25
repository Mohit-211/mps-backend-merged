/* eslint-disable @typescript-eslint/no-explicit-any */
import winston from 'winston';
import config from './config';

const enumerateErrorFormat = winston.format((info: any) => {
  if (info instanceof Error) {
    Object.assign(info, { message: info.message });
  }
  return info;
});

const logger = winston.createLogger({
  level: config.essentials.env === 'development' ? 'debug' : 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    enumerateErrorFormat(),
    config.essentials.env === 'development' ? winston.format.colorize() : winston.format.uncolorize(),
    winston.format.splat(),
    winston.format.printf(({ level, message, timestamp }) => `${timestamp} ${level}: ${message}`)
  ),
  transports: [
    new winston.transports.Console({
      stderrLevels: ['error'],
    }),
  ],
});

export default logger;
