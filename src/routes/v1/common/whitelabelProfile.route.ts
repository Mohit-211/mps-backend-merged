import express from 'express';
import { whitelabelProfileController } from '../../../controllers';
import { userAuthMiddleware, WhiteLabelProfileMiddleware } from '../../../middlewares';
const router = express.Router();

router.post('/', [userAuthMiddleware.verifyAuthJWTToken, WhiteLabelProfileMiddleware.validateNewWhiteLabelBody], whitelabelProfileController.createNewProfile);
router.patch('/', [userAuthMiddleware.verifyAuthJWTToken, WhiteLabelProfileMiddleware.validateUpdateWhiteLabelBody], whitelabelProfileController.updateWhiteLabelProfile);
router.get('/', [userAuthMiddleware.verifyAuthJWTToken], whitelabelProfileController.getWhiteLabelProfile);
router.get('/:whiteLevelProfileId', whitelabelProfileController.getWhiteLabelProfileDetail);
router.delete('/:whiteLevelProfileId', [userAuthMiddleware.verifyAuthJWTToken], whitelabelProfileController.deleteWhiteLevelProfile);


// The public report links (rank-tracker, reputation-manager, gbp-audit) were removed with the
// legacy report code; see docs/LEGACY_FEATURES.md to rebuild them on the new data.

export default router;