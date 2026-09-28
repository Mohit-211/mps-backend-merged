import express from "express";
import { userOperationController } from "../../../controllers";
import { userAuthMiddleware } from "../../../middlewares";

const router = express.Router();

router.get(
  "/profile",
  [userAuthMiddleware.verifyAuthJWTToken],
  userOperationController.getProfile
);
router.put(
  "/profile",
  [
    userAuthMiddleware.validateUpdateProfilerBody,
    userAuthMiddleware.verifyAuthJWTToken,
  ],
  userOperationController.updateProfile
);

export default router;
