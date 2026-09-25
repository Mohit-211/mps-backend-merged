import express from 'express';
import { localMapRankingController } from '../../../controllers';
import { localMapRankingMiddleware, userAuthMiddleware } from '../../../middlewares';
const router = express.Router();


router.post('/', [userAuthMiddleware.verifyAuthJWTToken, localMapRankingMiddleware.validCreateLocalMapRankingReportDocBody], localMapRankingController.generateLocalMapRankingReport);
router.get('/:locationId', [userAuthMiddleware.verifyAuthJWTToken, localMapRankingMiddleware.validFetchLocalMapRankingReportDocBody], localMapRankingController.getLocalMapRankingReport);


export default router;
