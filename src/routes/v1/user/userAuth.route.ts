import express from "express";
import { userAuthController } from "../../../controllers";
import { userAuthMiddleware } from "../../../middlewares";

const router = express.Router();

// Phase 8.1: the legacy POST /register was removed; sign up with POST /api/v1/auth/signup.
router.post("/otp", userAuthController.sendOTP);
router.post("/verify-otp", userAuthController.verifyOTP);
router.post(
  "/login",
  [userAuthMiddleware.validateSignInReqBody],
  userAuthController.login
);

router.post(
  "/reset-password",
  [userAuthMiddleware.verifyAuthJWTToken],
  userAuthController.resetPassword
);
router.post(
  "/forgot-password",
  [userAuthMiddleware.validateForgetPassordToken],
  userAuthController.forgotPassword
);

router.post(
  "/refresh-auth",
  [userAuthMiddleware.verifyRefreshAuthJWTToken],
  userAuthController.refreshAuth
);
router.post(
  "/logout",
  [userAuthMiddleware.verifyRefreshAuthJWTToken],
  userAuthController.logout
);
router.get(
  "/deactivate",
  [userAuthMiddleware.verifyAuthJWTToken],
  userAuthController.deactivateAccount
);

//GBP
router.get(
  "/google/gbp",
  [userAuthMiddleware.verifyAuthJWTToken],
  userAuthController.getGBPAuthUrl
);
router.get("/google/gbp/callback", userAuthController.gBPAuthCallback);
// Phase 7a: Google Identity Services popup (account chooser) flow.
router.get(
  "/google/gbp/popup",
  [userAuthMiddleware.verifyAuthJWTToken],
  userAuthController.getGBPPopupConfig
);
router.post(
  "/google/gbp/code",
  [userAuthMiddleware.verifyAuthJWTToken],
  userAuthController.gBPPopupCode
);
router.post(
  "/google/gbp/revoke",
  [userAuthMiddleware.verifyAuthJWTToken],
  userAuthController.gBPConnectionRevoke
);

export default router;
