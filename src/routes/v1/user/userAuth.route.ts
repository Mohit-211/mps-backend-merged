import express from "express";
import { userAuthController } from "../../../controllers";
import { userAuthMiddleware } from "../../../middlewares";

const router = express.Router();

router.post(
  "/register",
  [
    userAuthMiddleware.insertUserRoleId,
    userAuthMiddleware.validateRegisterUserBody,
  ],
  userAuthController.register
);
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

//Analytics
router.get(
  "/google/analytics",
  [userAuthMiddleware.verifyAuthJWTToken],
  userAuthController.getAnalyticsAuthUrl
);
router.get(
  "/google/analytics/callback",
  userAuthController.analyticsAuthCallback
);
router.post(
  "/google/analytics/revoke",
  [userAuthMiddleware.verifyAuthJWTToken],
  userAuthController.analyticsConnectionRevoke
);

//GBP
router.get(
  "/google/gbp",
  [userAuthMiddleware.verifyAuthJWTToken],
  userAuthController.getGBPAuthUrl
);
router.get("/google/gbp/callback", userAuthController.gBPAuthCallback);
router.post(
  "/google/gbp/revoke",
  [userAuthMiddleware.verifyAuthJWTToken],
  userAuthController.gBPConnectionRevoke
);

// Employee
router.post(
  "/employee/add",
  [
    userAuthMiddleware.verifyAuthJWTToken,
    userAuthMiddleware.validateAddEmployeeBody,
  ],
  userAuthController.addEmployee
);

router.delete(
  "/employee/remove",
  [
    userAuthMiddleware.verifyAuthJWTToken,
  ],
  userAuthController.deleteEmployee
)

router.get(
  "/employee/all",
  [
    userAuthMiddleware.verifyAuthJWTToken,
  ],
  userAuthController.getAllEmployeeByOwner
)

router.get(
  "/employee/details/:employee_id",
  [
    userAuthMiddleware.verifyAuthJWTToken,
  ],
  userAuthController.employeeDetails
)

export default router;
