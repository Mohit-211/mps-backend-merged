import express from 'express';
import { localSearchGridController } from '../../../controllers';
import { localSearchGridMiddleware, userAuthMiddleware } from '../../../middlewares';
const router = express.Router();

router.post('/', [userAuthMiddleware.verifyAuthJWTToken, localSearchGridMiddleware.validCreateLocalSearchGridReportDocBody], localSearchGridController.generateLocalSearchGridReport);
router.get('/:locationId', [userAuthMiddleware.verifyAuthJWTToken, localSearchGridMiddleware.validFetchLocalSearchGridReportDocBody], localSearchGridController.getLocalSearchGridReport);

export default router;