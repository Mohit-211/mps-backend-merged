import httpStatus from 'http-status';
import { authService } from '../../services/auth/auth.service';
import { catchAsync, responseWrapper } from '../../utils';

// Auth (Phase 8). Validated input is on res.locals.authInput. Responses never echo codes or passwords.

const meta = (req: { ip?: string }) => ({ ip: req.ip ?? 'unknown' });

export const signup = catchAsync(async (req, res) =>
	responseWrapper(res, await authService.signup(res.locals.authInput, meta(req)), 'Account created. Check your email for the verification code.', httpStatus.CREATED),
);
export const verifyEmail = catchAsync(async (req, res) => responseWrapper(res, await authService.verifyEmail(res.locals.authInput), 'Email verified.'));
export const resendVerification = catchAsync(async (req, res) =>
	responseWrapper(res, await authService.resendVerification(res.locals.authInput), 'If the account is waiting for verification, a new code was sent.'),
);
export const login = catchAsync(async (req, res) => responseWrapper(res, await authService.login(res.locals.authInput, meta(req)), 'Logged in.'));
export const forgotPassword = catchAsync(async (req, res) =>
	responseWrapper(res, await authService.forgotPassword(res.locals.authInput, meta(req)), 'If an account exists for this email, a reset code was sent.'),
);
export const resetPassword = catchAsync(async (req, res) =>
	responseWrapper(res, await authService.resetPassword(res.locals.authInput), 'Password changed. Please log in again.'),
);
