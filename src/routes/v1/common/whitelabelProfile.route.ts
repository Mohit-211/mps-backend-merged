import express from 'express';
import { whitelabelProfileController } from '../../../controllers';
import { userAuthMiddleware, WhiteLabelProfileMiddleware } from '../../../middlewares';
const router = express.Router();

router.post('/', [userAuthMiddleware.verifyAuthJWTToken, WhiteLabelProfileMiddleware.validateNewWhiteLabelBody], whitelabelProfileController.createNewProfile);
router.patch('/', [userAuthMiddleware.verifyAuthJWTToken, WhiteLabelProfileMiddleware.validateUpdateWhiteLabelBody], whitelabelProfileController.updateWhiteLabelProfile);
router.get('/', [userAuthMiddleware.verifyAuthJWTToken], whitelabelProfileController.getWhiteLabelProfile);
router.get('/:whiteLevelProfileId', whitelabelProfileController.getWhiteLabelProfileDetail);
router.delete('/:whiteLevelProfileId', [userAuthMiddleware.verifyAuthJWTToken], whitelabelProfileController.deleteWhiteLevelProfile);


// Reports
router.get('/rank-tracker-report/:whiteLevelProfileId', [WhiteLabelProfileMiddleware.validateWLPReportParams], whitelabelProfileController.getRankTrackerReportForWLP);
router.get('/reputation-manager-report/:whiteLevelProfileId', [WhiteLabelProfileMiddleware.validateWLPReportParams], whitelabelProfileController.getReputationManagerReportForWLP);
router.get('/gbp-audit-report/:whiteLevelProfileId', [WhiteLabelProfileMiddleware.validateWLPReportParams], whitelabelProfileController.getGBPAuditReportForWLP);


export default router;