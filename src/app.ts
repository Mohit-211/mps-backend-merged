import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import httpStatus from 'http-status';
import cron from 'node-cron';
import NodeCache from 'node-cache';
import path from 'path';
import fs from 'fs';
import { DateTime } from 'luxon';
import requestIp from 'request-ip';
import swaggerUi from 'swagger-ui-express';

import swaggerDocument from '../swagger.json';
import config from './configs/config';
import corsConfigs from './configs/corsConfigs';
import { successHandler, errorHandler } from './configs/morgan';
import upload from './configs/multer';
import logger from './configs/logger';
import {
	ApiError,
	apiErrorHandler,
	responseWrapper,
	authLimiter,
	credentials,
	getQueryParams,
	handleImageCompression,
} from './utils';
import routes from './routes/v1';
import { queryTypesArr } from './configs/constantTypes';

const app = express();
const myCache = new NodeCache({ stdTTL: 100, checkperiod: 120 });
const PUBLIC_DIR = path.resolve(
	__dirname,
	process.env.NODE_ENV === 'development' ? '../public' : '../../public',
);
const LOG_DIR = path.resolve(
	__dirname,
	process.env.NODE_ENV === 'development' ? '../logs' : '../../logs',
);

// Initialize MongoDB connection
import('./configs/mongoConnection');

// Initialize mysql connection
// import('./configs/mySqlConnection');

cron.schedule('* * * * *', () => {
	logger.info('Hello, I am still running.......😊');
});

// set security HTTP headers
app.use(
	helmet.contentSecurityPolicy({
		useDefaults: true,
		directives: {
			'img-src': [
				"'self' data:",
				'*.google-analytics.com',
				'*.vimeocdn.com',
			],
			'script-src': [
				"'self'",
				'*.polyfill.io',
				"'unsafe-eval'",
				"'unsafe-inline'",
			],
			'default-src': [
				"'self'",
				'*.google-analytics.com',
				'*.gstatic.com',
				'*.googleapis.com',
				'vimeo.com',
				'*.vimeo.com',
			],
		},
	}),
);

// parse json request body
app.use(express.json({ limit: '100mb' }));
// parse urlencoded request body
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(requestIp.mw());

// gzip compression
app.use(compression());

if (config.essentials.env !== 'test') {
	app.use(successHandler);
	app.use(errorHandler);
}

// Validate Query Parameters
app.use(getQueryParams(queryTypesArr));

app.use(
	express.static(PUBLIC_DIR, {
		maxAge: '1d',
		etag: false,
		lastModified: true,
	}),
);

process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '1';

app.use((req: Request, res: Response, next: NextFunction) => {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', '*');
	res.setHeader('Access-Control-Allow-Headers', '*');
	res.removeHeader('Cross-Origin-Embedder-Policy');
	next();
});

app.use(credentials);
app.use(cors(corsConfigs));

// limit repeated failed requests to auth endpoints
if (config.essentials.env === 'production') {
	app.use('/v1/auth', authLimiter);
}

app.get('/api/healthcheck', (req: Request, res: Response) => {
	const data = { response: 'ok' };
	res.status(200).send(data);
});

app.get('/ping', (req: Request, res: Response) => {
	res.status(200).send('Hello World !! pong 😊 pong 😊');
});

// Added multer with all v1 api routes
app.use('/api/v1', upload, handleImageCompression, routes);

app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.get('/api/v1/logs', (req, res) => {
	const currentDate = DateTime.now().toFormat('yyyy-MM-dd');
	const logFileName = `${currentDate}.log`;
	const logFilePath = path.join(LOG_DIR, logFileName);
	fs.readFile(logFilePath, 'utf8', (err, data) => {
		if (err) {
			return responseWrapper(res, [], 'success');
		} else {
			const logs = data.split('\n');
			res.setHeader('Cache-Control', 'public, max-age=3600');
			return responseWrapper(res, logs, 'success');
		}
	});
});

app.delete('/api/v1/logs', async (req: Request, res: Response) => {
	const logDirectory = LOG_DIR;
	fs.readdir(logDirectory, async (err, files) => {
		if (err) {
			return responseWrapper(res, '', 'Error reading log directory', 400);
		} else {
			files.forEach((file) => {
				if (file.endsWith('.log')) {
					fs.unlink(path.join(logDirectory, file), (err) => {
						if (err) {
							return responseWrapper(
								res,
								'',
								'Error deleting log file',
								400,
							);
						}
					});
				}
			});
			return responseWrapper(
				res,
				'',
				'All log files deleted successfully',
			);
		}
	});
});


// All File Apis
const fileApis = ['images', 'videos', 'gifs', 'docs', 'songs'];
fileApis.forEach((api) => {
	app.get(`/${api}/:filename`, (req: Request, res: Response) => {
		const filename = req.params.filename;
		const cachedFile = myCache.get(filename);
		
		if (cachedFile) {
		  return res.sendFile(cachedFile as string); // Cast to string
		} else {
		  const filePath = path.join(PUBLIC_DIR, 'uploads', api, filename);
		  fs.stat(filePath, (err, stat) => {
			if (err || !stat.isFile()) {
			  const defaultImage = path.join(PUBLIC_DIR, 'assets', '404file.jpg');
			  res.sendFile(defaultImage);
			} else {
			  myCache.set(filename, filePath);
			  res.sendFile(filePath);
			}
		  });
		}
	  });
});

// send back a 404 error for any unknown api request
app.use((req: Request, res: Response, next: NextFunction) => {
	next(
		new ApiError(
			httpStatus.NOT_FOUND,
			'Oops! The endpoint you are looking for is not available.',
		),
	);
});

// error handling
app.use(apiErrorHandler);

export default app;