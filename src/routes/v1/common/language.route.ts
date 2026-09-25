import express from 'express';
const router = express.Router();
import { languageController } from '../../../controllers';

router.get('/', languageController.getAllLanguage);

export default router;