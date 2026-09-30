import dotenv from 'dotenv';
import path from 'path';
import Joi from 'joi';

// Load environment variables from ENV_FILE if set, else .env in the working directory (repo root)
dotenv.config({ path: process.env.ENV_FILE || path.resolve(process.cwd(), '.env') });

// Define the environment variables schema
const envVarsSchema = Joi.object({
	APP_NAME: Joi.string().required().description('Your Application Name'),
	NODE_ENV: Joi.string()
		.valid('production', 'development', 'test')
		.required(),
	PORT: Joi.number().default(5000),
	HOST: Joi.string().default('127.0.0.1').description('Interface to listen on. HTTPS is terminated by nginx, so the app only listens locally; 0.0.0.0 only inside a container'),

	MONGODB_URL: Joi.string().required().description('Mongo DB url'),
	MONGODB_USER: Joi.string().required(),
	MONGODB_PASSWORD: Joi.string().required(),
	MONGODB_AUTH_SOURCE: Joi.string()
		.required()
		.description('Database holding the Mongo user (authSource)'),
	MONGOOSE_DEBUG: Joi.boolean().default(false).description('Log every Mongoose query (development only)'),

	SMTP_HOST: Joi.string().description('server that will send the emails'),
	SMTP_PORT: Joi.number().description('port to connect to the email server'),
	SMTP_USERNAME: Joi.string().description('username for email server'),
	SMTP_PASSWORD: Joi.string().description('password for email server'),
	EMAIL_FROM: Joi.string().description(
		'the from field in the emails sent by the app',
	),
	EMAIL_TRANSPORT: Joi.string()
		.valid('smtp', 'log')
		.default((parent: { NODE_ENV?: string }) => (parent.NODE_ENV === 'production' ? 'smtp' : 'log'))
		.description('13b: smtp sends every email; log only logs it (recipient masked, link shown). Default: smtp in production, log elsewhere'),
	SUPPORT_EMAIL: Joi.string().email().allow('').default('').description('13b: the support inbox (contact-form and support-ticket notifications); empty = not sent'),


	GOOGLE_PLACE_API_KEY: Joi.string().allow('').description('Places API key; optional until live testing'),

	PLACES_SEARCH_RADIUS_M: Joi.number().integer().min(1).max(50000).default(5000),
	RANK_MAX_KEYWORDS: Joi.number().integer().min(1).max(50).default(20),
	RANK_TRACKER_OFFSET_KM: Joi.number().min(0.1).max(20).default(1.5),
	RANK_DEV_MAX_KEYWORDS: Joi.number().integer().min(1).max(20).default(2),
	RANK_MAX_CALLS_PER_RUN: Joi.number().integer().min(1).default(16000).description('IDs-only calls a single run may need (20 keywords × 7×7 × 3 pages × 5 samples = 15,900)'),
	RANK_SAMPLES_PER_POINT: Joi.number().integer().min(1).max(5).default(3).description('Searches per point per keyword; the point rank is their median (3: decided from the variance test, Mohit 2026-09-27)'),
	RANK_SAMPLE_SPACING_SEC: Joi.number().integer().min(0).max(1800).default(60).description('Minimum seconds between the samples of one point (60: decided from the variance test, Mohit 2026-09-27)'),
	RANK_SEARCH_CONCURRENCY: Joi.number().integer().min(1).max(8).default(4).description('Ranking searches in flight per run'),
	PLACES_MAX_QPS: Joi.number().integer().min(1).max(50).default(8).description('Places API requests per second across all processes (8 = 480/min, under the 600/min default quota)'),
	MAP_RANKING_POINTS: Joi.string().valid('all', 'center').default('all').description('Map Ranking (Pro search with names) at the 5 tracker points, or the center only'),
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
	INVITATION_TTL_DAYS: Joi.number().integer().min(1).max(30).default(7).description('Lifetime of team invitation links'),
	FRONTEND_URL: Joi.string().uri().allow('').default('').description('Base URL of the web app (invitation links, PayPal return URLs)'),
	PASSWORD_RESET_TTL_MINUTES: Joi.number().integer().min(5).max(1440).default(60).description('13b: lifetime of password-reset links (users and admins)'),
	ADMIN_FRONTEND_URL: Joi.string().uri().allow('').default('').description('13b: base URL of the admin panel (admin password links: /reset-password?token=…)'),
	ADMIN_SET_PASSWORD_TTL_HOURS: Joi.number().integer().min(1).max(336).default(72).description('13b: lifetime of the set-password link emailed to a new admin'),
	EMAIL_VERIFICATION_TTL_HOURS: Joi.number().integer().min(1).max(168).default(24).description('Phase 8.1: verification link lifetime; unverified signups are deleted after it'),
	REPORT_DEBOUNCE_SECONDS: Joi.number().integer().min(0).max(3600).default(120).description('GBP report: wait before generating, so a rank run and a sync finishing together give one report'),
	REPORTS_STORAGE_DIR: Joi.string().default('./storage/reports').description('Reports center (Phase 12): private directory for report PDFs and branding logos (never served statically)'),
	CITATION_STALE_DAYS: Joi.number().integer().min(1).max(730).default(90).description('Phase 16: citation entries not checked for this many days appear in the admin work queue'),
	REPORT_RETENTION_MONTHS: Joi.number().integer().min(1).max(120).default(24).description('Generated reports (PDF + snapshot) are deleted after this many months'),
	REPORT_RENDER_CONCURRENCY: Joi.number().integer().min(1).max(2).default(1).description('report-generate jobs at once per process'),
	REPORT_EMAIL_MAX_ATTACHMENT_MB: Joi.number().min(1).max(25).default(10).description('Larger report PDFs are emailed as a 30-day share link instead of an attachment'),
	SHARE_BASE_URL: Joi.string().uri().allow('').default('').description('Public base URL of this API for report share links (/r/<token>); empty = API_BASE_URL'),
	// Phase 13a billing: PayPal credentials (were read ad hoc via process.env), the two monthly plans, and settings.
	PAYPAL_MODE: Joi.string().valid('sandbox', 'live').default('sandbox'),
	PAYPAL_CLIENT_ID: Joi.string().allow('').default(''),
	PAYPAL_CLIENT_SECRET: Joi.string().allow('').default(''),
	PAYPAL_PRODUCT_ID: Joi.string().allow('').default(''),
	PAYPAL_PLAN_ID_USD: Joi.string().allow('').default(''),
	PAYPAL_PLAN_ID_CAD: Joi.string().allow('').default(''),
	BILLING_GRACE_DAYS: Joi.number().integer().min(0).max(60).default(7),
	MANUAL_INVOICE_DUE_DAYS: Joi.number().integer().min(1).max(90).default(14),
	PAYPAL_PRICE_CHANGE_LEAD_DAYS: Joi.number().integer().min(11).max(28).default(11).description('PayPal ignores price changes within 10 days of a charge: the renewal amount is fixed this many days ahead'),
	BILLING_SELLER_NAME: Joi.string().allow('').default('MyPageSEO'),
	BILLING_SELLER_ADDRESS: Joi.string().allow('').default(''),
	BILLING_SELLER_EMAIL: Joi.string().allow('').default(''),
	BILLING_SELLER_TAX_ID: Joi.string().allow('').default(''),
	PAYPAL_WEBHOOK_ID: Joi.string()
		.allow('')
		.default('')
		.description('Phase 10: PayPal webhook id; every webhook is verified with PayPal, and refused while this is empty (a startup warning in production: the id exists only after the webhook is created)'),
	TRUST_PROXY_HOPS: Joi.number().integer().min(0).max(5).default(1).description('Phase 10: reverse proxies in front of the app (nginx = 1), so req.ip is the client'),
	TOKEN_ENCRYPTION_KEY: Joi.string()
		.allow('')
		.pattern(/^[0-9a-fA-F]{64}$/)
		.when('NODE_ENV', { is: 'production', then: Joi.required().invalid('') })
		.description('32-byte hex key (AES-256-GCM) for stored OAuth tokens'),

	JWT_SECRET: Joi.string()
		.required()
		.when('NODE_ENV', { is: 'production', then: Joi.string().min(32) })
		.description('JWT secret for user tokens (Phase 10: at least 32 characters in production)'),
	ADMIN_JWT_SECRET: Joi.string()
		.allow('')
		.when('NODE_ENV', { is: 'production', then: Joi.string().min(32).required().invalid('', Joi.ref('JWT_SECRET')) })
		.description('Phase 10: separate secret for admin tokens (required in production, ≥ 32 characters, not JWT_SECRET)'),
	JWT_ACCESS_EXPIRATION_DAYS: Joi.number()
		.default(1) // Phase 10 (AUDIT S24): was 7; refresh tokens stay 30 days
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

	SUPER_ADMIN_PASSWORD: Joi.string().allow('').default(''),
	SUPER_ADMIN_EMAIL: Joi.string().allow('').default(''),
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
		env: string;
		port: number;
		host: string;
	};

	databases: {
		mongodb: {
			url: string;
			user: string;
			password: string;
			authSource: string;
			/** Requested query logging; applied only in development (see mongooseDebug.ts). */
			debug: boolean;
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
		/** 13b: 'smtp' sends every email; 'log' only logs it (recipient masked, link shown). */
		transport: 'smtp' | 'log';
		/** 13b: the support inbox for contact-form and support-ticket notifications ('' = none). */
		supportInbox: string;
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
		/** Phase 12.5: searches per point (median), spacing between them, search concurrency per run. */
		samplesPerPoint: number;
		sampleSpacingSec: number;
		searchConcurrency: number;
		/** Places requests per second across the cluster (MongoDB limiter). */
		placesMaxQps: number;
		mapRankingPoints: 'all' | 'center';
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

	auth: {
		passwordResetTtlMinutes: number;
		adminFrontendUrl: string;
		adminSetPasswordTtlHours: number;
		/** Phase 8.1: verification link lifetime and the unverified-account deadline, in hours. */
		emailVerificationTtlHours: number;
		/** Team invitation lifetime in days (Phase 11). */
		invitationTtlDays: number;
		/** Base URL of the web app, for links in emails. */
		frontendUrl: string;
	};

	report: {
		/** Seconds between a report request and its generation (deduplicates close triggers). */
		debounceSeconds: number;
	};

	citations: {
		/** Phase 16: default N of the admin "not checked in N days" queue. */
		staleDays: number;
	};

	paypal: {
		/** Phase 10: webhook signature verification; empty = every webhook is refused. */
		webhookId: string;
		mode: 'sandbox' | 'live';
		clientId: string;
		clientSecret: string;
		productId: string;
		planIds: { USD: string; CAD: string };
		/** The renewal amount is fixed (and PATCHed) this many days before a renewal. */
		renewalLeadDays: number;
	};

	billing: {
		graceDays: number;
		manualInvoiceDueDays: number;
		seller: { name: string; address: string; email: string; taxId: string };
	};

	reports: {
		/** Absolute path of the private reports directory (PDFs, branding logos). */
		storageDir: string;
		retentionMonths: number;
		renderConcurrency: number;
		maxAttachmentBytes: number;
		/** Base URL for /r/<token> share links. */
		shareBaseUrl: string;
	};

	security: {
		/** Empty when unset (development/test): token encryption then throws on use. */
		tokenEncryptionKey: string;
		/** Phase 10: `trust proxy` hops and the JSON / urlencoded body limit. */
		trustProxyHops: number;
		bodyLimit: string;
	};

	constants: {
		jwt: {
			secret: string;
			/** Phase 10: admin token key; empty in development/test (derived from JWT_SECRET there). */
			adminSecret: string;
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
		env: envVars.NODE_ENV,
		port: envVars.PORT,
		host: envVars.HOST,
	},

	databases: {
		mongodb: {
			url: envVars.MONGODB_URL,
			user: envVars.MONGODB_USER,
			password: envVars.MONGODB_PASSWORD,
			authSource: envVars.MONGODB_AUTH_SOURCE,
			debug: envVars.MONGOOSE_DEBUG,
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
		transport: envVars.EMAIL_TRANSPORT,
		supportInbox: envVars.SUPPORT_EMAIL,
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
		samplesPerPoint: envVars.RANK_SAMPLES_PER_POINT,
		sampleSpacingSec: envVars.RANK_SAMPLE_SPACING_SEC,
		searchConcurrency: envVars.RANK_SEARCH_CONCURRENCY,
		placesMaxQps: envVars.PLACES_MAX_QPS,
		mapRankingPoints: envVars.MAP_RANKING_POINTS,
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

	auth: {
		passwordResetTtlMinutes: envVars.PASSWORD_RESET_TTL_MINUTES,
		adminFrontendUrl: envVars.ADMIN_FRONTEND_URL ?? '',
		adminSetPasswordTtlHours: envVars.ADMIN_SET_PASSWORD_TTL_HOURS,
		emailVerificationTtlHours: envVars.EMAIL_VERIFICATION_TTL_HOURS,
		invitationTtlDays: envVars.INVITATION_TTL_DAYS,
		frontendUrl: envVars.FRONTEND_URL ?? '',
	},

	report: {
		debounceSeconds: envVars.REPORT_DEBOUNCE_SECONDS,
	},

	citations: {
		staleDays: envVars.CITATION_STALE_DAYS,
	},

	paypal: {
		webhookId: envVars.PAYPAL_WEBHOOK_ID ?? '',
		mode: envVars.PAYPAL_MODE,
		clientId: envVars.PAYPAL_CLIENT_ID,
		clientSecret: envVars.PAYPAL_CLIENT_SECRET,
		productId: envVars.PAYPAL_PRODUCT_ID,
		planIds: { USD: envVars.PAYPAL_PLAN_ID_USD, CAD: envVars.PAYPAL_PLAN_ID_CAD },
		renewalLeadDays: envVars.PAYPAL_PRICE_CHANGE_LEAD_DAYS,
	},

	billing: {
		graceDays: envVars.BILLING_GRACE_DAYS,
		manualInvoiceDueDays: envVars.MANUAL_INVOICE_DUE_DAYS,
		seller: { name: envVars.BILLING_SELLER_NAME, address: envVars.BILLING_SELLER_ADDRESS, email: envVars.BILLING_SELLER_EMAIL, taxId: envVars.BILLING_SELLER_TAX_ID },
	},

	reports: {
		storageDir: path.resolve(process.cwd(), envVars.REPORTS_STORAGE_DIR),
		retentionMonths: envVars.REPORT_RETENTION_MONTHS,
		renderConcurrency: envVars.REPORT_RENDER_CONCURRENCY,
		maxAttachmentBytes: Math.round(envVars.REPORT_EMAIL_MAX_ATTACHMENT_MB * 1024 * 1024),
		shareBaseUrl: (envVars.SHARE_BASE_URL || envVars.API_BASE_URL || `http://localhost:${envVars.PORT}`).replace(/\/$/, ''),
	},

	security: {
		tokenEncryptionKey: envVars.TOKEN_ENCRYPTION_KEY ?? '',
		trustProxyHops: envVars.TRUST_PROXY_HOPS,
		bodyLimit: '1mb',
	},

	constants: {
		jwt: {
			secret: envVars.JWT_SECRET,
			adminSecret: envVars.ADMIN_JWT_SECRET ?? '',
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