import express from 'express';
import { listRoles } from '../../../controllers/admin/roles.controller';
import { adminOnly } from '../../../middlewares/auth/adminAuth.middleware';

// 13b: GET /api/v1/admin/roles (read-only; roles are fixed in src/configs/adminPermissions.ts).
const router = express.Router();
router.get('/', ...adminOnly('admins.manage'), listRoles);

export default router;
