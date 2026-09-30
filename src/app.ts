import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import httpStatus from 'http-status';
import NodeCache from 'node-cache';
import path from 'path';
import fs from 'fs';
import requestIp from 'request-ip';

import config from './configs/config';
import corsConfigs from './configs/corsConfigs';
import { successHandler, errorHandler } from './configs/morgan';
import { multipartFieldsOnly } from './configs/multer';
import { ApiError, apiErrorHandler, credentials, getQueryParams } from './utils';
import routes from './routes/v1';
import devConnectRoutes from './routes/dev/devConnect.route';
import shareRoutes from './routes/share.route';
import { usageScope } from './services/usage/scope';
import { sanitizeRequest } from './middlewares/common/sanitizeRequest';
import { queryTypesArr } from './configs/constantTypes';

const app = express();
const myCache = new NodeCache({ stdTTL: 100, checkperiod: 120 });
const PUBLIC_DIR = path.resolve(
	__dirname,
	process.env.NODE_ENV === 'development' ? '../public' : '../../public',
);

// Initialize MongoDB connection
import('./configs/mongoConnection');



// Phase 10 (AUDIT S5): HTTPS is terminated by nginx, which proxies plain HTTP to this app on 127.0.0.1
// (src/server.ts). Trusting TRUST_PROXY_HOPS proxies makes req.ip the client (rate limits, logs) and
// req.protocol "https" from X-Forwarded-Proto. helmet's HSTS header reaches the browser through nginx.
app.set('trust proxy', config.security.trustProxyHops);

// Phase 10 (AUDIT S9): every helmet header, with a strict CSP (no polyfill.io, no unsafe-eval). The API
// serves JSON only (13b: Swagger UI removed, so no inline styles are needed). Uploaded images are embedded by the web app
// on another origin, so resources may be loaded cross-origin. Routes with their own CSP (/r, /dev) override it.
app.use(
	helmet({
		contentSecurityPolicy: {
			useDefaults: true,
			directives: {
				'default-src': ["'self'"],
				'script-src': ["'self'"],
				'style-src': ["'self'"],
				'img-src': ["'self'", 'data:'],
				'frame-ancestors': ["'none'"],
			},
		},
		crossOriginResourcePolicy: { policy: 'cross-origin' },
	}),
);

// parse json request body
// Phase 10 (AUDIT S10): 1 MB bodies (the largest legitimate one is a ~700 KB base64 logo).
app.use(express.json({ limit: config.security.bodyLimit }));
// parse urlencoded request body
app.use(express.urlencoded({ limit: config.security.bodyLimit, extended: true }));
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

// Phase 10 (AUDIT S8): no wildcard CORS; the ACCESSDOMAINS allowlist below is the only CORS policy.
app.use(credentials);
app.use(cors(corsConfigs));

// Phase 10 (AUDIT S5): the old limiter was mounted on '/v1/auth' (no such path). Sign-in, OTP and
// reset endpoints are rate-limited per email / IP in their services (Mongo counters, cluster-wide).

app.get('/api/healthcheck', (req: Request, res: Response) => {
	const data = { response: 'ok' };
	res.status(200).send(data);
});

app.get('/ping', (req: Request, res: Response) => {
	res.status(200).send('Hello World !! pong 😊 pong 😊');
});

// Phase 10 (AUDIT S7): no global file uploads. Multipart requests get their text fields parsed here
// (files refused), except on the few upload routes, which parse files after authentication.
app.use('/api/v1', usageScope, multipartFieldsOnly, sanitizeRequest, routes);

// Phase 12: public report share links (/r/<token>), outside /api/v1 and without multer.
app.use('/r', shareRoutes);

// Development-only helper pages (never mounted in test or production); listed in docs/ENDPOINTS.md.
if (config.essentials.env === 'development') {
	app.use('/dev', devConnectRoutes);
}

// All File Apis. Phase 10 (AUDIT S16): the name is reduced to its basename and must resolve inside its
// folder (no ../ traversal); the cache is keyed by folder + name.
const fileApis = ['images', 'videos'];
fileApis.forEach((api) => {
	const folder = path.join(PUBLIC_DIR, 'uploads', api);
	app.get(`/${api}/:filename`, (req: Request, res: Response) => {
		const notFound = () =>
			res.status(httpStatus.NOT_FOUND).sendFile(path.join(PUBLIC_DIR, 'assets', '404file.jpg'), (err) => {
				if (err && !res.headersSent) res.status(httpStatus.NOT_FOUND).end();
			});
		const filename = path.basename(req.params.filename);
		const filePath = path.resolve(folder, filename);
		if (filename !== req.params.filename || !filePath.startsWith(folder + path.sep)) return notFound();
		const cacheKey = `${api}/${filename}`;
		const cachedFile = myCache.get<string>(cacheKey);
		if (cachedFile) return res.sendFile(cachedFile);
		fs.stat(filePath, (err, stat) => {
			if (err || !stat.isFile()) return notFound();
			myCache.set(cacheKey, filePath);
			return res.sendFile(filePath);
		});
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