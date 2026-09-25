import express from 'express';
import { faqController } from '../../../controllers';
import { faqMiddleware } from '../../../middlewares';
const router = express.Router();

router.get('/', faqController.getAllFaq);
router.post('/', [faqMiddleware.validCreateFaqBody], faqController.createFaq);
router.put('/:faqId', faqController.updateFaq);
router.delete('/:faqId', faqController.deleteFaq);

export default router;