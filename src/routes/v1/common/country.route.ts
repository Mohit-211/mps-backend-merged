import express from 'express';
import { countryController } from '../../../controllers';

const router = express.Router();

router.get('/', countryController.getAllCountry);
router.get('/states/:countryId', countryController.getAllStateByCountryId);
router.get('/cities/:stateId', countryController.getAllCityByStateId);
export default router;