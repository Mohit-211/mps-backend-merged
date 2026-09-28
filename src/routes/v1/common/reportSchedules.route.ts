import express from 'express';
import * as reportsController from '../../../controllers/reports/reports.controller';
import { userAuthMiddleware } from '../../../middlewares';
import { loadOrgContext, requireWrite } from '../../../middlewares/org/org.middleware';
import { validateScheduleCreate, validateScheduleList, validateScheduleUpdate } from '../../../middlewares/reports/reports.middleware';
import { requireBilling } from '../../../middlewares/billing/billing.middleware';

// Scheduled reports (Phase 12), mounted at /api/v1/report-schedules. Monthly, after each covered
// location's automatic refresh. A client_user can read the schedules of its clients.
const router = express.Router();
const read = [userAuthMiddleware.verifyAuthJWTToken, loadOrgContext];
const write = [...read, requireWrite];

router.post('/', [...write, requireBilling, validateScheduleCreate], reportsController.createSchedule);
router.get('/', [...read, validateScheduleList], reportsController.listSchedules);
router.get('/:scheduleId', read, reportsController.getSchedule);
router.patch('/:scheduleId', [...write, requireBilling, validateScheduleUpdate], reportsController.updateSchedule);
router.delete('/:scheduleId', write, reportsController.deleteSchedule);

export default router;
