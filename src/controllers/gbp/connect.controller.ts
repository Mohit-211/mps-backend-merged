import { Response } from 'express';
import config from '../../configs/config';
import logger from '../../configs/logger';
import { bindingService } from '../../services/gbp/binding.service';
import { gbpOAuthService } from '../../services/gbp/oauth.service';
import { ApiError, catchAsync, responseWrapper } from '../../utils';

// Google connect (Phases 6–7a; moved from /user/auth/google/gbp/* to /gbp/connect/* in 13b).
// verifyAuthJWTToken sets req.body.user on the signed-in routes.

const userIdOf = (req: { body: { user?: { _id: unknown } } }) => String(req.body.user?._id);
const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/** Popup flow: the GIS code-client config with a one-time state. */
export const popupConfig = catchAsync(async (req, res) => responseWrapper(res, await gbpOAuthService.createPopupConfig(userIdOf(req))));

/** Popup flow: exchange the code (redirect_uri=postmessage) and verify the id_token. */
export const popupCode = catchAsync(async (req, res) =>
	responseWrapper(
		res,
		await gbpOAuthService.handlePopupCode(userIdOf(req), { code: str(req.body.code), state: str(req.body.state) }),
		'Connected with GBP successfully.',
	),
);

/** Redirect fallback: the Google consent URL. */
export const authUrl = catchAsync(async (req, res) => responseWrapper(res, await gbpOAuthService.createAuthUrl(userIdOf(req))));

/** Where the redirect flow sends the browser back to (the web app's result page). */
export const CALLBACK_PAGE_PATH = '/gbp/connect/callback';
const FAILED_MESSAGE = 'The Google connection could not be completed. Start it again.';

const toFrontend = (res: Response, frontendUrl: string, status: 'success' | 'denied' | 'error', message: string) => {
	const url = new URL(`${frontendUrl.replace(/\/+$/, '')}${CALLBACK_PAGE_PATH}`);
	url.searchParams.set('status', status);
	url.searchParams.set('message', message);
	return res.redirect(302, url.toString());
};

/**
 * Redirect fallback: Google sends the browser here (the API domain) with the code and the one-time
 * state. With FRONTEND_URL set, the browser is sent back to FRONTEND_URL/gbp/connect/callback
 * ?status=success|denied|error&message=… (the web app shows the result); without it, JSON as before.
 * Only ApiError messages (written for users) reach the URL; anything else gets a generic message.
 */
export const callback = catchAsync(async (req, res) => {
	const query = { code: str(req.query.code), state: str(req.query.state), error: str(req.query.error) };
	const frontendUrl = config.auth.frontendUrl;
	if (!frontendUrl) {
		return responseWrapper(res, await gbpOAuthService.handleCallback(query), 'Connected with GBP successfully.');
	}
	try {
		const result = await gbpOAuthService.handleCallback(query);
		return toFrontend(res, frontendUrl, 'success', `Connected as ${result.google_email}`);
	} catch (err) {
		if (query.error === 'access_denied') return toFrontend(res, frontendUrl, 'denied', 'Google Business Profile access was not granted.');
		if (err instanceof ApiError && err.statusCode < 500) return toFrontend(res, frontendUrl, 'error', err.message);
		logger.error(`gbp oauth callback failed: ${(err as Error).message}`);
		return toFrontend(res, frontendUrl, 'error', FAILED_MESSAGE);
	}
});

/** Disconnect one Google account (google_sub; optional with a single connection): revoke, unbind its profiles, delete its tokens. */
export const disconnect = catchAsync(async (req, res) =>
	responseWrapper(res, await bindingService.disconnect(userIdOf(req), str(req.body.google_sub)), 'Google account disconnected.'),
);
