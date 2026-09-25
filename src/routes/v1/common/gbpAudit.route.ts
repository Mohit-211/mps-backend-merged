import express from 'express';
import { gbpAuditController } from '../../../controllers';
import { gbpAuditMiddleware, userAuthMiddleware } from '../../../middlewares';
const router = express.Router();

router.post('/', [userAuthMiddleware.verifyAuthJWTToken, gbpAuditMiddleware.validCreateGBPAuditReportBody], gbpAuditController.generateGBPAuditReport);
router.get('/:locationId', [userAuthMiddleware.verifyAuthJWTToken, gbpAuditMiddleware.validFetchGBPAuditReportBody], gbpAuditController.getGBPAuditReport);

export default router;