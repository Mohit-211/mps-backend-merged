import express from 'express';
import { adminOperationsController } from '../../../controllers';

const router = express.Router();

router.get("/getAllAgencies", adminOperationsController.getAllAgencies);
router.get("/getAgencyById/:id", adminOperationsController.getAgencyById);
router.put("/updateAgencyStatus", adminOperationsController.updateAgencyStatus);
router.get("/getAllBusinesses", adminOperationsController.getAllBusinesses);
router.get("/getBusinessesById/:id", adminOperationsController.getBusinessesById);
router.get("/getAllClients", adminOperationsController.getAllClients);

export default router;