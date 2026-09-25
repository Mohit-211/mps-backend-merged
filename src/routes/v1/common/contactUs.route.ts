import express from 'express';
import { contactUsController } from '../../../controllers';
const router = express.Router();

router.post('/', contactUsController.createContactUs);
router.get('/get', contactUsController.getAllContactUs);
router.get('/:contactId', contactUsController.getContactUsById);
router.put('/:contactId/status', contactUsController.updateContactUsStatus);
router.delete('/:contactId', contactUsController.deleteContactUs);

export default router;
