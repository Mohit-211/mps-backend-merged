import adminAuthRoute from './adminAuth.route';
import adminOperationsRoute from './adminOperations.route';
import adminCitationsRoute from './citations.route';


const adminRoutes = [
    {
		path: '/admin/auth/',
		route: adminAuthRoute,
	},
	
	 {
		path: '/admin/operations/',
		route: adminOperationsRoute,
	},
	{
		// Phase 16: citation admin (directories, categories, per-location lists, work queue).
		path: '/admin/citations',
		route: adminCitationsRoute,
	},
];

export default adminRoutes;
