import express from 'express';
import * as reportsController from '../../../controllers/reports/reports.controller';
import { userAuthMiddleware } from '../../../middlewares';
import { loadOrgContext, requireWrite } from '../../../middlewares/org/org.middleware';
import { validateReportCreate, validateReportEmail, validateReportList, validateShareCreate } from '../../../middlewares/reports/reports.middleware';

// Reports center (Phase 12), mounted at /api/v1/reports. A client_user can list, view and download
// the reports of its clients' locations; creating, emailing, sharing and archiving need owner/member.
const router = express.Router();
const read = [userAuthMiddleware.verifyAuthJWTToken, loadOrgContext];
const write = [...read, requireWrite];

router.post('/', [...write, validateReportCreate], reportsController.create);
router.get('/', [...read, validateReportList], reportsController.list);
router.get('/:reportId', read, reportsController.get);
router.get('/:reportId/pdf', read, reportsController.pdf);
router.delete('/:reportId', write, reportsController.archive);
router.post('/:reportId/email', [...write, validateReportEmail], reportsController.email);
router.post('/:reportId/share', [...write, validateShareCreate], reportsController.share);
router.get('/:reportId/shares', write, reportsController.listShares);
router.delete('/:reportId/shares/:shareId', write, reportsController.revokeShare);

export default router;
