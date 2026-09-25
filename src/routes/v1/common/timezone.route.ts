import express from 'express';
const router = express.Router();
import { timezoneController } from '../../../controllers';

router.get('/', timezoneController.getAllTimezone);

export default router;