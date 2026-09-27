import express from 'express';
import * as authController from '../../../controllers/auth/auth.controller';
import { validateEmailOnly, validateLogin, validateResetPassword, validateSignup, validateVerifyEmail } from '../../../middlewares/auth2/auth.validation';
import * as teamController from '../../../controllers/team/team.controller';
import { validateAccept, validateInspect } from '../../../middlewares/team/team.middleware';

// Auth for the rebuilt app (Phase 8), mounted at /api/v1/auth. Rate-limited per email (and IP), codes and
// link tokens stored hashed. Phase 8.1: email verification by link. Token refresh and logout stay at
// /user/auth/refresh-auth and /user/auth/logout.
const router = express.Router();

router.post('/signup', validateSignup, authController.signup);
router.post('/verify-email', validateVerifyEmail, authController.verifyEmail);
router.post('/resend-verification', validateEmailOnly, authController.resendVerification);
router.post('/login', validateLogin, authController.login);
router.post('/forgot-password', validateEmailOnly, authController.forgotPassword);
router.post('/reset-password', validateResetPassword, authController.resetPassword);
// Phase 11: team invitations (the token goes in the body, never in the URL, so request logs don't hold it).
router.post('/invitations/inspect', validateInspect, teamController.inspectInvitation);
router.post('/invitations/accept', validateAccept, teamController.acceptInvitation);

export default router;
