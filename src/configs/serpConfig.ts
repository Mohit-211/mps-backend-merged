import { config } from "serpapi";
import configs from './config';
config.api_key = configs.serpApis.keySecret;
config.timeout = configs.serpApis.timeout;