import express from 'express';
import { adminAuthController } from '../../../controllers';
import { adminAuthMiddleware } from '../../../middlewares';

const router = express.Router();


router.post("/register", adminAuthController.createAdminUser);
router.post(
  "/login",
  [adminAuthMiddleware.validateSignInReqBody],
  adminAuthController.loginAdminUser
);
router.post("/sendOTP", adminAuthController.sendOTP);
router.post("/verifyOTP", adminAuthController.verifyOTP);
router.post("/resetPassword",  [adminAuthMiddleware.validateAdminJWTToken], adminAuthController.resetAdminPassword);
router.post("/forgotPassword", adminAuthController.forgotAdminPassword);
router.get("/getAllAdmins", adminAuthController.getAllAdmins);
router.get("/getAdminById/:id", adminAuthController.findAdminById);
router.get("/getProfile",  [adminAuthMiddleware.validateAdminJWTToken], adminAuthController.getProfile);
router.put("/updateAdmin", adminAuthController.updateAdmin);
router.delete("/deleteAdmin", adminAuthController.deleteAdmin);

export default router;