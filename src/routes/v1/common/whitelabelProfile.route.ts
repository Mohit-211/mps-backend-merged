import express from 'express';
import { whitelabelProfileController } from '../../../controllers';
import { userAuthMiddleware, WhiteLabelProfileMiddleware } from '../../../middlewares';
import { uploadFiles } from '../../../configs/multer';
const router = express.Router();

router.post('/', [userAuthMiddleware.verifyAuthJWTToken, ...uploadFiles, WhiteLabelProfileMiddleware.validateNewWhiteLabelBody], whitelabelProfileController.createNewProfile);
router.patch('/', [userAuthMiddleware.verifyAuthJWTToken, ...uploadFiles, WhiteLabelProfileMiddleware.validateUpdateWhiteLabelBody], whitelabelProfileController.updateWhiteLabelProfile);
router.get('/', [userAuthMiddleware.verifyAuthJWTToken], whitelabelProfileController.getWhiteLabelProfile);
// Phase 10 (AUDIT S17): no longer public; the owner only, and never the access password.
router.get('/:whiteLevelProfileId', [userAuthMiddleware.verifyAuthJWTToken], whitelabelProfileController.getWhiteLabelProfileDetail);
router.delete('/:whiteLevelProfileId', [userAuthMiddleware.verifyAuthJWTToken], whitelabelProfileController.deleteWhiteLevelProfile);


// The public report links (rank-tracker, reputation-manager, gbp-audit) were removed with the
// legacy report code; see docs/LEGACY_FEATURES.md to rebuild them on the new data.

export default router;