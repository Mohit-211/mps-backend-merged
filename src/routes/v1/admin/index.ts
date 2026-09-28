import adminAuthRoute from './adminAuth.route';
import adminCitationsRoute from './citations.route';
import adminBillingRoute from './billing.route';
import adminRolesRoute from './roles.route';
import adminPanelRoute from './adminPanel.route';
import adminAccountsRoute from './admins.route';


const adminRoutes = [
    {
		path: '/admin/auth',
		route: adminAuthRoute,
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
	{
		// Phase 13b: admin accounts (super admin).
		path: '/admin/admins',
		route: adminAccountsRoute,
	},
	{
		// Phase 13b: the admin roles and their permissions (read-only).
		path: '/admin/roles',
		route: adminRolesRoute,
	},
	{
		// Phase 13b: admin panel (overview, users, organizations, support tickets).
		path: '/admin',
		route: adminPanelRoute,
	},
];

export default adminRoutes;
