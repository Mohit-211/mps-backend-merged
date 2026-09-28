import express from 'express';
import * as billing from '../../../controllers/billing/billing.controller';
import { validatePricing } from '../../../middlewares/billing/billing.validation';

// Public pricing (Phase 13a), mounted at /api/v1/pricing: the standard plan for the marketing site.
const router = express.Router();
router.get('/', validatePricing, billing.pricing);
export default router;
