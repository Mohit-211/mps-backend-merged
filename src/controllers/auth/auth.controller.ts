import httpStatus from 'http-status';
import { authService } from '../../services/auth/auth.service';
import { sessionService } from '../../services/auth/session.service';
import { catchAsync, responseWrapper } from '../../utils';

// Auth (Phase 8). Validated input is on res.locals.authInput. Responses never echo codes or passwords.

const meta = (req: { ip?: string }) => ({ ip: req.ip ?? 'unknown' });

export const signup = catchAsync(async (req, res) =>
	responseWrapper(res, await authService.signup(res.locals.authInput, meta(req)), 'Account created. Check your email for the verification link.', httpStatus.CREATED),
);
export const verifyEmail = catchAsync(async (req, res) => {
	const result = await authService.verifyEmail(res.locals.authInput, meta(req));
	return responseWrapper(res, result, result.already_verified ? 'Your email is already verified. Please log in.' : 'Email verified.');
});
export const resendVerification = catchAsync(async (req, res) =>
	responseWrapper(res, await authService.resendVerification(res.locals.authInput, meta(req)), 'If the account is waiting for verification, a new link was sent.'),
);
export const login = catchAsync(async (req, res) => responseWrapper(res, await authService.login(res.locals.authInput, meta(req)), 'Logged in.'));
export const forgotPassword = catchAsync(async (req, res) =>
	responseWrapper(res, await authService.forgotPassword(res.locals.authInput, meta(req)), 'If an account exists for this email, a reset link was sent.'),
);
export const resetPassword = catchAsync(async (req, res) =>
	responseWrapper(res, await authService.resetPassword(res.locals.authInput, meta(req)), 'Password changed. Please log in again.'),
);

// Phase 13b: sessions and the account (verifyAuthJWTToken sets req.body.user on the signed-in routes).
const userIdOf = (req: { body: { user?: { _id: unknown } } }) => String(req.body.user?._id);
export const refresh = catchAsync(async (req, res) => responseWrapper(res, await sessionService.refresh(res.locals.authInput.refresh_token), 'Session refreshed.'));
export const logout = catchAsync(async (req, res) => responseWrapper(res, await sessionService.logout(res.locals.authInput.refresh_token), 'Logged out.'));
export const changePassword = catchAsync(async (req, res) =>
	responseWrapper(res, await sessionService.changePassword(userIdOf(req), res.locals.authInput), 'Password changed. Other sessions were signed out.'),
);
export const me = catchAsync(async (req, res) => responseWrapper(res, await sessionService.me(userIdOf(req))));
export const updateMe = catchAsync(async (req, res) => responseWrapper(res, await sessionService.updateMe(userIdOf(req), res.locals.authInput), 'Profile saved.'));
export const deactivate = catchAsync(async (req, res) => responseWrapper(res, await sessionService.deactivate(userIdOf(req), res.locals.authInput), 'Account deleted.'));
