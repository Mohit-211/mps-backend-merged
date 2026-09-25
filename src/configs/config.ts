import dotenv from 'dotenv';
import path from 'path';
import Joi from 'joi';

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, '../../.env') });

// Define the environment variables schema
const envVarsSchema = Joi.object({
	APP_NAME: Joi.string().required().description('Your Application Name'),
	SSL_ENABLE: Joi.boolean().required().valid(true, false).default(false),
	SSL_PATH: Joi.string().required().allow(''),
	NODE_ENV: Joi.string()
		.valid('production', 'development', 'test')
		.required(),
	PORT: Joi.number().default(5000),
	APPLY_ENCRYPTION: Joi.boolean()
		.required()
		.valid(true, false)
		.default(false),
	SECRET_KEY: Joi.string().required(),

	MONGODB_URL: Joi.string().required().description('Mongo DB url'),
	MONGODB_USER: Joi.string().required(),
	MONGODB_PASSWORD: Joi.string().required(),

	SMTP_HOST: Joi.string().description('server that will send the emails'),
	SMTP_PORT: Joi.number().description('port to connect to the email server'),
	SMTP_USERNAME: Joi.string().description('username for email server'),
	SMTP_PASSWORD: Joi.string().description('password for email server'),
	EMAIL_FROM: Joi.string().description(
		'the from field in the emails sent by the app',
	),

	STRIPE_PUBLISHABLE_KEY: Joi.string().description(
		'Stripe Secret Credential',
	),
	STRIPE_SECRET_KEY: Joi.string().description('Stripe Secret Credential'),
	STRIPE_WEBHOOK_SECRET_INTENT_CHARGE: Joi.string().description(
		'Stripe Secret Credential',
	),
	STRIPE_WEBHOOK_SECRET_CUSTOMER_INVOICE_PRICE: Joi.string().description(
		'Stripe Secret Credential',
	),

	RAZORPAY_KEY_ID: Joi.string(),
	RAZORPAY_KEY_SECRET: Joi.string(),

	SQUARE_APPLICATION_ID: Joi.string(),
	SQUARE_ACCESS_TOKEN: Joi.string(),
	SQUARE_LOCATION_ID: Joi.string(),
	SQUARE_ENV: Joi.string(),

	GOOGLE_PLACE_API_KEY: Joi.string(),
	GOOGLE_PLACE_API_URL: Joi.string(),

	SERP_API_KEY: Joi.string(),
	SERP_API_TIMEOUT: Joi.number(),

	SEO_MOZ_API_USERNAME: Joi.string(),
	SEO_MOZ_API_PASSWORD: Joi.string(),
	SEO_MOZ_API_KEY: Joi.string(),

	COMPANY_SUPPORT_EMAIL: Joi.string().required(),
	COMPANY_NAME: Joi.string().required(),
	COMPANY_CITY: Joi.string().required(),
	COMPANY_STATE: Joi.string().required(),
	COMPANY_COUNTRY: Joi.string().required(),
	COMAPNY_ADDRESS: Joi.string().required(),

	JWT_SECRET: Joi.string().required().description('JWT secret key'),
	JWT_ACCESS_EXPIRATION_DAYS: Joi.number()
		.default(7)
		.description('days after which access tokens expire'),
	JWT_REFRESH_EXPIRATION_DAYS: Joi.number()
		.default(30)
		.description('days after which refresh tokens expire'),
	JWT_RESET_PASSWORD_EXPIRATION_MINUTES: Joi.number()
		.default(10)
		.description('minutes after which reset password token expires'),
	JWT_VERIFY_EMAIL_EXPIRATION_MINUTES: Joi.number()
		.default(10)
		.description('minutes after which verify email token expires'),

	DEFAULT_API_DATA_LIMIT: Joi.number().default(15),
	DEFAULT_ORDERING: Joi.string().valid('asc', 'desc').required(),
	DEFAULT_PAGE_NO: Joi.number().default(1),
	ACCESSDOMAINS: Joi.string().description(
		'All allow origin URL comma-separated',
	),
	API_BASE_URL: Joi.string().description('Base URL for APIs'),
	ADMIN_BASE_URL: Joi.string().description('Base URL for Admin APIs'),
	DEFAULT_TIMEZONE: Joi.string()
		.default('UTC')
		.description('Default Timezone for application'),

	SUP_ADM_ROLE_ID: Joi.number().description('Super Admin Role ID'),
	ADM_ROLE_ID: Joi.number().description('Admin Role ID'),
	ENG_ROLE_ID: Joi.number(),
	EDTR_ROLE_ID: Joi.number().description('Editor Role ID'),
	FIN_ROLE_ID: Joi.number(),
	MRK_ROLE_ID: Joi.number(),
	HR_ROLE_ID: Joi.number(),
	SALES_ROLE_ID: Joi.number(),
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
		applyEncryption: boolean;
		secretCode: string;
	};

	databases: {
		mongodb: {
			url: string;
			user: string;
			password: string;
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

	stripe: {
		publishableKey?: string;
		secretKey?: string;
		webhookSecretIntentCharge?: string;
		webhookSecretCustomerInvoicePrice?: string;
	};

	square: {
		squareApplicationId?: string;
		squareAccessToken?: string;
		squareLocationId?: string;
		squareEnv?: string;
	};

	razorpay: {
		keyId?: string;
		keySecret?: string;
	};

	seoMOZApis: {
		username?: string;
		password?: string;
		keySecret?: string;
	};

	serpApis: {
		keySecret?: string;
		timeout?: number;
	};

	googleApis: {
		placeApi: {
			url?: string;
			keySecret?: string;
		};
	};

	company: {
		email: string;
		name: string;
		city: string;
		state: string;
		country: string;
		address: string;
	};

	constants: {
		jwt: {
			secret: string;
			accessExpirationDays: number;
			refreshExpirationDays: number;
			resetPasswordExpirationMinutes: number;
			verifyEmailExpirationMinutes: number;
		};
		accessDomains?: string;
		defaultLimit: number;
		defaultDataOrder: string;
		defaultPageNo: number;
		apiBaseUrl?: string;
		adminBaseUrl?: string;
		defaultTimezone: string;
	};

	roles: {
		superAdmin: number;
		admin: number;
		engineer: number;
		editor: number;
		finance: number;
		marketing: number;
		hr: number;
		sales: number;
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
		applyEncryption: envVars.APPLY_ENCRYPTION,
		secretCode: envVars.SECRET_KEY,
	},

	databases: {
		mongodb: {
			url: envVars.MONGODB_URL,
			user: envVars.MONGODB_USER,
			password: envVars.MONGODB_PASSWORD,
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

	stripe: {
		publishableKey: envVars.STRIPE_PUBLISHABLE_KEY,
		secretKey: envVars.STRIPE_SECRET_KEY,
		webhookSecretIntentCharge: envVars.STRIPE_WEBHOOK_SECRET_INTENT_CHARGE,
		webhookSecretCustomerInvoicePrice:
			envVars.STRIPE_WEBHOOK_SECRET_CUSTOMER_INVOICE_PRICE,
	},

	square: {
		squareApplicationId: envVars.SQUARE_APPLICATION_ID,
		squareAccessToken: envVars.SQUARE_ACCESS_TOKEN,
		squareLocationId: envVars.SQUARE_LOCATION_ID,
		squareEnv: envVars.SQUARE_ENV,
	},

	razorpay: {
		keyId: envVars.RAZORPAY_KEY_ID,
		keySecret: envVars.RAZORPAY_KEY_SECRET,
	},

	googleApis: {
		placeApi: {
			url: envVars.GOOGLE_PLACE_API_URL,
			keySecret: envVars.GOOGLE_PLACE_API_KEY,
		},
	},

	seoMOZApis: {
		username: envVars.SEO_MOZ_API_USERNAME,
		password: envVars.SEO_MOZ_API_PASSWORD,
		keySecret: envVars.SEO_MOZ_API_KEY,
	},

	serpApis: {
		keySecret: envVars.SERP_API_KEY,
		timeout: envVars.SERP_API_TIMEOUT,
	},

	company: {
		email: envVars.COMPANY_SUPPORT_EMAIL,
		name: envVars.COMPANY_NAME,
		city: envVars.COMPANY_CITY,
		state: envVars.COMPANY_STATE,
		country: envVars.COMPANY_COUNTRY,
		address: envVars.COMAPNY_ADDRESS,
	},

	constants: {
		jwt: {
			secret: envVars.JWT_SECRET,
			accessExpirationDays: envVars.JWT_ACCESS_EXPIRATION_DAYS,
			refreshExpirationDays: envVars.JWT_REFRESH_EXPIRATION_DAYS,
			resetPasswordExpirationMinutes:
				envVars.JWT_RESET_PASSWORD_EXPIRATION_MINUTES,
			verifyEmailExpirationMinutes:
				envVars.JWT_VERIFY_EMAIL_EXPIRATION_MINUTES,
		},
		accessDomains: envVars.ACCESSDOMAINS,
		defaultLimit: envVars.DEFAULT_API_DATA_LIMIT,
		defaultDataOrder: envVars.DEFAULT_ORDERING,
		defaultPageNo: envVars.DEFAULT_PAGE_NO,
		apiBaseUrl: envVars.API_BASE_URL,
		adminBaseUrl: envVars.ADMIN_BASE_URL,
		defaultTimezone: envVars.DEFAULT_TIMEZONE,
	},

	roles: {
		superAdmin: envVars.SUP_ADM_ROLE_ID,
		admin: envVars.ADM_ROLE_ID,
		engineer: envVars.ENG_ROLE_ID,
		editor: envVars.EDTR_ROLE_ID,
		finance: envVars.FIN_ROLE_ID,
		marketing: envVars.MRK_ROLE_ID,
		hr: envVars.HR_ROLE_ID,
		sales: envVars.SALES_ROLE_ID,
		user: envVars.USR_ROLE_ID,
	},

	superAdmin: {
		password: envVars.SUPER_ADMIN_PASSWORD,
		email: envVars.SUPER_ADMIN_EMAIL,
	},
};

export default config;