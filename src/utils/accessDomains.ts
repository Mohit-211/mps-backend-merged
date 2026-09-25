import config from '../configs/config';

// Assuming config.accessDomains is a string separated by commas
const allowedOrigins: string[] = config.constants.accessDomains.split(',');

export default allowedOrigins;
