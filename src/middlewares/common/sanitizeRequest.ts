import { NextFunction, Request, Response } from 'express';
import httpStatus from 'http-status';
import { apiErrorWithData } from '../../utils';

// Phase 10 (AUDIT S6): MongoDB operator injection. Any body, query or route-param key that starts with
// "$" or contains "." is refused (400 invalid_input), so request values can never become operators or
// dotted paths in a filter. (mongoose's global sanitizeFilter was not used: it would also neutralise the
// app's own server-built $in / $gt / $or filters unless each were wrapped in mongoose.trusted().)

const MAX_DEPTH = 20;

/** The first offending key path, or null. */
export const findUnsafeKey = (value: unknown, pathSoFar = '', depth = 0): string | null => {
	if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return null;
	if (Buffer.isBuffer(value)) return null;
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		const here = pathSoFar ? `${pathSoFar}.${key}` : key;
		if (key.startsWith('$') || key.includes('.')) return here;
		const deeper = findUnsafeKey(child, here, depth + 1);
		if (deeper) return deeper;
	}
	return null;
};

export const sanitizeRequest = (req: Request, _res: Response, next: NextFunction): void => {
	const bad = findUnsafeKey(req.body, 'body') ?? findUnsafeKey(req.query, 'query') ?? findUnsafeKey(req.params, 'params');
	if (bad) {
		next(apiErrorWithData(httpStatus.BAD_REQUEST, 'Invalid input.', { reason: 'invalid_input', field: bad }));
		return;
	}
	next();
};
