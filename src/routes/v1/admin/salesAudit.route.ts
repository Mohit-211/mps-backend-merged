import express from 'express';
import * as audits from '../../../controllers/salesAudit/salesAudit.controller';
import { adminOnly } from '../../../middlewares/auth/adminAuth.middleware';
import { validateAuditId, validateAutocomplete, validateStart } from '../../../middlewares/salesAudit/salesAudit.validation';

// Sales audit (Phase 19), mounted at /api/v1/staff/audits. Staff only: an admin session with audits.run
// (super admin, admin, sales representative). Each audit is visible only to the staff member who started it.
const router = express.Router();
const run = adminOnly('audits.run');

router.get('/places/autocomplete', [...run, validateAutocomplete], audits.autocomplete);
router.get('/', run, audits.listAudits);
router.post('/', [...run, validateStart], audits.startAudit);
router.get('/:auditId', [...run, validateAuditId], audits.getAudit);
router.get('/:auditId/pdf', [...run, validateAuditId], audits.auditPdf);
router.delete('/:auditId', [...run, validateAuditId], audits.closeAudit);

export default router;
