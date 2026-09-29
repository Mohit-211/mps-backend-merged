import { bindingService } from '../../services/gbp/binding.service';
import { gbpOAuthService } from '../../services/gbp/oauth.service';
import { catchAsync, responseWrapper } from '../../utils';

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

/** Redirect fallback: Google calls this with the code and the one-time state. */
export const callback = catchAsync(async (req, res) =>
	responseWrapper(
		res,
		await gbpOAuthService.handleCallback({ code: str(req.query.code), state: str(req.query.state), error: str(req.query.error) }),
		'Connected with GBP successfully.',
	),
);

/** Disconnect one Google account (google_sub; optional with a single connection): revoke, unbind its profiles, delete its tokens. */
export const disconnect = catchAsync(async (req, res) =>
	responseWrapper(res, await bindingService.disconnect(userIdOf(req), str(req.body.google_sub)), 'Google account disconnected.'),
);
