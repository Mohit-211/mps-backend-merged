import dotenv from 'dotenv';
import path from 'path';
import Joi from 'joi';

// Load environment variables from ENV_FILE if set, else .env in the working directory (repo root)
dotenv.config({ path: process.env.ENV_FILE || path.resolve(process.cwd(), '.env') });

// Define the environment variables schema
const envVarsSchema = Joi.object({
	APP_NAME: Joi.string().required().description('Your Application Name'),
	SSL_ENABLE: Joi.boolean().required().valid(true, false).default(false),
	SSL_PATH: Joi.string().required().allow(''),
	NODE_ENV: Joi.string()
		.valid('production', 'development', 'test')
		.required(),
	PORT: Joi.number().default(5000),

	MONGODB_URL: Joi.string().required().description('Mongo DB url'),
	MONGODB_USER: Joi.string().required(),
	MONGODB_PASSWORD: Joi.string().required(),
	MONGODB_AUTH_SOURCE: Joi.string()
		.required()
		.description('Database holding the Mongo user (authSource)'),

	SMTP_HOST: Joi.string().description('server that will send the emails'),
	SMTP_PORT: Joi.number().description('port to connect to the email server'),
	SMTP_USERNAME: Joi.string().description('username for email server'),
	SMTP_PASSWORD: Joi.string().description('password for email server'),
	EMAIL_FROM: Joi.string().description(
		'the from field in the emails sent by the app',
	),

	SQUARE_ACCESS_TOKEN: Joi.string(),
	SQUARE_LOCATION_ID: Joi.string(),

	GOOGLE_PLACE_API_KEY: Joi.string().allow('').description('Places API key; optional until live testing'),

	PLACES_SEARCH_RADIUS_M: Joi.number().integer().min(1).max(50000).default(5000),
	RANK_MAX_KEYWORDS: Joi.number().integer().min(1).max(50).default(20),
	RANK_TRACKER_OFFSET_KM: Joi.number().min(0.1).max(20).default(1.5),
	RANK_DEV_MAX_KEYWORDS: Joi.number().integer().min(1).max(20).default(2),
	RANK_MAX_CALLS_PER_RUN: Joi.number().integer().min(1).default(3200),
	STORE_PLACE_NAMES: Joi.boolean().default(true),

	GOOGLE_GBP_CLIENT_ID: Joi.string().allow(''),
	GOOGLE_GBP_CLIENT_SECRET: Joi.string().allow(''),
	GOOGLE_GBP_REDIRECT_URI: Joi.string().allow(''),
	GBP_MAX_RPS: Joi.number().integer().min(1).max(10).default(5),
	PLACES_USER_DAILY_LIMIT: Joi.number().integer().min(0).default(50).description('User-triggered Places calls per user per UTC day'),
	REFRESH_MIN_INTERVAL_HOURS: Joi.number().min(0).default(24).description('Manual refresh: minimum hours between refreshes per location per type'),
	REFRESH_LOCAL_HOUR: Joi.number().integer().min(0).max(23).default(3).description('Local hour of the monthly automatic refresh'),
	GBP_V4_ENABLED: Joi.boolean().default(false).description('Google My Business v4 (reviews, media, posts) access approved'),
	GBP_BACKFILL_MONTHS: Joi.number().integer().min(1).max(18).default(18),
	GBP_ROLLING_DAYS: Joi.number().integer().min(7).max(90).default(40),
	GBP_KEYWORD_BACKFILL_MONTHS: Joi.number().integer().min(1).max(18).default(6),
	GBP_KEYWORD_ROLLING_MONTHS: Joi.number().integer().min(1).max(6).default(2),
	TOKEN_ENCRYPTION_KEY: Joi.string()
		.allow('')
		.pattern(/^[0-9a-fA-F]{64}$/)
		.when('NODE_ENV', { is: 'production', then: Joi.required().invalid('') })
		.description('32-byte hex key (AES-256-GCM) for stored OAuth tokens'),

	JWT_SECRET: Joi.string().required().description('JWT secret key'),
	JWT_ACCESS_EXPIRATION_DAYS: Joi.number()
		.default(7)
		.description('days after which access tokens expire'),
	JWT_REFRESH_EXPIRATION_DAYS: Joi.number()
		.default(30)
		.description('days after which refresh tokens expire'),

	DEFAULT_API_DATA_LIMIT: Joi.number().default(15),
	DEFAULT_ORDERING: Joi.string().valid('asc', 'desc').required(),
	DEFAULT_PAGE_NO: Joi.number().default(1),
	ACCESSDOMAINS: Joi.string().description(
		'All allow origin URL comma-separated',
	),
	API_BASE_URL: Joi.string().description('Base URL for APIs'),
	DEFAULT_TIMEZONE: Joi.string()
		.default('UTC')
		.description('Default Timezone for application'),

	SUP_ADM_ROLE_ID: Joi.number().description('Super Admin Role ID'),
	ADM_ROLE_ID: Joi.number().description('Admin Role ID'),
	EDTR_ROLE_ID: Joi.number().description('Editor Role ID'),
	USR_ROLE_ID: Joi.number().description('User Role ID'),

	SUPER_ADMIN_PASSWORD: Joi.string(),
	SUPER_ADMIN_EMAIL: Joi.string(),
}).unknown();

// Validate the environment variables
const { value: envVars, error } = envVarsSchema
	.prefs({ errors: { label: 'key' } })
	.validate(process.env);

if (error) {
	throw new Error(`Config validation error: ${error.message}`);
}

// Define the configuration object and its types
interface Config {
	essentials: {
		appName: string;
		sslEnabe: boolean;
		sslPath: string;
		env: string;
		port: number;
	};

	databases: {
		mongodb: {
			url: string;
			user: string;
			password: string;
			authSource: string;
		};
	};

	email: {
		smtp: {
			host?: string;
			port?: number;
			secure: boolean;
			requireTLS: boolean;
			auth: {
				user?: string;
				pass?: string;
			};
		};
		from?: string;
	};

	square: {
		squareAccessToken?: string;
		squareLocationId?: string;
	};

	googleApis: {
		placeApi: {
			keySecret?: string;
		};
	};

	ranking: {
		searchRadiusM: number;
		maxKeywords: number;
		trackerOffsetKm: number;
		devMaxKeywords: number;
		maxCallsPerRun: number;
		storePlaceNames: boolean;
		/** User-triggered Places calls (suggestions, manual search) per user per UTC day. */
		userDailyLimit: number;
	};

	gbp: {
		clientId?: string;
		clientSecret?: string;
		redirectUri?: string;
		maxRps: number;
		/** v4 (reviews, media, posts): false until Google approves access; those types are then not_available. */
		v4Enabled: boolean;
		backfillMonths: number;
		rollingDays: number;
		keywordBackfillMonths: number;
		keywordRollingMonths: number;
	};

	refresh: {
		/** Manual refresh: minimum hours between refreshes per location per type. */
		minIntervalHours: number;
		/** Local hour of the monthly automatic refresh. */
		localHour: number;
	};

	security: {
		/** Empty when unset (development/test): token encryption then throws on use. */
		tokenEncryptionKey: string;
	};

	constants: {
		jwt: {
			secret: string;
			accessExpirationDays: number;
			refreshExpirationDays: number;
		};
		accessDomains?: string;
		defaultLimit: number;
		defaultDataOrder: string;
		defaultPageNo: number;
		apiBaseUrl?: string;
		defaultTimezone: string;
	};

	roles: {
		superAdmin: number;
		admin: number;
		editor: number;
		user: number;
	};

	superAdmin: {
		password?: string;
		email?: string;
	};
}

// Export the configuration object
const config: Config = {
	essentials: {
		appName: envVars.APP_NAME,
		sslEnabe: envVars.SSL_ENABLE,
		sslPath: envVars.SSL_PATH,
		env: envVars.NODE_ENV,
		port: envVars.PORT,
	},

	databases: {
		mongodb: {
			url: envVars.MONGODB_URL,
			user: envVars.MONGODB_USER,
			password: envVars.MONGODB_PASSWORD,
			authSource: envVars.MONGODB_AUTH_SOURCE,
		},
	},

	email: {
		smtp: {
			host: envVars.SMTP_HOST,
			port: envVars.SMTP_PORT,
			secure: envVars.SMTP_PORT === 465, // If port is 465, secure is true
			requireTLS: envVars.SMTP_PORT !== 465, // If port is not 465, require TLS
			auth: {
				user: envVars.SMTP_USERNAME,
				pass: envVars.SMTP_PASSWORD,
			},
		},
		from: envVars.EMAIL_FROM,
	},

	square: {
		squareAccessToken: envVars.SQUARE_ACCESS_TOKEN,
		squareLocationId: envVars.SQUARE_LOCATION_ID,
	},

	googleApis: {
		placeApi: {
			keySecret: envVars.GOOGLE_PLACE_API_KEY,
		},
	},

	ranking: {
		searchRadiusM: envVars.PLACES_SEARCH_RADIUS_M,
		maxKeywords: envVars.RANK_MAX_KEYWORDS,
		trackerOffsetKm: envVars.RANK_TRACKER_OFFSET_KM,
		devMaxKeywords: envVars.RANK_DEV_MAX_KEYWORDS,
		maxCallsPerRun: envVars.RANK_MAX_CALLS_PER_RUN,
		storePlaceNames: envVars.STORE_PLACE_NAMES,
		userDailyLimit: envVars.PLACES_USER_DAILY_LIMIT,
	},

	gbp: {
		clientId: envVars.GOOGLE_GBP_CLIENT_ID,
		clientSecret: envVars.GOOGLE_GBP_CLIENT_SECRET,
		redirectUri: envVars.GOOGLE_GBP_REDIRECT_URI,
		maxRps: envVars.GBP_MAX_RPS,
		v4Enabled: envVars.GBP_V4_ENABLED,
		backfillMonths: envVars.GBP_BACKFILL_MONTHS,
		rollingDays: envVars.GBP_ROLLING_DAYS,
		keywordBackfillMonths: envVars.GBP_KEYWORD_BACKFILL_MONTHS,
		keywordRollingMonths: envVars.GBP_KEYWORD_ROLLING_MONTHS,
	},

	refresh: {
		minIntervalHours: envVars.REFRESH_MIN_INTERVAL_HOURS,
		localHour: envVars.REFRESH_LOCAL_HOUR,
	},

	security: {
		tokenEncryptionKey: envVars.TOKEN_ENCRYPTION_KEY ?? '',
	},

	constants: {
		jwt: {
			secret: envVars.JWT_SECRET,
			accessExpirationDays: envVars.JWT_ACCESS_EXPIRATION_DAYS,
			refreshExpirationDays: envVars.JWT_REFRESH_EXPIRATION_DAYS,
		},
		accessDomains: envVars.ACCESSDOMAINS,
		defaultLimit: envVars.DEFAULT_API_DATA_LIMIT,
		defaultDataOrder: envVars.DEFAULT_ORDERING,
		defaultPageNo: envVars.DEFAULT_PAGE_NO,
		apiBaseUrl: envVars.API_BASE_URL,
		defaultTimezone: envVars.DEFAULT_TIMEZONE,
	},

	roles: {
		superAdmin: envVars.SUP_ADM_ROLE_ID,
		admin: envVars.ADM_ROLE_ID,
		editor: envVars.EDTR_ROLE_ID,
		user: envVars.USR_ROLE_ID,
	},

	superAdmin: {
		password: envVars.SUPER_ADMIN_PASSWORD,
		email: envVars.SUPER_ADMIN_EMAIL,
	},
};

export default config;