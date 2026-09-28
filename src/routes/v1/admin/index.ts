import adminAuthRoute from './adminAuth.route';
import adminOperationsRoute from './adminOperations.route';
import adminCitationsRoute from './citations.route';
import adminBillingRoute from './billing.route';


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
	{
		// Phase 13a: billing admin (plans and prices, custom plans, subscriptions, invoices, tokens, coupons).
		path: '/admin/billing',
		route: adminBillingRoute,
	},
];

export default adminRoutes;
