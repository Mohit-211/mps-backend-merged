import { Router } from 'express';
const router = Router();

import commonRoutes from './common';
import adminRoutes from './admin';
import userAuthRoutes from './user';

const defaultRoutes = [...commonRoutes, ...adminRoutes, ...userAuthRoutes];

defaultRoutes.forEach((route) => {
  router.use(route.path, route.route);
});

export default router;
