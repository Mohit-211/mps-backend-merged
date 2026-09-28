import express from "express";
import { userAuthController } from "../../../controllers";
import { userAuthMiddleware } from "../../../middlewares";

const router = express.Router();

// Phase 13b: only the Google connect flow is left here (sessions and the account moved to /auth).
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
