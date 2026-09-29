import express from 'express';
import * as controller from '../../../controllers/admin/adminAuth.controller';
import { adminAuthMiddleware } from '../../../middlewares';
import * as v from '../../../middlewares/admin/adminAuth.validation';

// 13b: admin sign-in and password links (/admin/auth). Sign-in, forgot and reset are public (rate-limited).
const router = express.Router();
const signedIn = [adminAuthMiddleware.validateAdminJWTToken];

router.post('/login', v.validateLogin, controller.login);
router.post('/forgot-password', v.validateForgotPassword, controller.forgotPassword);
router.post('/reset-password', v.validateResetPassword, controller.resetPassword);
router.post('/change-password', signedIn, v.validateChangePassword, controller.changePassword);
router.get('/me', signedIn, controller.me);

export default router;
