import { Router } from 'express';
import { systemController } from '../../../controllers';
import { adminAuthMiddleware } from '../../../middlewares';
const router = Router();


// Phase 10 (AUDIT S2): server details are super admin only.
router.use(...adminAuthMiddleware.adminOnly('system.read'));
router.get('/info' , systemController.getSystemInfo);
router.get('/time' , systemController.getServerTime);
router.get('/usage' , systemController.getResourceUsage);
router.get('/process' , systemController.getProcessInfo);

export default router;