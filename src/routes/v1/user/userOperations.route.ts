import express from "express";
import { userOperationController } from "../../../controllers";
import { roleMiddleware, userAuthMiddleware } from "../../../middlewares";

const router = express.Router();

router.get(
  "/profile",
  [userAuthMiddleware.verifyAuthJWTToken],
  userOperationController.getProfile
);
router.post(
  "/notifications",
  [userAuthMiddleware.verifyAuthJWTToken],
  userOperationController.notificationToogle
);
router.put(
  "/profile",
  [
    userAuthMiddleware.validateUpdateProfilerBody,
    userAuthMiddleware.verifyAuthJWTToken,
  ],
  userOperationController.updateProfile
);

router.post(
  "/clients",
  [
    userAuthMiddleware.verifyAuthJWTToken,
    roleMiddleware.isAgency,
    userAuthMiddleware.validateCreateClientBody,
  ],
  userOperationController.createClient
);
router.get(
  "/clients",
  [userAuthMiddleware.verifyAuthJWTToken, roleMiddleware.isAgency],
  userOperationController.getAllClient
);
router.get(
  "/clients/:client_id",
  [userAuthMiddleware.verifyAuthJWTToken, roleMiddleware.isAgency],
  userOperationController.getClientDetails
);
router.put(
  "/clients",
  [userAuthMiddleware.verifyAuthJWTToken, roleMiddleware.isAgency],
  userOperationController.updateClient
);
router.delete(
  "/clients/:client_id",
  [userAuthMiddleware.verifyAuthJWTToken, roleMiddleware.isAgency],
  userOperationController.deleteClient
);

export default router;
