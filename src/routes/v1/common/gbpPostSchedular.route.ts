import express from 'express';
import { gbpPSController } from '../../../controllers';
import { userAuthMiddleware, gbpPostSchedularMiddleware } from '../../../middlewares';
const router = express.Router();

router.get('/', [userAuthMiddleware.verifyAuthJWTToken], gbpPSController.getRegisteredGoogleBusinessProfile);
router.post('/bind-with-user', [userAuthMiddleware.verifyAuthJWTToken, gbpPostSchedularMiddleware.validateBindGBPbody], gbpPSController.bindGoogleBusinessProfileWithUser);
router.post('/post/add', [userAuthMiddleware.verifyAuthJWTToken, gbpPostSchedularMiddleware.validateGBPPostbody], gbpPSController.addPostToGBP);
router.get('/post/all/:location_id/:type', [userAuthMiddleware.verifyAuthJWTToken, gbpPostSchedularMiddleware.validateGetAllPostbody], gbpPSController.getAllPostByLocationId);
router.delete('/post/remove', [userAuthMiddleware.verifyAuthJWTToken], gbpPSController.deletePost);
export default router;