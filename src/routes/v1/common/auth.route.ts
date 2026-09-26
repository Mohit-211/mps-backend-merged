import express from 'express';
import * as authController from '../../../controllers/auth/auth.controller';
import { validateEmailOnly, validateLogin, validateResetPassword, validateSignup, validateVerifyEmail } from '../../../middlewares/auth2/auth.validation';

// Auth for the rebuilt app (Phase 8), mounted at /api/v1/auth. Rate-limited per email (and IP), codes
// stored hashed. Token refresh and logout stay at /user/auth/refresh-auth and /user/auth/logout.
const router = express.Router();

router.post('/signup', validateSignup, authController.signup);
router.post('/verify-email', validateVerifyEmail, authController.verifyEmail);
router.post('/verify-email/resend', validateEmailOnly, authController.resendVerification);
router.post('/login', validateLogin, authController.login);
router.post('/forgot-password', validateEmailOnly, authController.forgotPassword);
router.post('/reset-password', validateResetPassword, authController.resetPassword);

export default router;
