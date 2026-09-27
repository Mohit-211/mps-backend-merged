import express from 'express';
import { adminAuthController } from '../../../controllers';
import { adminAuthMiddleware } from '../../../middlewares';

// Platform admin accounts. Phase 10 (AUDIT S1): sign-in, OTP and forgot-password stay public (rate
// limited); everything else needs an admin session, and managing admins needs admins.manage (super admin).
const router = express.Router();
const signedIn = [adminAuthMiddleware.validateAdminJWTToken];
const superAdmin = adminAuthMiddleware.adminOnly('admins.manage');

router.post("/register", superAdmin, adminAuthController.createAdminUser);
router.post("/login", [adminAuthMiddleware.validateSignInReqBody], adminAuthController.loginAdminUser);
router.post("/sendOTP", adminAuthController.sendOTP);
router.post("/verifyOTP", adminAuthController.verifyOTP);
router.post("/resetPassword", signedIn, adminAuthController.resetAdminPassword);
router.post("/forgotPassword", adminAuthController.forgotAdminPassword);
router.get("/getAllAdmins", superAdmin, adminAuthController.getAllAdmins);
router.get("/getAdminById/:id", superAdmin, adminAuthController.findAdminById);
router.get("/getProfile", signedIn, adminAuthController.getProfile);
router.put("/updateAdmin", superAdmin, adminAuthController.updateAdmin);
router.delete("/deleteAdmin", superAdmin, adminAuthController.deleteAdmin);

export default router;
