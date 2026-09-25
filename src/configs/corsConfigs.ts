import { CorsOptions } from 'cors';
import { allowedOrigins } from '../utils';

const corsConfigs: CorsOptions = {
	origin: (origin, callback) => {
		if (allowedOrigins.indexOf(origin || '') !== -1 || !origin) {
			// remove ||!origin to block postman request
			callback(null, true);
		} else {
			callback(new Error('Origin not allowed by CORS'));
		}
	},
	credentials: true,
	optionsSuccessStatus: 200,
};

export default corsConfigs;
