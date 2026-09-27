import express from 'express';
import { contactUsController } from '../../../controllers';
import { adminAuthMiddleware } from '../../../middlewares';
const router = express.Router();

router.post('/', contactUsController.createContactUs);
// Phase 10 (AUDIT S27): the inquiries (PII) are platform-admin only; submitting stays public.
router.get('/get', adminAuthMiddleware.adminOnly('platform.read'), contactUsController.getAllContactUs);
router.get('/:contactId', adminAuthMiddleware.adminOnly('platform.read'), contactUsController.getContactUsById);
router.put('/:contactId/status', adminAuthMiddleware.adminOnly('platform.write'), contactUsController.updateContactUsStatus);
router.delete('/:contactId', adminAuthMiddleware.adminOnly('platform.write'), contactUsController.deleteContactUs);

export default router;
