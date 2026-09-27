import express from 'express';
import { adminOperationsController } from '../../../controllers';
import { adminAuthMiddleware } from '../../../middlewares';

// Platform operations (agencies, businesses, clients). Phase 10 (AUDIT S1): admin session +
// platform.read / platform.write.
const router = express.Router();
const read = adminAuthMiddleware.adminOnly('platform.read');
const write = adminAuthMiddleware.adminOnly('platform.write');

router.get("/getAllAgencies", read, adminOperationsController.getAllAgencies);
router.get("/getAgencyById/:id", read, adminOperationsController.getAgencyById);
router.put("/updateAgencyStatus", write, adminOperationsController.updateAgencyStatus);
router.get("/getAllBusinesses", read, adminOperationsController.getAllBusinesses);
router.get("/getBusinessesById/:id", read, adminOperationsController.getBusinessesById);
router.get("/getAllClients", read, adminOperationsController.getAllClients);

export default router;
