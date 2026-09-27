import express from 'express';
import { faqController } from '../../../controllers';
import { adminAuthMiddleware, faqMiddleware } from '../../../middlewares';
const router = express.Router();

router.get('/', faqController.getAllFaq);
// Phase 10 (AUDIT S27): writes need content.manage.
const content = adminAuthMiddleware.adminOnly('content.manage');
router.post('/', [...content, faqMiddleware.validCreateFaqBody], faqController.createFaq);
router.put('/:faqId', content, faqController.updateFaq);
router.delete('/:faqId', content, faqController.deleteFaq);

export default router;