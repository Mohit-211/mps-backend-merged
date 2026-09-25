export const userStatusTypes = {
	ACCEPTED: 'ACCEPTED',
	PENDING: 'PENDING',
	REJECTED: 'REJECTED',
	REVIEWING: 'REVIEWING',
	REVIEWED: 'REVIEWED',
	INACTIVE: 'INACTIVE',
	SUSPENDED: 'SUSPENDED',
	DEACTIVATED: 'DEACTIVATED',
	ACTIVE: 'ACTIVE',
	BLOCKED: 'BLOCKED',
};

export const paymentModeTypes = {
	CREDIT_CARD: 'CREDIT_CARD',
	DEBIT_CARD: 'DEBIT_CARD',
	PHONE_PAY: 'PHONE_PAY',
	GOOGLE_PAY: 'GOOGLE_PAY',
	BANK_ACCOUNT: 'BANK_ACCOUNT',
	UPI: 'UPI',
	PAYPAL: 'PAYPAL',
	NET_BANKING: 'NET_BANKING',
	CASH: 'CASH',
	CHEQUE: 'CHEQUE',
	DEMAND_DRAFT: 'DEMAND_DRAFT',
	AMAZON_PAY: 'AMAZON_PAY',
	APPLE_PAY: 'APPLE_PAY',
	BITCOIN: 'BITCOIN',
	ETHEREUM: 'ETHEREUM',
	GIFT_CARD: 'GIFT_CARD',
	ONLINE: 'ONLINE',
	OFFLINE: 'OFFLINE',
	UNKNOWN: 'UNKNOWN',
};

export const otpTypes = {
	EMAIL_VERIFICATION: 'EMAIL_VERIFICATION',
	MOBILE_VERIFICATION: 'MOBILE_VERIFICATION',
	FORGOT_PASSWORD: 'FORGOT_PASSWORD',
	RESET_PASSWORD: 'RESET_PASSWORD',
	CHANGE_EMAIL: 'CHANGE_EMAIL',
	CHANGE_MOBILE: 'CHANGE_MOBILE',
	TWO_FACTOR_AUTH: 'TWO_FACTOR_AUTH',
	ACCOUNT_RECOVERY: 'ACCOUNT_RECOVERY',
	PAYMENT_AUTHORIZATION: 'PAYMENT_AUTHORIZATION',
	LOGIN_CONFIRMATION: 'LOGIN_CONFIRMATION',
	TRANSACTION_APPROVAL: 'TRANSACTION_APPROVAL',
	DEVICE_VERIFICATION: 'DEVICE_VERIFICATION',
	NEW_DEVICE_LOGIN: 'NEW_DEVICE_LOGIN',
	SECURITY_ALERT: 'SECURITY_ALERT',
};

export const paymentStatusTypes = {
	PENDING: 'PENDING',
	SUCCESS: 'SUCCESS',
	REJECTED: 'REJECTED',
	REFUNDED: 'REFUNDED',
	SALE: 'SALE',
	ONCE: 'ONCE',
	MEMBERSHIP: 'MEMBERSHIP',
	PARTIAL_REFUND: 'PARTIAL_REFUND',
	CANCELLED: 'CANCELLED',
	PROCESSING: 'PROCESSING',
};

export const paymentTypes = {
	ONE_TIME: 'ONE_TIME',
	MEMBERSHIP: 'MEMBERSHIP',
};
export const paymentTypesArr = [
	'ONE_TIME',
	'MEMBERSHIP',
];

export const rolesTypes = {
	SUP_ADM: 'Super Admin',
	ADM: 'Admin',
	ENG: 'Engineer',
	EDTR: 'Editor',
	FIN: 'Finance Manager',
	MRK: 'Marketing Manager',
	HR: 'Human Resources',
	SALES: 'Sales Representative',
	USER: 'User',
};

export const bookingTypes = {
	PENDING: 'PENDING',
	SUCCESS: 'SUCCESS',
	REJECTED: 'REJECTED',
	CANCELED: 'CANCELED',
};

export const tokenTypes = {
	ACCESS: 'ACCESS',
	REFRESH: 'REFRESH',
	VERIFY_EMAIL: 'EMAIL_VERIFICATION',
	FORGOT_PASSWORD: 'FORGOT_PASSWORD',
	RESET_PASSWORD: 'RESET_PASSWORD',
	SESSION: 'SESSION',
	TWO_FACTOR_AUTH: 'TWO_FACTOR_AUTH',
	ACCOUNT_RECOVERY: 'ACCOUNT_RECOVERY',
	PAYMENT_AUTHORIZATION: 'PAYMENT_AUTHORIZATION',
	DEVICE_VERIFICATION: 'DEVICE_VERIFICATION',
	ANALYTICS: 'ANALYTICS',
	GBP: 'GBP'
};

export const currencyTypes = {
	USD: 'USD',
	INR: 'INR',
	EUR: 'EUR',
	OMR: 'OMR',
	CHF: 'CHF',
	KYD: 'KYD',
	GBP: 'GBP',
	JPY: 'JPY',
	AUD: 'AUD',
	CAD: 'CAD',
	CNY: 'CNY',
};

export const appointmentStatusTypes = {
	PENDING: 'PENDING',
	ACCEPTED: 'ACCEPTED',
	REJECTED: 'REJECTED',
	UPCOMING: 'UPCOMING',
	CANCELED: 'CANCELED',
	ONGOING: 'ONGOING',
	COMPLETED: 'COMPLETED',
	RESCHEDULED: 'RESCHEDULED',
	TODAY: 'TODAY',
	AWAITING_CONFIRMATION: 'AWAITING_CONFIRMATION',
	CONFIRMED: 'CONFIRMED',
	DECLINED: 'DECLINED',
	MISSED: 'MISSED',
};

export const notificationTypes = {
	APPOINTMENT_BOOKED: 'APPOINTMENT-BOOKED',
	APPOINTMENT_CANCELED: 'APPOINTMENT-CANCELED',
	APPOINTMENT_RESCHEDULED: 'APPOINTMENT-RESCHEDULED',
	INCOMING_MESSAGE: 'INCOMING-MESSAGE',
	TRIAL_BOOKED: 'TRIAL-BOOKED',
	TRIAL_CANCELED: 'TRIAL-CANCELED',
	SUBSCRIBED: 'SUBSCRIBED',
	UNSUBSCRIBED: 'UNSUBSCRIBED',
	PROMOTIONAL: 'PROMOTIONAL',
	NEWSLETTER: 'NEWSLETTER',
	ALERT: 'ALERT',
};

export const notificationMediumTypes = {
	MAIL: 'Mail',
	FLASH: 'FLASH',
	MOBILE: 'MOBILE',
	PUSH: 'PUSH',
	SMS: 'SMS',
	NOTIFICATION_CENTER: 'NOTIFICATION_CENTER',
};

export const callTypes = {
	VIDEO: 'VIDEO',
	VOICE: 'VOICE',
	CONFERENCE: 'CONFERENCE',
	GROUP_CALL: 'GROUP_CALL',
	SCREEN_SHARE: 'SCREEN_SHARE',
	INTERCOM: 'INTERCOM',
	OFFLINE: 'OFFLINE',
};

export const subscriptionStatusTypes = {
	ON_GOING: 'ON_GOING',
	EXPIRED: 'EXPIRED',
	PENDING: 'PENDING',
	CANCELED: 'CANCELED',
	TRIALING: 'TRIALING',
};

export const membershipType = {
	DAILY: 'DAILY',
	WEEKLY: 'WEEKLY',
	MONTHLY: 'MONTHLY',
	QUARTERLY: 'QUARTERLY',
	HALF_YEARLY: 'HALF_YEARLY',
	YEARLY: 'YEARLY',
};

export const deviceType = {
	HANDSET: 'HANDSET',
	TABLET: 'TABLET',
	PC: 'PC',
	OTHER: 'OTHER',
	LAPTOP: 'LAPTOP',
	SMARTWATCH: 'SMARTWATCH',
};

export const refundStatusTypes = {
	PENDING: 'PENDING',
	COMPLETED: 'COMPLETED',
	FAILED: 'FAILED',
	NONEED: 'NONEED',
	PROCESSING: 'PROCESSING',
	PARTIAL_REFUND: 'PARTIAL_REFUND',
};

export const daysOfWeek: string[] = [
	'Monday',
	'Tuesday',
	'Wednesday',
	'Thursday',
	'Friday',
	'Saturday',
	'Sunday',
];

export const monthsOfYear: string[] = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December',
];

export const last20Years: number[] = [
	2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014, 2013,
	2012, 2011, 2010, 2009, 2008, 2007, 2006, 2005,
];

export const timezones: string[] = [
	'America/New_York',
	'America/Los_Angeles',
	'America/Chicago',
	'America/Toronto',
	'America/Mexico_City',
	'Europe/London',
	'Europe/Paris',
	'Europe/Berlin',
	'Asia/Tokyo',
	'Asia/Shanghai',
	'Asia/Dubai',
	'Asia/Kolkata',
	'Asia/Hong_Kong',
	'Asia/Singapore',
	'Australia/Sydney',
	'Pacific/Auckland',
];

export const userStatusTypesArr: string[] = [
	'ACCEPTED',
	'PENDING',
	'REJECTED',
	'REVIEWING',
	'REVIEWED',
	'INACTIVE',
	'SUSPENDED',
	'DEACTIVATED',
	'ACTIVE',
	'BLOCKED',
];

export const paymentModeTypesArr: string[] = [
	'CREDIT_CARD',
	'DEBIT_CARD',
	'PHONE_PAY',
	'GOOGLE_PAY',
	'BANK_ACCOUNT',
	'UPI',
	'PAYPAL',
	'NET_BANKING',
	'CASH',
	'CHEQUE',
	'DEMAND_DRAFT',
	'AMAZON_PAY',
	'APPLE_PAY',
	'BITCOIN',
	'ETHEREUM',
	'GIFT_CARD',
	'ONLINE',
	'OFFLINE',
	'UNKNOWN',
];

export const otpTypesArr: string[] = [
	'EMAIL_VERIFICATION',
	'MOBILE_VERIFICATION',
	'FORGOT_PASSWORD',
	'RESET_PASSWORD',
	'CHANGE_EMAIL',
	'CHANGE_MOBILE',
	'TWO_FACTOR_AUTH',
	'ACCOUNT_RECOVERY',
	'PAYMENT_AUTHORIZATION',
	'LOGIN_CONFIRMATION',
	'TRANSACTION_APPROVAL',
	'DEVICE_VERIFICATION',
	'NEW_DEVICE_LOGIN',
	'SECURITY_ALERT',
];

export const paymentStatusTypesArr: string[] = [
	'PENDING',
	'SUCCESS',
	'REJECTED',
	'REFUNDED',
	'SALE',
	'ONCE',
	'MEMBERSHIP',
	'PARTIAL_REFUND',
	'CANCELLED',
	'PROCESSING',
];

export const rolesTypesArr: string[] = [
	'SUP_ADM',
	'ADM',
	'ENG',
	'EDTR',
	'FIN',
	'MRK',
	'HR',
	'SALES',
	'USER',
];

export const bookingTypesArr: string[] = [
	'PENDING',
	'SUCCESS',
	'REJECTED',
	'CANCELED',
];

export const tokenTypesArr: string[] = [
	'ACCESS',
	'REFRESH',
	'EMAIL_VERIFICATION',
	'FORGOT_PASSWORD',
	'RESET_PASSWORD',
	'SESSION',
	'TWO_FACTOR_AUTH',
	'ACCOUNT_RECOVERY',
	'PAYMENT_AUTHORIZATION',
	'DEVICE_VERIFICATION',
	'ANALYTICS',
	'GBP'
];

export const currencyTypesArr: string[] = [
	'USD',
	'INR',
	'EUR',
	'OMR',
	'CHF',
	'KYD',
	'GBP',
	'JPY',
	'AUD',
	'CAD',
	'CNY',
];

export const appointmentStatusTypesArr: string[] = [
	'PENDING',
	'ACCEPTED',
	'REJECTED',
	'UPCOMING',
	'CANCELED',
	'ONGOING',
	'COMPLETED',
	'RESCHEDULED',
	'TODAY',
	'AWAITING_CONFIRMATION',
	'CONFIRMED',
	'DECLINED',
	'MISSED',
];

export const notificationTypesArr: string[] = [
	'APPOINTMENT_BOOKED',
	'APPOINTMENT_CANCELED',
	'APPOINTMENT_RESCHEDULED',
	'INCOMING_MESSAGE',
	'TRIAL_BOOKED',
	'TRIAL_CANCELED',
	'SUBSCRIBED',
	'UNSUBSCRIBED',
	'PROMOTIONAL',
	'NEWSLETTER',
	'ALERT',
];

export const notificationMediumTypesArr: string[] = [
	'MAIL',
	'FLASH',
	'MOBILE',
	'PUSH',
	'SMS',
	'NOTIFICATION_CENTER',
];

export const callTypesArr: string[] = [
	'VIDEO',
	'VOICE',
	'CONFERENCE',
	'GROUP_CALL',
	'SCREEN_SHARE',
	'INTERCOM',
	'OFFLINE',
];

export const subscriptionStatusTypesArr: string[] = [
	'ON_GOING',
	'EXPIRED',
	'PENDING',
	'CANCELED',
	'TRIALING',
];

export const membershipTypeArr: string[] = [
	'DAILY',
	'WEEKLY',
	'MONTHLY',
	'QUARTERLY',
	'HALF_YEARLY',
	'YEARLY',
];

export const deviceTypeArr: string[] = [
	'HANDSET',
	'TABLET',
	'PC',
	'OTHER',
	'LAPTOP',
	'SMARTWATCH',
];

export const refundStatusTypesArr: string[] = [
	'PENDING',
	'COMPLETED',
	'FAILED',
	'NONEED',
	'PROCESSING',
	'PARTIAL_REFUND',
];

export const queryTypesArr = ['sortBy', 'limit', 'page'];
export const queryTypes = {
	sortBy: 'sortBy',
	limit: 'limit',
	page: 'page',
	offset: 'offset',
};

export const userTypesArr: string[] = ['AGENCY', 'BUSINESS', 'EMPLOYEE','CLIENT'];
export const userTypes = {
	agency: 'AGENCY',
	business: 'BUSINESS',
	employee: 'EMPLOYEE',
	client: 'CLIENT',
};

export const mongoOperationsTypesArray = [
	'find',
	'findOne',
	'updateOne',
	'updateMany',
	'deleteOne',
	'deleteMany',
	'create',
	'insertMany',
	'findOneAndUpdate',
	'findOneAndDelete',
];

export const mongoOperationsTypes = {
	FIND: 'find',
	FIND_ONE: 'findOne',
	UPDATE_ONE: 'updateOne',
	UPDATE_MANY: 'updateMany',
	DELETE_ONE: 'deleteOne',
	DELETE_MANY: 'deleteMany',
	CREATE: 'create',
	INSERT_MANY: 'insertMany',
	FIND_ONE_AND_UPDATE: 'findOneAndUpdate',
	FIND_ONE_AND_DELETE: 'findOneAndDelete',
};

export const ticketStatusTypes = {
	OPEN: 'open',
	IN_PROGRESS: 'in_progress',
	RESOLVED: 'resolved',
	CLOSED: 'closed',
};

export const ticketStatusTypesArr = ['open', 'in_progress', 'resolved', 'closed']

export const colors = {
	DEFAULT: 'default',
	MINIMAL: 'minimal',
	RED: 'red',
	BLUE: 'blue',
};
export const colorsArr = [
	'default', 'minimal', 'red', 'blue',
];
export const reportsArr = [
	'rank_tracker',
	'local_search_grid',
	'citation_tracker',
	'citation_builder',
	'reputation_manager',
	'gbp_audit',
	'local_search_audit',
	'google_analytics'
];
export const reports = {
	rank_tracker: 'rank_tracker',
	local_search_grid: 'local_search_grid',
	citation_tracker: 'citation_tracker',
	citation_builder: 'citation_builder',
	reputation_manager: 'reputation_manager',
	gbp_audit: 'gbp_audit',
	local_search_audit: 'local_search_audit',
	google_analytics: 'google_analytics'
};
export const citationDirectoriesArr = [
	"google.com",
	"maps.apple.com",       // Apple Maps
	"facebook.com",
	"bing.com",
	"foursquare.com",
	"bbb.org",              // Better Business Bureau
	"mapquest.com",
	"manta.com",
	"zoominfo.com",
	"yelp.com",
	"justlanded.com",
	"yellowpages.ca",       // or .com based on region
	"storeboard.com",
	"brownbook.net",
	"infobel.com",
	"bizapedia.com",
	"cybo.com",
	"411.ca",
	"enrollbusiness.com",
	"canpages.ca",
	"pagesjaunes.ca",
	"n49.com",
	"2findlocal.com",
	"hotfrog.ca",           // Hotfrog region-based
	"profilecanada.com",
	"tupalo.com",
	"ourbis.ca",
	"yellow.place",
	"cylex.ca",
	"phonepages.ca",
	"acomp.io"
];

export const gbpPostTopicType = {
	STANDARD: 'STANDARD',
	EVENT: 'EVENT',
	OFFER: 'OFFER',
};
export const gbpPostTopicTypeArr = [
	'STANDARD',
	'EVENT',
	'OFFER'
];

export const gbpCallToAction = {
	CALL_NOW: 'CALL_NOW',
	SIGN_UP: 'SIGN_UP',
	BUY: 'BUY',
	LEARN_MORE: 'LEARN_MORE',
	ORDER_ONLINE: 'ORDER_ONLINE',
	BOOK: 'BOOK',
	NONE: 'NONE',
};
export const gbpCallToActionArr = [
	'CALL_NOW',
	'SIGN_UP',
	'BUY',
	'LEARN_MORE',
	'ORDER_ONLINE',
	'BOOK',
	'NONE'
];


export const postPublishStatusArr: string[] = [
	'EXPIRED',
	'SCHEDULED',
	'REJECTED',
	'LIVE',
];

export const postPublishStatus = {
	expired: 'EXPIRED',
	scheduled: 'SCHEDULED',
	rejected: 'REJECTED',
	live: 'LIVE',
}

export const citationOrderStatus = {
	saved: 'SAVED',
	payment_pending: 'PAYMENT_PENDING',
	payment_failed: 'PAYMENT_FAILED',
	confirmed: 'CONFIRMED',
}
export const citationOrderStatusArr: string[] = [
	'SAVED',
	'PAYMENT_PENDING',
	'PAYMENT_FAILED',
	'CONFIRMED',
];

export const citationCampaignStatus = {
	saved: 'SAVED',
	processing: 'PROCESSING',
	submitted: 'SUBMITTED',
	live: 'LIVE',
	rejected: 'REJECTED',
	need_review: 'NEEDS_REVIEW'
}
export const citationCampaignStatusArr: string[] = [
	'SAVED',
	'PROCESSING',
	'SUBMITTED',
	'LIVE',
	'REJECTED',
	'NEEDS_REVIEW',
];


export const paymentGateways = {
	stripe: 'STRIPE',
	paypal: 'PAYPAL',
	razorpay: 'RAZORPAY',
	worldpay: 'WORLDPAY',
	cashfree: 'CASHFREE',
	square: 'SQUARE',
}
export const paymentGatewaysArr: string[] = [
	'STRIPE',
	'PAYPAL',
	'RAZORPAY',
	'WORLDPAY',
	'CASHFREE',
	'SQUARE'
];
export const taxTypes = {
	none: "NONE",
	gst: "GST",
	igst: "IGST",
	cgst: "CGST",
	sgst: "SGST",
	vat: "VAT",
	sales_tax: "SALES_TAX",
	use_tax: "USE_TAX",
	service_tax: "SERVICE_TAX"
};

export const taxTypesArr = [
	"NONE",
	"GST",
	"IGST",
	"CGST",
	"SGST",
	"VAT",
	"SALES_TAX",
	"USE_TAX",
	"SERVICE_TAX"
];
export const paymentResources = {
	creadit: 'CREDIT',
	subscription: 'SUBSCRIPTION',
	waller_recharge: 'WALLET_RECHARGE',
	purchase: 'PURCHASE',
	booking: 'BOOKING',
	donation: 'DONATION',
	settlement: 'SETTLEMENT',
	fine: 'FINE'
}

export const paymentResourcesArr = ['CREDIT', 'SUBSCRIPTION', 'WALLET_RECHARGE', 'PURCHASE', 'BOOKING', 'DONATION', 'SETTLEMENT', 'FINE']


export const citationVerificationTypes = {
	postcard: 'POSTCARD',
	phone: 'PHONE',
	email: 'EMAIL',
	video: 'VIDEO',
	owner_Docs: 'OWNER_DOCS',
	otp: 'OTP'
}

export const citationVerificationTypesArr = ["POSTCARD", "PHONE", "EMAIL", "VIDEO", "OWNER_DOCS", "OTP"]


export const openingHoursTypesArr = ["Open", "Closed", "24hrs", "Split"]

export const openingHoursTypes = {
	open: 'Open',
	closed: 'Closed',
	'24hrs': '24hrs',
	split: 'Split'
}

export const citationTypes = {
	add: 'ADD',
	update: 'UPDATE',
	remove: 'REMOVE',
}

export const citationTypesArr = ["ADD", "UPDATE", "REMOVE", "VIDEO"]

export const citationStatus = {
	saved: 'SAVED',
	processing: 'PROCESSING',
	submitted: 'SUBMITTED',
	live: 'LIVE',
	rejected: 'REJECTED',
	need_review: 'NEEDS_REVIEW'
}
export const citationStatusArr: string[] = [
	'SAVED',
	'PROCESSING',
	'SUBMITTED',
	'LIVE',
	'REJECTED',
	'NEEDS_REVIEW',
];

export const citationModes = {
	manual: 'MANUAL',
	aggregator: 'AGGREGATOR',
}

export const citationModesArr = ["MANUAL", "AGGREGATOR"]