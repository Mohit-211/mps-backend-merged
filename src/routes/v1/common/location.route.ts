import express from 'express';
import { locationController } from '../../../controllers';
import { locationMiddleware, userAuthMiddleware } from '../../../middlewares';
const router = express.Router();

router.post('/', [userAuthMiddleware.verifyAuthJWTToken, locationMiddleware.validCreateLocationBody], locationController.createLocation);
router.get('/:locationId', locationController.getLocationDetails);
router.delete('/:locationId', [userAuthMiddleware.verifyAuthJWTToken], locationController.deleteLocation);
router.put('/', [userAuthMiddleware.verifyAuthJWTToken], locationController.updateLocation);
router.get('/', [userAuthMiddleware.verifyAuthJWTToken], locationController.getLocationByUser);
router.get('/google-locations/:name', locationController.getGoogleLocations);
router.get('/google-locations/details/:placeId', locationController.getGoogleLocationDetails);

export default router;