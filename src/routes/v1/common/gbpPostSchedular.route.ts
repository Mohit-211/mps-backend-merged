import express from 'express';
import { gbpPSController } from '../../../controllers';
import { userAuthMiddleware, gbpPostSchedularMiddleware } from '../../../middlewares';
import { uploadFiles } from '../../../configs/multer';
import * as connectController from '../../../controllers/gbp/connect.controller';
const router = express.Router();
const signedIn = [userAuthMiddleware.verifyAuthJWTToken];

// Google connect (13b: moved from /user/auth/google/gbp/*). The callback is public: Google calls it with the one-time state.
router.get('/connect/popup', signedIn, connectController.popupConfig);
router.post('/connect/code', signedIn, connectController.popupCode);
router.get('/connect/url', signedIn, connectController.authUrl);
router.get('/connect/callback', connectController.callback);
router.post('/disconnect', signedIn, connectController.disconnect);

router.get('/', [userAuthMiddleware.verifyAuthJWTToken], gbpPSController.getRegisteredGoogleBusinessProfile);
router.post('/bind', [userAuthMiddleware.verifyAuthJWTToken, gbpPostSchedularMiddleware.validateBindGBPbody], gbpPSController.bindGoogleBusinessProfileWithUser);
router.post('/unbind', [userAuthMiddleware.verifyAuthJWTToken, gbpPostSchedularMiddleware.validateUnbindGBPbody], gbpPSController.unbindGoogleBusinessProfileWithUser);
router.post('/post/add', [userAuthMiddleware.verifyAuthJWTToken, ...uploadFiles, gbpPostSchedularMiddleware.validateGBPPostbody], gbpPSController.addPostToGBP);
router.get('/post/all/:location_id/:type', [userAuthMiddleware.verifyAuthJWTToken, gbpPostSchedularMiddleware.validateGetAllPostbody], gbpPSController.getAllPostByLocationId);
router.delete('/post/remove', [userAuthMiddleware.verifyAuthJWTToken], gbpPSController.deletePost);
export default router;