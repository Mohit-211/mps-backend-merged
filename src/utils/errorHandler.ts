import { Request, Response, NextFunction } from 'express';
import httpStatus from 'http-status';
import config from '../configs/config';
import logger from '../configs/logger';
import ApiError from './apiError';
import responseWrapper from './responseWrapper';

// Phase 10 (AUDIT S28): one response per error and no internals in it.
// - ApiError: its status, message and data (unchanged).
// - HTTP errors raised by middleware (body too large, malformed JSON…): their 4xx status, a plain message.
// - Anything else: logged once here (message and stack, never the request body), and a generic 500;
//   the error text is added only in development.
// (Before: next(err) made Express log every error a second time, and 500s echoed the raw error.)

// Express recognises an error handler by its 4 parameters, so `next` stays although it isn't called.
// oxlint-disable-next-line typescript/no-unused-vars
const apiErrorHandler = (err: Error, req: Request, res: Response, next: NextFunction): void => {
	if (res.headersSent) return;
	if (err instanceof ApiError) {
		responseWrapper(res, err.data ?? '', err.message, err.statusCode);
		return;
	}
	const status = (err as { status?: unknown }).status ?? (err as { statusCode?: unknown }).statusCode;
	if (typeof status === 'number' && status >= 400 && status < 500) {
		responseWrapper(res, '', status === httpStatus.REQUEST_ENTITY_TOO_LARGE ? 'The request body is too large.' : 'Invalid request.', status);
		return;
	}
	logger.error(`unhandled error on ${req.method} ${req.baseUrl}${req.path}: ${err?.message ?? String(err)}${err?.stack ? `\n${err.stack}` : ''}`);
	const detail = config.essentials.env === 'development' ? `: ${err?.message ?? String(err)}` : '.';
	responseWrapper(res, '', `Something went wrong${detail}`, httpStatus.INTERNAL_SERVER_ERROR);
};

export default apiErrorHandler;
