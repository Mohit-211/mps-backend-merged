import { Router } from 'express';
const router = Router();

import commonRoutes from './common';
import adminRoutes from './admin';

const defaultRoutes = [...commonRoutes, ...adminRoutes];

defaultRoutes.forEach((route) => {
  router.use(route.path, route.route);
});

export default router;
