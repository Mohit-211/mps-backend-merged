import adminAuthRoute from './adminAuth.route';
import adminOperationsRoute from './adminOperations.route';


const adminRoutes = [
    {
		path: '/admin/auth/',
		route: adminAuthRoute,
	},
	
	 {
		path: '/admin/operations/',
		route: adminOperationsRoute,
	},
];

export default adminRoutes;
