import express from 'express';
import { citationController } from '../../../controllers';
import { userAuthMiddleware, citationMiddleware } from '../../../middlewares';
const router = express.Router();


router.get('/manual/listings/pricings', [userAuthMiddleware.verifyAuthJWTToken], citationController.getManualSubmissionPrices);
router.get('/aggregators/list', [userAuthMiddleware.verifyAuthJWTToken], citationController.getAggregatorsDetails);
router.get('/remove/prices/list', [userAuthMiddleware.verifyAuthJWTToken], citationController.getCitatioRemovePrices);

router.get('/lists/:location_id', [userAuthMiddleware.verifyAuthJWTToken, citationMiddleware.validGetCCitationListBody], citationController.getCitatioList);
router.post('/campaign/add/new', [userAuthMiddleware.verifyAuthJWTToken, citationMiddleware.validAddNewCitationCampaignBody], citationController.addCitationCampaign);
router.post('/campaign/add/busines/info', [userAuthMiddleware.verifyAuthJWTToken, citationMiddleware.validAddNewCitationCampaignBusinesInfoBody], citationController.addCitationCampaignBusinesInfo);
router.get('/:location_id/campaign/:campaign_id/details', [userAuthMiddleware.verifyAuthJWTToken], citationController.getCampaignDetails);
router.get('/:location_id/campaign/all', [userAuthMiddleware.verifyAuthJWTToken], citationController.getAllCampaign);

router.get('/locations/campaigns/list/all', [userAuthMiddleware.verifyAuthJWTToken], citationController.getAllCitationByToken);



router.post('/tracker', [userAuthMiddleware.verifyAuthJWTToken, citationMiddleware.validGenerateCitationTrackerReportBody], citationController.generateCitationTrackerReport);
router.get('/tracker', [userAuthMiddleware.verifyAuthJWTToken], citationController.getCitationTrackerReport);
router.post('/builder', [userAuthMiddleware.verifyAuthJWTToken], citationController.citationBuilder);


// admin api
router.get('/getAllCitatioList', citationController.getAllCitatioList);

export default router;