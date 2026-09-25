import { Router } from 'express';
import { systemController } from '../../../controllers';
const router = Router();


router.get('/info' , systemController.getSystemInfo);
router.get('/time' , systemController.getServerTime);
router.get('/usage' , systemController.getResourceUsage);
router.get('/process' , systemController.getProcessInfo);

export default router;