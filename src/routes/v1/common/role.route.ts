import { Router } from 'express';
import { roleController } from '../../../controllers';
const router = Router();


router.post('/' , roleController.createRole);
router.get('/:roleId' , roleController.findRoleById);
router.get('/' , roleController.getAllRoles);
router.put('/:roleId' , roleController.updateRole);
router.delete('/:roleId' , roleController.deleteRole);

export default router;