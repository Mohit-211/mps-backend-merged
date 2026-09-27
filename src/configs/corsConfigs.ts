import { CorsOptions } from 'cors';
import { allowedOrigins } from '../utils';

const corsConfigs: CorsOptions = {
	origin: (origin, callback) => {
		if (allowedOrigins.indexOf(origin || '') !== -1 || !origin) {
			// remove ||!origin to block postman request
			callback(null, true);
		} else {
			// Phase 10: an unknown origin gets no CORS headers (the browser blocks it), not a 500 error.
			callback(null, false);
		}
	},
	credentials: true,
	optionsSuccessStatus: 200,
};

export default corsConfigs;
