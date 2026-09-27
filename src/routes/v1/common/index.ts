import  systemRoute from './system.route';
import  countryRoute from './country.route';
import  roleRoute from './role.route';
import  languageRoute from './language.route';
import  timezoneRoute from './timezone.route';
import faqRoute from './faq.route';
import supportRoute from './support.route';
import subscriptionRoutes from './subscription.route';
import contactUsRoutes from './contactUs.route';

import locationRoute from './location.route';
import rankingRoute from './ranking.route';
import onboardingRoute from './onboarding.route';
import placesRoute from './places.route';
import businessCategoryRoute from './businessCategory.route';
import whiteLabelRoute from './whitelabelProfile.route';
import gbpPSRoute from './gbpPostSchedular.route';
import paymentRoute from './payment.route';
import blogRoute from './blog.routes';
import blogCategoryRoutes from './blogCategory.routes';
import authRoute from './auth.route';
import organizationRoute from './organization.route';
import clientsRoute from './clients.route';
import dashboardRoute from './dashboard.route';
import reportsRoute from './reports.route';
import reportSchedulesRoute from './reportSchedules.route';



const commonRoutes = [
	{
		path: '/system',
		route: systemRoute,
	},
	{
		path: '/countries',
		route: countryRoute,
	},
	{
		path: '/roles',
		route: roleRoute,
	},
	{
		path: '/languages',
		route: languageRoute,
	},
	{
		path: '/timezones',
		route: timezoneRoute,
	},
	{
		path: '/faqs',
		route: faqRoute,
	},
	{
		path: '/supports',
		route: supportRoute
	},
	{
		path: '/subscription',
		route: subscriptionRoutes
	},
	{
		path: '/contact-us',
		route: contactUsRoutes
	},
	{
		path: '/locations',
		route: locationRoute,
	},
	{
		// Ranking reports (Phase 5): /locations/:locationId/{tracking,rank-runs,rank-tracker,grid,map-ranking}
		path: '/locations',
		route: rankingRoute,
	},
	{
		// Phase 8: signup / verify / login / password reset for the rebuilt app
		path: '/auth',
		route: authRoute,
	},
	{
		// Phase 8: the current organization, usage and members
		path: '/organization',
		route: organizationRoute,
	},
	{
		// Phase 8: agency clients
		path: '/clients',
		route: clientsRoute,
	},
	{
		// Phase 11: Business / Agency dashboard
		path: '/dashboard',
		route: dashboardRoute,
	},
	{
		// Phase 12: Reports center (library, PDF, email, share links) and scheduled reports
		path: '/reports',
		route: reportsRoute,
	},
	{
		path: '/report-schedules',
		route: reportSchedulesRoute,
	},
	{
		// Onboarding (Phase 7a): /onboarding/{state,gbp-profiles,select-profile,complete}
		path: '/onboarding',
		route: onboardingRoute,
	},
	{
		// Manual competitor search (Phase 7a): /places/search?q=&locationId=
		path: '/places',
		route: placesRoute,
	},
	{
		path: '/business-categories',
		route: businessCategoryRoute,
	},
	{
		path: '/white-label-profiles',
		route: whiteLabelRoute,
	},
	{
		path: '/gbp',
		route: gbpPSRoute,
	},
	{
		path: '/payments',
		route: paymentRoute,
	},
	{
		path: '/blog',
		route: blogRoute,
	},
	{
		path: '/blog-category',
		route: blogCategoryRoutes,
	},
];

export default commonRoutes;