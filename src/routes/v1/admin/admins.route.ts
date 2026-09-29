import express from 'express';
import * as controller from '../../../controllers/admin/adminAuth.controller';
import { adminAuthMiddleware } from '../../../middlewares';
import * as v from '../../../middlewares/admin/adminAuth.validation';

// 13b: admin accounts (/admin/admins), super admin only (admins.manage). Admins are deactivated
// (PATCH is_active: false), never deleted.
const router = express.Router();
router.use(...adminAuthMiddleware.adminOnly('admins.manage'));

router.get('/', v.validateListAdmins, controller.listAdmins);
router.post('/', v.validateCreateAdmin, controller.createAdmin);
router.get('/:adminId', v.validateAdminIdParam, controller.getAdmin);
router.patch('/:adminId', v.validateAdminIdParam, v.validateUpdateAdmin, controller.updateAdmin);
router.post('/:adminId/password-link', v.validateAdminIdParam, controller.resendPasswordLink);

export default router;
