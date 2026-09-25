import { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';

const authLimiterOptions = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  skipSuccessfulRequests: true,
};

const authLimiter: RequestHandler = rateLimit(authLimiterOptions);

export default authLimiter;