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
import businessCategoryRoute from './businessCategory.route';
import rankTrackerRoute from './rankTracker.route';
import reputationManagerRoute from './reputationManagerReport.route';
import gbpAuditRoute from './gbpAudit.route';
import whiteLabelRoute from './whitelabelProfile.route';
import localSearchGridRoute from './localSearchGrid.route';
import localMapRankingRoute from './localMapRankingReport.route';
import gbpPSRoute from './gbpPostSchedular.route';
import citationRoute from './citation.route';
import paymentRoute from './payment.route';
import blogRoute from './blog.routes';
import blogCategoryRoutes from './blogCategory.routes';



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
		path: '/business-categories',
		route: businessCategoryRoute,
	},
	{
		path: '/rank-tracker',
		route: rankTrackerRoute,
	},
	{
		path: '/reputation-manager',
		route: reputationManagerRoute,
	},
	{
		path: '/gbp-audit',
		route: gbpAuditRoute,
	},
	{
		path: '/white-label-profiles',
		route: whiteLabelRoute,
	},
	{
		path: '/local-search-grid',
		route: localSearchGridRoute,
	},
	{
		path: '/local-map-ranking',
		route: localMapRankingRoute,
	},
	{
		path: '/gbp',
		route: gbpPSRoute,
	},
	{
		path: '/citation',
		route: citationRoute,
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