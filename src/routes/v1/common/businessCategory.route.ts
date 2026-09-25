import express from 'express';
import { businessCategoryController } from '../../../controllers';
import { businessCategoryMiddleware } from '../../../middlewares';
const router = express.Router();

router.post('/', [businessCategoryMiddleware.validCreateBusinessCategoryBody], businessCategoryController.createBusinessCategory);
router.get('/', businessCategoryController.getAllBusinessCategory);
router.put('/:businessCategoryId', [businessCategoryMiddleware.validUpdateBusinessCategoryBody], businessCategoryController.updateBusinessCategory);

export default router;