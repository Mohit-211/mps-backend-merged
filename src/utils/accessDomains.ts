import config from '../configs/config';

// ACCESSDOMAINS: comma-separated frontend origins (e.g. https://app.mypageseo.com). Browsers send the
// Origin without a trailing slash, so entries are trimmed and a trailing slash is dropped.
const allowedOrigins: string[] = (config.constants.accessDomains ?? '')
	.split(',')
	.map((o) => o.trim().replace(/\/+$/, ''))
	.filter(Boolean);

export default allowedOrigins;
