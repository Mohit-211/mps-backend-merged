import express from 'express';
import { businessCategoryController } from '../../../controllers';
import { adminAuthMiddleware, businessCategoryMiddleware } from '../../../middlewares';
const router = express.Router();

router.post('/', [...adminAuthMiddleware.adminOnly('content.manage'), businessCategoryMiddleware.validCreateBusinessCategoryBody], businessCategoryController.createBusinessCategory);
router.get('/', businessCategoryController.getAllBusinessCategory);
router.put('/:businessCategoryId', [...adminAuthMiddleware.adminOnly('content.manage'), businessCategoryMiddleware.validUpdateBusinessCategoryBody], businessCategoryController.updateBusinessCategory);

export default router;