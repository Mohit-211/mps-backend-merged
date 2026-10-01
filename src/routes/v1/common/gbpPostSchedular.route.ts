import express from 'express';
import { gbpPSController } from '../../../controllers';
import { userAuthMiddleware, gbpPostSchedularMiddleware } from '../../../middlewares';
import { uploadFiles } from '../../../configs/multer';
import * as connectController from '../../../controllers/gbp/connect.controller';
import * as picksController from '../../../controllers/gbp/picks.controller';
import { validateBindPick, validateSavePicks } from '../../../middlewares/gbp/picks.validation';
import { loadOrgContext, requireWrite } from '../../../middlewares/org/org.middleware';
import { requireBilling } from '../../../middlewares/billing/billing.middleware';
const router = express.Router();
const signedIn = [userAuthMiddleware.verifyAuthJWTToken];

// Google connect (13b: moved from /user/auth/google/gbp/*). The callback is public: Google calls it with the one-time state.
router.get('/connect/popup', signedIn, connectController.popupConfig);
router.post('/connect/code', signedIn, connectController.popupCode);
router.get('/connect/url', signedIn, connectController.authUrl);
router.get('/connect/callback', connectController.callback);
router.post('/disconnect', signedIn, connectController.disconnect);

// Connected accounts, the connect modal's location list and picks, and the Bind button (2026-10-01).
// Per user; picks and bound locations belong to the current organization. Binding goes through the subscription gate.
const inOrg = [userAuthMiddleware.verifyAuthJWTToken, loadOrgContext];
router.get('/connections', inOrg, picksController.connections);
router.get('/connections/:googleSub/locations', inOrg, picksController.accountLocations);
router.put('/connections/:googleSub/picks', [...inOrg, requireWrite, validateSavePicks], picksController.savePicks);
router.post('/picks/:pickId/bind', [...inOrg, requireWrite, requireBilling, validateBindPick], picksController.bind);
router.delete('/picks/:pickId', [...inOrg, requireWrite], picksController.removePick);

router.post('/unbind', [userAuthMiddleware.verifyAuthJWTToken, gbpPostSchedularMiddleware.validateUnbindGBPbody], gbpPSController.unbindGoogleBusinessProfileWithUser);
router.post('/post/add', [userAuthMiddleware.verifyAuthJWTToken, ...uploadFiles, gbpPostSchedularMiddleware.validateGBPPostbody], gbpPSController.addPostToGBP);
router.get('/post/all/:location_id/:type', [userAuthMiddleware.verifyAuthJWTToken, gbpPostSchedularMiddleware.validateGetAllPostbody], gbpPSController.getAllPostByLocationId);
router.delete('/post/remove', [userAuthMiddleware.verifyAuthJWTToken], gbpPSController.deletePost);
export default router;