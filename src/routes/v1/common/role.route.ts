import { Router } from 'express';
import { roleController } from '../../../controllers';
import { adminAuthMiddleware } from '../../../middlewares';
const router = Router();


// Phase 10 (AUDIT S2): roles are platform admin data, super admin only.
router.use(...adminAuthMiddleware.adminOnly('admins.manage'));
router.post('/' , roleController.createRole);
router.get('/:roleId' , roleController.findRoleById);
router.get('/' , roleController.getAllRoles);
router.put('/:roleId' , roleController.updateRole);
router.delete('/:roleId' , roleController.deleteRole);

export default router;