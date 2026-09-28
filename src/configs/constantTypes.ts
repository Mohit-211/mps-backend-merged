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
