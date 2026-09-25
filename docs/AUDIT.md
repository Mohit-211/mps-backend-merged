# Phase 1 audit: MyPageSEO backend

- **Baseline commit:** `62240ac` (Initial commit, branch `main`)
- **Audit date:** 2026-09-25
- **Method:** Read every file under `src/`, plus `package.json`, `ecosystem.config.json`, `nodemon.json`, `.gitignore`, `swagger.json`, `tsconfig.json` and `eslint.config.mjs`. Build, lint and `npm audit` were run on a copy of the repo so the working tree stayed untouched. Behaviours marked **(tested)** were reproduced with a small script against the repo's installed library versions. Everything else was verified by reading the code.
- **Line numbers** refer to the baseline commit. The Phase 1.5 line-ending change does not move line numbers. Files deleted in Phase 1.5 are marked as such in §7.

Every finding has a **Status** column. Update it in the commit that changes the status, and record that commit in `docs/PROGRESS.md`.

Status values:
- `Open`: not yet addressed.
- `Fixed <hash>`: fixed in that commit.
- `Planned Pn`: scheduled for phase *n* in CLAUDE.md.
- `Won't fix`: out of scope; kept for the record.

---

## 0. Baseline tooling results

| Check | Result |
|---|---|
| `npm install` | Succeeds. No lockfile is committed, so installs are not reproducible. |
| `npm run build` | **Fails. 46 TypeScript errors.** 44 are TS2322 and share one cause: `schema: Model<Document>` in [src/utils/mongoFunctions.ts:19](../src/utils/mongoFunctions.ts#L19) rejects every typed model passed to it. The other 2 come from C11 ([rankTrackerReport.ts:220](../src/helpers/rankTrackerReport.ts#L220), [:222](../src/helpers/rankTrackerReport.ts#L222)). The script also runs `shx cp package-lock.json` and `shx cp .env`, which fail because neither file is in the repo. |
| `npm run lint` | **115 errors, 0 warnings.** Coverage is incomplete: the glob `src/**/*.ts` is not quoted, so `sh` expands `**` as `*` and only lints `src/<dir>/<file>.ts`. Nothing under `services/common`, `services/user`, `controllers/*/`, `routes/v1/*/` or `middlewares/*/` is linted. |
| `npm audit` | 6 vulnerabilities: 1 high (`nodemailer`: SMTP command injection and email to an unintended domain) and 5 moderate (`uuid` bounds check, pulled in by `googleapis` → `googleapis-common` → `gaxios`, and by `node-cron`). |
| Tests | None exist. |

---

## 1. Architecture map

- **Entry chain:** `index.ts` → `src/server.ts` (http/https server, `uncaughtException` handler exits) → `src/app.ts`.
- **Global middleware order** in `app.ts`:
  1. `helmet.contentSecurityPolicy` (CSP only)
  2. `express.json({limit:'100mb'})`
  3. `express.urlencoded({limit:'100mb'})`
  4. `requestIp.mw()`
  5. `compression`
  6. morgan success/error loggers
  7. `getQueryParams`
  8. `express.static(public)`
  9. wildcard CORS headers
  10. `credentials`
  11. `cors(allowlist)`
  12. `authLimiter` on `/v1/auth` (production only, and that path matches nothing)
  13. `/api/v1` → **multer `upload` → `handleImageCompression` → routes**
  14. swagger at `/docs`
  15. `/api/v1/logs` handlers
  16. `/:type/:filename` file routes
  17. 404 handler
  18. `apiErrorHandler`
- **Route groups:** `src/routes/v1/index.ts` mounts `commonRoutes`, `adminRoutes` and `userRoutes` under `/api/v1`.
- **Service and model columns:** controllers call the function of the same name in the matching service module. The Models column lists what that service module reads or writes. Validation middlewares additionally read `Location`, `UserGBP` and `Client`.
- **Totals:** 155 live routes. 95 require no auth, 56 require a user access token, 2 require a refresh token, 2 require an admin token.

The route list without middleware detail is in [ROUTES.md](ROUTES.md).

**Admin**

| Method | Path | Middlewares (in order) | Controller | Service | Models | Auth |
|---|---|---|---|---|---|---|
| POST | `/api/v1/admin/auth/register` | — | `adminAuthController.createAdminUser` | adminAuth.createAdminUser | Admin, Role | **none** |
| POST | `/api/v1/admin/auth/login` | validateSignInReqBody | `adminAuthController.loginAdminUser` | adminAuth.loginAdminUser | Admin, Role | **none** |
| POST | `/api/v1/admin/auth/sendOTP` | — | `adminAuthController.sendOTP` | adminAuth.sendOTP | Admin, Role | **none** |
| POST | `/api/v1/admin/auth/verifyOTP` | — | `adminAuthController.verifyOTP` | adminAuth.verifyOTP | Admin, Role | **none** |
| POST | `/api/v1/admin/auth/resetPassword` | validateAdminJWTToken | `adminAuthController.resetAdminPassword` | adminAuth.resetAdminPassword | Admin, Role | admin |
| POST | `/api/v1/admin/auth/forgotPassword` | — | `adminAuthController.forgotAdminPassword` | adminAuth.forgotAdminPassword | Admin, Role | **none** |
| GET | `/api/v1/admin/auth/getAllAdmins` | — | `adminAuthController.getAllAdmins` | adminAuth.getAllAdmins | Admin, Role | **none** |
| GET | `/api/v1/admin/auth/getAdminById/:id` | — | `adminAuthController.findAdminById` | adminAuth.findAdminById | Admin, Role | **none** |
| GET | `/api/v1/admin/auth/getProfile` | validateAdminJWTToken | `adminAuthController.getProfile` | adminAuth.getProfile | Admin, Role | admin |
| PUT | `/api/v1/admin/auth/updateAdmin` | — | `adminAuthController.updateAdmin` | adminAuth.updateAdmin | Admin, Role | **none** |
| DELETE | `/api/v1/admin/auth/deleteAdmin` | — | `adminAuthController.deleteAdmin` | adminAuth.deleteAdmin | Admin, Role | **none** |
| GET | `/api/v1/admin/operations/getAllAgencies` | — | `adminOperationsController.getAllAgencies` | adminOperations.getAllAgencies | User, Client | **none** |
| GET | `/api/v1/admin/operations/getAgencyById/:id` | — | `adminOperationsController.getAgencyById` | adminOperations.getAgencyById | User, Client | **none** |
| PUT | `/api/v1/admin/operations/updateAgencyStatus` | — | `adminOperationsController.updateAgencyStatus` | adminOperations.updateAgencyStatus | User, Client | **none** |
| GET | `/api/v1/admin/operations/getAllBusinesses` | — | `adminOperationsController.getAllBusinesses` | adminOperations.getAllBusinesses | User, Client | **none** |
| GET | `/api/v1/admin/operations/getBusinessesById/:id` | — | `adminOperationsController.getBusinessesById` | adminOperations.getBusinessesById | User, Client | **none** |
| GET | `/api/v1/admin/operations/getAllClients` | — | `adminOperationsController.getAllClients` | adminOperations.getAllClients | User, Client | **none** |

**User auth & account**

| Method | Path | Middlewares (in order) | Controller | Service | Models | Auth |
|---|---|---|---|---|---|---|
| POST | `/api/v1/user/auth/register` | insertUserRoleId → validateRegisterUserBody | `userAuthController.register` | userAuth.register | User, Profile, OTP, UserToken, UserAuth, UserLoginTiming | **none** |
| POST | `/api/v1/user/auth/otp` | — | `userAuthController.sendOTP` | userAuth.sendOTP | User, Profile, OTP, UserToken, UserAuth, UserLoginTiming | **none** |
| POST | `/api/v1/user/auth/verify-otp` | — | `userAuthController.verifyOTP` | userAuth.verifyOTP | User, Profile, OTP, UserToken, UserAuth, UserLoginTiming | **none** |
| POST | `/api/v1/user/auth/login` | validateSignInReqBody | `userAuthController.login` | userAuth.login | User, Profile, OTP, UserToken, UserAuth, UserLoginTiming | **none** |
| POST | `/api/v1/user/auth/reset-password` | verifyAuthJWTToken | `userAuthController.resetPassword` | userAuth.resetPassword | User, Profile, OTP, UserToken, UserAuth, UserLoginTiming | user |
| POST | `/api/v1/user/auth/forgot-password` | validateForgetPassordToken | `userAuthController.forgotPassword` | userAuth.forgotPassword | User, Profile, OTP, UserToken, UserAuth, UserLoginTiming | **none** |
| POST | `/api/v1/user/auth/refresh-auth` | verifyRefreshAuthJWTToken | `userAuthController.refreshAuth` | userAuth.refreshAuth | User, Profile, OTP, UserToken, UserAuth, UserLoginTiming | refresh token |
| POST | `/api/v1/user/auth/logout` | verifyRefreshAuthJWTToken | `userAuthController.logout` | userAuth.logout | User, Profile, OTP, UserToken, UserAuth, UserLoginTiming | refresh token |
| GET | `/api/v1/user/auth/deactivate` | verifyAuthJWTToken | `userAuthController.deactivateAccount` | userAuth.deactivateAccount | User, Profile, OTP, UserToken, UserAuth, UserLoginTiming | user |
| GET | `/api/v1/user/auth/google/analytics` | verifyAuthJWTToken | `userAuthController.getAnalyticsAuthUrl` | userAuth.getAnalyticsAuthUrl | User, Profile, OTP, UserToken, UserAuth, UserLoginTiming | user |
| GET | `/api/v1/user/auth/google/analytics/callback` | — | `userAuthController.analyticsAuthCallback` | userAuth.analyticsAuthCallback | User, Profile, OTP, UserToken, UserAuth, UserLoginTiming | **none** |
| POST | `/api/v1/user/auth/google/analytics/revoke` | verifyAuthJWTToken | `userAuthController.analyticsConnectionRevoke` | userAuth.analyticsConnectionRevoke | User, Profile, OTP, UserToken, UserAuth, UserLoginTiming | user |
| GET | `/api/v1/user/auth/google/gbp` | verifyAuthJWTToken | `userAuthController.getGBPAuthUrl` | userAuth.getGBPAuthUrl | User, Profile, OTP, UserToken, UserAuth, UserLoginTiming | user |
| GET | `/api/v1/user/auth/google/gbp/callback` | — | `userAuthController.gBPAuthCallback` | userAuth.gBPAuthCallback | User, Profile, OTP, UserToken, UserAuth, UserLoginTiming | **none** |
| POST | `/api/v1/user/auth/google/gbp/revoke` | verifyAuthJWTToken | `userAuthController.gBPConnectionRevoke` | userAuth.gBPConnectionRevoke | User, Profile, OTP, UserToken, UserAuth, UserLoginTiming | user |
| POST | `/api/v1/user/auth/employee/add` | verifyAuthJWTToken → validateAddEmployeeBody | `userAuthController.addEmployee` | userAuth.addEmployee | User, Profile, OTP, UserToken, UserAuth, UserLoginTiming | user |
| DELETE | `/api/v1/user/auth/employee/remove` | verifyAuthJWTToken | `userAuthController.deleteEmployee` | userAuth.deleteEmployee | User, Profile, OTP, UserToken, UserAuth, UserLoginTiming | user |
| GET | `/api/v1/user/auth/employee/all` | verifyAuthJWTToken | `userAuthController.getAllEmployeeByOwner` | userAuth.getAllEmployeeByOwner | User, Profile, OTP, UserToken, UserAuth, UserLoginTiming | user |
| GET | `/api/v1/user/auth/employee/details/:employee_id` | verifyAuthJWTToken | `userAuthController.employeeDetails` | userAuth.employeeDetails | User, Profile, OTP, UserToken, UserAuth, UserLoginTiming | user |
| GET | `/api/v1/user/profile` | verifyAuthJWTToken | `userOperationController.getProfile` | userOperations.getProfile | User, Profile, Client, Location | user |
| POST | `/api/v1/user/notifications` | verifyAuthJWTToken | `userOperationController.notificationToogle` | userOperations.notificationToogle | User, Profile, Client, Location | user |
| PUT | `/api/v1/user/profile` | validateUpdateProfilerBody → verifyAuthJWTToken | `userOperationController.updateProfile` | userOperations.updateProfile | User, Profile, Client, Location | user |
| POST | `/api/v1/user/clients` | verifyAuthJWTToken → isAgency → validateCreateClientBody | `userOperationController.createClient` | userOperations.createClient | User, Profile, Client, Location | user |
| GET | `/api/v1/user/clients` | verifyAuthJWTToken → isAgency | `userOperationController.getAllClient` | userOperations.getAllClient | User, Profile, Client, Location | user |
| GET | `/api/v1/user/clients/:client_id` | verifyAuthJWTToken → isAgency | `userOperationController.getClientDetails` | userOperations.getClientDetails | User, Profile, Client, Location | user |
| PUT | `/api/v1/user/clients` | verifyAuthJWTToken → isAgency | `userOperationController.updateClient` | userOperations.updateClient | User, Profile, Client, Location | user |
| DELETE | `/api/v1/user/clients/:client_id` | verifyAuthJWTToken → isAgency | `userOperationController.deleteClient` | userOperations.deleteClient | User, Profile, Client, Location | user |

**Locations**

| Method | Path | Middlewares (in order) | Controller | Service | Models | Auth |
|---|---|---|---|---|---|---|
| POST | `/api/v1/locations` | verifyAuthJWTToken → validCreateLocationBody | `locationController.createLocation` | location.createLocation | Location, Profile, Client, UserGBP, WhitelabelProfile, all report models | user |
| GET | `/api/v1/locations/:locationId` | — | `locationController.getLocationDetails` | location.getLocationDetails | Location, Profile, Client, UserGBP, WhitelabelProfile, all report models | **none** |
| DELETE | `/api/v1/locations/:locationId` | verifyAuthJWTToken | `locationController.deleteLocation` | location.deleteLocation | Location, Profile, Client, UserGBP, WhitelabelProfile, all report models | user |
| PUT | `/api/v1/locations` | verifyAuthJWTToken | `locationController.updateLocation` | location.updateLocation | Location, Profile, Client, UserGBP, WhitelabelProfile, all report models | user |
| GET | `/api/v1/locations` | verifyAuthJWTToken | `locationController.getLocationByUser` | location.getLocationByUser | Location, Profile, Client, UserGBP, WhitelabelProfile, all report models | user |
| GET | `/api/v1/locations/google-locations/:name` | — | `locationController.getGoogleLocations` | inline axios (controller) | — | **none** |
| GET | `/api/v1/locations/google-locations/details/:placeId` | — | `locationController.getGoogleLocationDetails` | inline axios (controller) | — | **none** |

**Ranking (in scope)**

| Method | Path | Middlewares (in order) | Controller | Service | Models | Auth |
|---|---|---|---|---|---|---|
| POST | `/api/v1/rank-tracker` | verifyAuthJWTToken → validCreateRankTrackerReportBody | `rankTrackerController.generateRankTrackerReport` | rankTracker.generateRankTrackerReport | RankTrackerReport, Location | user |
| GET | `/api/v1/rank-tracker/:locationId` | verifyAuthJWTToken → validFetchRankTrackerReportBody | `rankTrackerController.getRankTrackerReport` | rankTracker.getRankTrackerReport | RankTrackerReport, Location | user |
| POST | `/api/v1/local-search-grid` | verifyAuthJWTToken → validCreateLocalSearchGridReportDocBody | `localSearchGridController.generateLocalSearchGridReport` | localSearchGrid.generateLocalSearchGridReport | LocalSearchGridReport, Location | user |
| GET | `/api/v1/local-search-grid/:locationId` | verifyAuthJWTToken → validFetchLocalSearchGridReportDocBody | `localSearchGridController.getLocalSearchGridReport` | localSearchGrid.getLocalSearchGridReport | LocalSearchGridReport, Location | user |
| POST | `/api/v1/local-map-ranking` | verifyAuthJWTToken → validCreateLocalMapRankingReportDocBody | `localMapRankingController.generateLocalMapRankingReport` | localMapRankingReport.generateLocalMapRankingReport | LocalMapRankingReport, Location | user |
| GET | `/api/v1/local-map-ranking/:locationId` | verifyAuthJWTToken → validFetchLocalMapRankingReportDocBody | `localMapRankingController.getLocalMapRankingReport` | localMapRankingReport.getLocalMapRankingReport | LocalMapRankingReport, Location | user |

**GBP (in scope)**

| Method | Path | Middlewares (in order) | Controller | Service | Models | Auth |
|---|---|---|---|---|---|---|
| POST | `/api/v1/gbp-audit` | verifyAuthJWTToken → validCreateGBPAuditReportBody | `gbpAuditController.generateGBPAuditReport` | gbpAudit.generateGBPAuditReport | GBPAuditReport, Location | user |
| GET | `/api/v1/gbp-audit/:locationId` | verifyAuthJWTToken → validFetchGBPAuditReportBody | `gbpAuditController.getGBPAuditReport` | gbpAudit.getGBPAuditReport | GBPAuditReport, Location | user |
| GET | `/api/v1/gbp` | verifyAuthJWTToken | `gbpPSController.getRegisteredGoogleBusinessProfile` | gbpPostSchedular.getRegisteredGoogleBusinessProfile | GBPPost, UserGBP, UserAuth, Location | user |
| POST | `/api/v1/gbp/bind-with-user` | verifyAuthJWTToken → validateBindGBPbody | `gbpPSController.bindGoogleBusinessProfileWithUser` | gbpPostSchedular.bindGoogleBusinessProfileWithUser | GBPPost, UserGBP, UserAuth, Location | user |
| POST | `/api/v1/gbp/post/add` | verifyAuthJWTToken → validateGBPPostbody | `gbpPSController.addPostToGBP` | gbpPostSchedular.addPostToGBP | GBPPost, UserGBP, UserAuth, Location | user |
| GET | `/api/v1/gbp/post/all/:location_id/:type` | verifyAuthJWTToken → validateGetAllPostbody | `gbpPSController.getAllPostByLocationId` | gbpPostSchedular.getAllPostByLocationId | GBPPost, UserGBP, UserAuth, Location | user |
| DELETE | `/api/v1/gbp/post/remove` | verifyAuthJWTToken | `gbpPSController.deletePost` | gbpPostSchedular.deletePost | GBPPost, UserGBP, UserAuth, Location | user |

**White label**

| Method | Path | Middlewares (in order) | Controller | Service | Models | Auth |
|---|---|---|---|---|---|---|
| POST | `/api/v1/white-label-profiles` | verifyAuthJWTToken → validateNewWhiteLabelBody | `whitelabelProfileController.createNewProfile` | whitelabelProfile.createNewProfile | WhitelabelProfile, Location | user |
| PATCH | `/api/v1/white-label-profiles` | verifyAuthJWTToken → validateUpdateWhiteLabelBody | `whitelabelProfileController.updateWhiteLabelProfile` | whitelabelProfile.updateWhiteLabelProfile | WhitelabelProfile, Location | user |
| GET | `/api/v1/white-label-profiles` | verifyAuthJWTToken | `whitelabelProfileController.getWhiteLabelProfile` | whitelabelProfile.getWhiteLabelProfile | WhitelabelProfile, Location | user |
| GET | `/api/v1/white-label-profiles/:whiteLevelProfileId` | — | `whitelabelProfileController.getWhiteLabelProfileDetail` | whitelabelProfile.getWhiteLabelProfileDetail | WhitelabelProfile, Location | **none** |
| DELETE | `/api/v1/white-label-profiles/:whiteLevelProfileId` | verifyAuthJWTToken | `whitelabelProfileController.deleteWhiteLevelProfile` | whitelabelProfile.deleteWhiteLevelProfile | WhitelabelProfile, Location | user |
| GET | `/api/v1/white-label-profiles/rank-tracker-report/:whiteLevelProfileId` | validateWLPReportParams | `whitelabelProfileController.getRankTrackerReportForWLP` | rankTracker.getRankTrackerReportForWLP | RankTrackerReport, WhitelabelProfile, Location | **none** |
| GET | `/api/v1/white-label-profiles/reputation-manager-report/:whiteLevelProfileId` | validateWLPReportParams | `whitelabelProfileController.getReputationManagerReportForWLP` | reputationManagerReport.getReputationManagerReportForWLP | WhitelabelProfile, Location | **none** |
| GET | `/api/v1/white-label-profiles/gbp-audit-report/:whiteLevelProfileId` | validateWLPReportParams | `whitelabelProfileController.getGBPAuditReportForWLP` | gbpAudit.getGBPAuditReportForWLP | GBPAuditReport, WhitelabelProfile, Location | **none** |

**Reputation manager**

| Method | Path | Middlewares (in order) | Controller | Service | Models | Auth |
|---|---|---|---|---|---|---|
| GET | `/api/v1/reputation-manager/monitor-reviews/:locationId` | verifyAuthJWTToken → validFetchMonitorReviewReportBody | `reputationManagerController.getMonitorReviewReport` | reputationManagerReport.getMonitorReviewReport | Location | user |

**Citations**

| Method | Path | Middlewares (in order) | Controller | Service | Models | Auth |
|---|---|---|---|---|---|---|
| GET | `/api/v1/citation/manual/listings/pricings` | verifyAuthJWTToken | `citationController.getManualSubmissionPrices` | citation.getManualSubmissionPrices | LocationCitation, Campaign, Citation, CitationDirectory, Aggregator, … | user |
| GET | `/api/v1/citation/aggregators/list` | verifyAuthJWTToken | `citationController.getAggregatorsDetails` | citation.getAggregatorsDetails | LocationCitation, Campaign, Citation, CitationDirectory, Aggregator, … | user |
| GET | `/api/v1/citation/remove/prices/list` | verifyAuthJWTToken | `citationController.getCitatioRemovePrices` | citation.getCitatioRemovePrices | LocationCitation, Campaign, Citation, CitationDirectory, Aggregator, … | user |
| GET | `/api/v1/citation/lists/:location_id` | verifyAuthJWTToken → validGetCCitationListBody | `citationController.getCitatioList` | citation.getCitatioList | LocationCitation, Campaign, Citation, CitationDirectory, Aggregator, … | user |
| POST | `/api/v1/citation/campaign/add/new` | verifyAuthJWTToken → validAddNewCitationCampaignBody | `citationController.addCitationCampaign` | citation.addCitationCampaign | LocationCitation, Campaign, Citation, CitationDirectory, Aggregator, … | user |
| POST | `/api/v1/citation/campaign/add/busines/info` | verifyAuthJWTToken → validAddNewCitationCampaignBusinesInfoBody | `citationController.addCitationCampaignBusinesInfo` | citation.addCitationCampaignBusinesInfo | LocationCitation, Campaign, Citation, CitationDirectory, Aggregator, … | user |
| GET | `/api/v1/citation/:location_id/campaign/:campaign_id/details` | verifyAuthJWTToken | `citationController.getCampaignDetails` | citation.getCampaignDetails | LocationCitation, Campaign, Citation, CitationDirectory, Aggregator, … | user |
| GET | `/api/v1/citation/:location_id/campaign/all` | verifyAuthJWTToken | `citationController.getAllCampaign` | citation.getAllCampaign | LocationCitation, Campaign, Citation, CitationDirectory, Aggregator, … | user |
| GET | `/api/v1/citation/locations/campaigns/list/all` | verifyAuthJWTToken | `citationController.getAllCitationByToken` | citation.getAllCitationByToken | LocationCitation, Campaign, Citation, CitationDirectory, Aggregator, … | user |
| POST | `/api/v1/citation/tracker` | verifyAuthJWTToken → validGenerateCitationTrackerReportBody | `citationController.generateCitationTrackerReport` | citation.generateCitationTrackerReport | LocationCitation, Campaign, Citation, CitationDirectory, Aggregator, … | user |
| GET | `/api/v1/citation/tracker` | verifyAuthJWTToken | `citationController.getCitationTrackerReport` | citation.getCitationTrackerReport | LocationCitation, Campaign, Citation, CitationDirectory, Aggregator, … | user |
| POST | `/api/v1/citation/builder` | verifyAuthJWTToken | `citationController.citationBuilder` | citation.citationBuilder | LocationCitation, Campaign, Citation, CitationDirectory, Aggregator, … | user |
| GET | `/api/v1/citation/getAllCitatioList` | — | `citationController.getAllCitatioList` | citation.getAllCitatioList | LocationCitation, Campaign, Citation, CitationDirectory, Aggregator, … | **none** |

**Payments & subscriptions**

| Method | Path | Middlewares (in order) | Controller | Service | Models | Auth |
|---|---|---|---|---|---|---|
| POST | `/api/v1/subscription` | — | `subscriptionController.createPlan` | subscription (+paypal).createPlan | SubscriptionPlan, Payment, Coupon, UserSubscription, User | **none** |
| GET | `/api/v1/subscription` | — | `subscriptionController.getAllPlans` | subscription (+paypal).getAllPlans | SubscriptionPlan, Payment, Coupon, UserSubscription, User | **none** |
| GET | `/api/v1/subscription/plans/country/:country` | — | `subscriptionController.getPlansByCountry` | subscription (+paypal).getPlansByCountry | SubscriptionPlan, Payment, Coupon, UserSubscription, User | **none** |
| PUT | `/api/v1/subscription/:plan_id` | — | `subscriptionController.updatePlan` | subscription (+paypal).updatePlan | SubscriptionPlan, Payment, Coupon, UserSubscription, User | **none** |
| DELETE | `/api/v1/subscription/:plan_id` | — | `subscriptionController.deletePlan` | subscription (+paypal).deletePlan | SubscriptionPlan, Payment, Coupon, UserSubscription, User | **none** |
| POST | `/api/v1/subscription/create-subscription` | — | `subscriptionController.createSubscription` | subscription (+paypal).createSubscription | SubscriptionPlan, Payment, Coupon, UserSubscription, User | **none** |
| POST | `/api/v1/subscription/paypal/webhook` | — | `subscriptionController.paypalWebhook` | subscription (+paypal).paypalWebhook | SubscriptionPlan, Payment, Coupon, UserSubscription, User | **none** |
| GET | `/api/v1/subscription/payment-status` | — | `subscriptionController.getPaymentStatus` | subscription (+paypal).getPaymentStatus | SubscriptionPlan, Payment, Coupon, UserSubscription, User | **none** |
| POST | `/api/v1/subscription/coupon/generate` | — | `subscriptionController.generateCoupon` | subscription (+paypal).generateCoupon | SubscriptionPlan, Payment, Coupon, UserSubscription, User | **none** |
| POST | `/api/v1/subscription/coupon/validate` | — | `subscriptionController.validateCoupon` | subscription (+paypal).validateCoupon | SubscriptionPlan, Payment, Coupon, UserSubscription, User | **none** |
| GET | `/api/v1/subscription/coupons` | — | `subscriptionController.getAllCoupons` | subscription (+paypal).getAllCoupons | SubscriptionPlan, Payment, Coupon, UserSubscription, User | **none** |
| GET | `/api/v1/subscription/payments/all` | — | `subscriptionController.getAllPaymentHistory` | subscription (+paypal).getAllPaymentHistory | SubscriptionPlan, Payment, Coupon, UserSubscription, User | **none** |
| POST | `/api/v1/subscription/send-subscription-welcome-mail` | — | `subscriptionController.sendSubscriptionWelcomeMailController` | subscription (+paypal).sendSubscriptionWelcomeMailController | SubscriptionPlan, Payment, Coupon, UserSubscription, User | **none** |
| POST | `/api/v1/payments/process-payment` | verifyAuthJWTToken → validateSquarePaymentBody | `paymentController.makeSquarePayment` | payment.makeSquarePayment | CreditPayment, PaymentCreditPlan, User, Profile | user |
| GET | `/api/v1/payments/plans/list` | — | `paymentController.getPlans` | payment.getPlans | CreditPayment, PaymentCreditPlan, User, Profile | **none** |
| GET | `/api/v1/payments/getAllPayments` | — | `paymentController.getAllPayments` | payment.getAllPayments | CreditPayment, PaymentCreditPlan, User, Profile | **none** |

**Reference data**

| Method | Path | Middlewares (in order) | Controller | Service | Models | Auth |
|---|---|---|---|---|---|---|
| GET | `/api/v1/countries` | — | `countryController.getAllCountry` | country.getAllCountry | Country, State, City | **none** |
| GET | `/api/v1/countries/states/:countryId` | — | `countryController.getAllStateByCountryId` | country.getAllStateByCountryId | Country, State, City | **none** |
| GET | `/api/v1/countries/cities/:stateId` | — | `countryController.getAllCityByStateId` | country.getAllCityByStateId | Country, State, City | **none** |
| POST | `/api/v1/roles` | — | `roleController.createRole` | role.createRole | Role | **none** |
| GET | `/api/v1/roles/:roleId` | — | `roleController.findRoleById` | role.findRoleById | Role | **none** |
| GET | `/api/v1/roles` | — | `roleController.getAllRoles` | role.getAllRoles | Role | **none** |
| PUT | `/api/v1/roles/:roleId` | — | `roleController.updateRole` | role.updateRole | Role | **none** |
| DELETE | `/api/v1/roles/:roleId` | — | `roleController.deleteRole` | role.deleteRole | Role | **none** |
| GET | `/api/v1/languages` | — | `languageController.getAllLanguage` | language.getAllLanguage | Language | **none** |
| GET | `/api/v1/timezones` | — | `timezoneController.getAllTimezone` | timezone.getAllTimezone | Timezone | **none** |
| POST | `/api/v1/business-categories` | validCreateBusinessCategoryBody | `businessCategoryController.createBusinessCategory` | businessCategory.createBusinessCategory | BusinessCategory | **none** |
| GET | `/api/v1/business-categories` | — | `businessCategoryController.getAllBusinessCategory` | businessCategory.getAllBusinessCategory | BusinessCategory | **none** |
| PUT | `/api/v1/business-categories/:businessCategoryId` | validUpdateBusinessCategoryBody | `businessCategoryController.updateBusinessCategory` | businessCategory.updateBusinessCategory | BusinessCategory | **none** |

**Content & support**

| Method | Path | Middlewares (in order) | Controller | Service | Models | Auth |
|---|---|---|---|---|---|---|
| GET | `/api/v1/faqs` | — | `faqController.getAllFaq` | faq.getAllFaq | Faq | **none** |
| POST | `/api/v1/faqs` | validCreateFaqBody | `faqController.createFaq` | faq.createFaq | Faq | **none** |
| PUT | `/api/v1/faqs/:faqId` | — | `faqController.updateFaq` | faq.updateFaq | Faq | **none** |
| DELETE | `/api/v1/faqs/:faqId` | — | `faqController.deleteFaq` | faq.deleteFaq | Faq | **none** |
| POST | `/api/v1/supports` | verifyAuthJWTToken → validCreateSupportBody | `supportController.createSupport` | support.createSupport | Support | user |
| GET | `/api/v1/supports` | verifyAuthJWTToken | `supportController.getAllSupport` | support.getAllSupport | Support | user |
| DELETE | `/api/v1/supports/:supportId` | verifyAuthJWTToken | `supportController.deleteSupport` | support.deleteSupport | Support | user |
| GET | `/api/v1/supports/getAllSupportByAdmin` | — | `supportController.getAllSupportTicketsByAdmin` | support.getAllSupportTicketsByAdmin | Support | **none** |
| PUT | `/api/v1/supports/updateSupportTicketStatus` | — | `supportController.updateSupportTicketStatus` | support.updateSupportTicketStatus | Support | **none** |
| GET | `/api/v1/supports/getSupportTicketStatusCounts` | — | `supportController.getSupportTicketStatusCounts` | support.getSupportTicketStatusCounts | Support | **none** |
| POST | `/api/v1/contact-us` | — | `contactUsController.createContactUs` | contactUs.createContactUs | ContactUs | **none** |
| GET | `/api/v1/contact-us/get` | — | `contactUsController.getAllContactUs` | contactUs.getAllContactUs | ContactUs | **none** |
| GET | `/api/v1/contact-us/:contactId` | — | `contactUsController.getContactUsById` | contactUs.getContactUsById | ContactUs | **none** |
| PUT | `/api/v1/contact-us/:contactId/status` | — | `contactUsController.updateContactUsStatus` | contactUs.updateContactUsStatus | ContactUs | **none** |
| DELETE | `/api/v1/contact-us/:contactId` | — | `contactUsController.deleteContactUs` | contactUs.deleteContactUs | ContactUs | **none** |
| POST | `/api/v1/blog` | — | `blogController.createBlog` | blog.createBlog | Blog, BlogCategory, BlogCategoryMapping | **none** |
| GET | `/api/v1/blog/get` | — | `blogController.getAllBlogs` | blog.getAllBlogs | Blog, BlogCategory, BlogCategoryMapping | **none** |
| GET | `/api/v1/blog/slug/:slug` | — | `blogController.getBlogBySlug` | blog.getBlogBySlug | Blog, BlogCategory, BlogCategoryMapping | **none** |
| GET | `/api/v1/blog/:blogId` | — | `blogController.getBlogById` | blog.getBlogById | Blog, BlogCategory, BlogCategoryMapping | **none** |
| PUT | `/api/v1/blog/:blogId` | — | `blogController.updateBlog` | blog.updateBlog | Blog, BlogCategory, BlogCategoryMapping | **none** |
| DELETE | `/api/v1/blog/:blogId` | — | `blogController.deleteBlog` | blog.deleteBlog | Blog, BlogCategory, BlogCategoryMapping | **none** |
| POST | `/api/v1/blog-category` | — | `blogCategoryController.createBlogCategory` | blogCategory.createBlogCategory | BlogCategory | **none** |
| GET | `/api/v1/blog-category/get` | — | `blogCategoryController.getAllBlogCategories` | blogCategory.getAllBlogCategories | BlogCategory | **none** |
| GET | `/api/v1/blog-category/:categoryId` | — | `blogCategoryController.getBlogCategoryById` | blogCategory.getBlogCategoryById | BlogCategory | **none** |
| PUT | `/api/v1/blog-category/:categoryId` | — | `blogCategoryController.updateBlogCategory` | blogCategory.updateBlogCategory | BlogCategory | **none** |
| DELETE | `/api/v1/blog-category/:categoryId` | — | `blogCategoryController.deleteBlogCategory` | blogCategory.deleteBlogCategory | BlogCategory | **none** |

**System & infrastructure**

| Method | Path | Middlewares (in order) | Controller | Service | Models | Auth |
|---|---|---|---|---|---|---|
| GET | `/api/v1/system/info` | — | `systemController.getSystemInfo` | — (os/process) | — | **none** |
| GET | `/api/v1/system/time` | — | `systemController.getServerTime` | — (os/process) | — | **none** |
| GET | `/api/v1/system/usage` | — | `systemController.getResourceUsage` | — (os/process) | — | **none** |
| GET | `/api/v1/system/process` | — | `systemController.getProcessInfo` | — (os/process) | — | **none** |
| GET | `/api/v1/logs` | — | `inline (app.ts)` | —.ts) | — | **none** |
| DELETE | `/api/v1/logs` | — | `inline (app.ts)` | —.ts) | — | **none** |
| GET | `/images/:filename` | — | `inline (app.ts)` | —.ts) | — | **none** |
| GET | `/videos/:filename` | — | `inline (app.ts)` | —.ts) | — | **none** |
| GET | `/gifs/:filename` | — | `inline (app.ts)` | —.ts) | — | **none** |
| GET | `/docs/:filename` | — | `inline (app.ts)` | —.ts) | — | **none** |
| GET | `/songs/:filename` | — | `inline (app.ts)` | —.ts) | — | **none** |
| GET | `/api/healthcheck` | — | `inline (app.ts)` | —.ts) | — | **none** |
| GET | `/ping` | — | `inline (app.ts)` | —.ts) | — | **none** |
| GET | `/docs` | — | `swagger-ui` | — | — | **none** |

---

## 2. Data model inventory

All models use the plugins in `src/configs/mongoPlugins.ts`:
- `globalQueryFilters` adds `deleted_at: null` to find, findOne, findOneAndUpdate, countDocuments and updateMany. It does not cover `updateOne` or `aggregate`.
- `toJSON` strips `__v`.
- `addTimestamps` maintains `created_at` and `updated_at`.

The plugin's "soft delete" hooks on `deleteOne`, `deleteMany` and `findOneAndDelete` call `this.set(...)` on a delete query, which has no effect. **Every delete is a hard delete** (see S23).

**Indexes:** apart from the models listed in the table, no model declares an index. There is no index on `users.email` (and it is not unique), `locations.created_by`, `*_reports.location_id`, `user_auths.user_id`, `userGBPs.location_id`, `gbpPosts.location_id` or `otps.email`.

| Model (file) | Collection | Key fields | Indexes | Used by |
|---|---|---|---|---|
| Location (`location.model.ts`) | locations | name, address, lat, lng, country, state, city, zip_code, mobile, place_id, website_URL, business_category, client_id, created_by, is_active | none | all ranking, GBP, citations, white label |
| RankTrackerReport (`rankTrackerReport.model.ts`) | rank_tracker_reports | location_id, scheduling{frequency, run_time, run_at, time_zone}, competitors[], keyword_list[], keywords[{name, volume, organic_desktop, organic_mobile, local_pack, local_finder}], average_google_position (Mixed), avgRanking, placeTargets, keyword_and_positional_movement, total_keywords | none | rank tracker, white label |
| LocalSearchGridReport (`localSearchGridReport.model.ts`) | local_search_grid_reports | location_id, keywords_up, keywords_down, all_keywords_avg, scheduling, map_criteria{latitude, longitude, grid_size, spacing, unit, max_points}, keyword_list, keywords (Mixed) | none | local search grid |
| LocalMapRankingReport (`localMapRanking.model.ts`) | local_map_ranking_reports | same shape as grid; map_criteria{latitude, longitude} | none | local map ranking |
| GBPAuditReport (`gbpAuditReport.model.ts`) | gbp_audit_reports | location_id, scheduling, keyword_list, keywords, place_details, nap_comparison | none | GBP audit, white label |
| UserGBP (`userGBP.model.ts`) | userGBPs | user_id, location_id, gbpAccountId, gbpLocationId, title, websiteUri, languageCode, metadata, profile | none | GBP binding, posting, locations |
| GBPPost (`gbpPost.model.ts`) | gbpPosts | location_id, gbpAccountId, gbpLocationId, gbpPostId, searchUrl, topicType, summary, schedule{timeZone, date, time}, media{mediaFormat, sourceUrl}, callToAction{actionType, url}, event, offer, status, is_posted, is_scheduled | none | GBP posting, `post-to-gbp` job |
| UserAuth (`userAuth.model.ts`) | user_auths | user_id, token_type (ANALYTICS\|GBP), access_token, refresh_token (**plaintext**), expiry_date | none | Google OAuth (GBP, Search Console) |
| UserToken (`userToken.model.ts`) | user_tokens | user_id, token_type, token, fcm_token, expired_at | none | JWT refresh tokens |
| User (`user.model.ts`) | users | email, password (bcrypt), role_id, user_type (AGENCY\|BUSINESS\|EMPLOYEE\|CLIENT), owner_id, status, is_gbp_connected, is_analytics_connected, available_credit, square_customer_id, subscription_status, current_plan_id, referral_code (Math.random) | none (email **not unique**) | everything |
| Profile (`profile.model.ts`) | profiles | user_id, name, country, state, city, business_name, business_address, zip_code, website_url, mobile, no_of_clients, no_of_locations | none | users, locations |
| OTP (`otp.model.ts`) | otps | email, user_id, code, type, otp_expiration_time (reset to now+5 min on **every** validate), is_verified | none | user auth |
| UserLoginTiming (`user_login_timings.model.ts`) | user_login_timings | user_id, token_id, time_zone, ip_address, login/logout times | none | user auth |
| UserAttachment (`userAttachment.model.ts`) | user_attachments | user_id, title, file_* | none | none found |
| Client (`client.model.ts`) | clients | company_name, company_URL, unique_id, status, no_of_locations, created_by | none | agency clients, locations |
| Admin (`admin.model.ts`) | admins | role_id, name, email, password, otp (bcrypt), is_otp_valid, remember_token | none | admin auth |
| Role (`role.model.ts`) | roles | role_id (unique), name, abbreviation | role_id unique | auth |
| WhitelabelProfile (`whitelabelProfile.model.ts`) | whitelabel_profiles | location_id, name, header, footer, color, file_*, external, external_url, external_reports_lists, access_password (**plaintext**), is_primary | none | white label |
| Support (`support.model.ts`) | supports | user_id, name, email, mobile, subject, message, status | none | support |
| Faq (`faq.model.ts`) | faqs | question, answer | none | FAQ |
| ContactUs (`contactUs.model.ts`) | contact_us | full_name, business_name, email, phone_number, company_size, primary_interest, goals_or_challenges, status | none | contact us |
| Country / State / City / Language / Timezone / BusinessCategory | countries / states / cities / languages / timezones / business_categorys | reference data | none | reference data |
| SubscriptionPlan (`subscriptionPlan.model.ts`) | subscription_plans | name, country (USA\|CANADA), currency, monthly_price, setup_fee, paypal_product_id, paypal_plan_id | none | subscriptions |
| Payment (`payment.model.ts`) | payments | user_id, plan_id, coupon_id, razorpay_*, paypal_subscription_id, amounts, customer_*, subscription_status, status | none | subscriptions, PayPal webhook |
| UserSubscription (`userSubscription.model.ts`) | user_subscriptions | plan_id, paypal_subscription_id (unique), user_id, status, next_billing_time | paypal_subscription_id unique | subscriptions |
| Coupon (`coupon.model.ts`) | coupons | code (unique), plan_id, amounts, expires_at, used_by, is_used | code unique | subscriptions |
| CreditPayment (`creditPayment.model.ts`) | location_credit_payments | user_id, transactionId, price, credit, paymentGateway, status, gateway_response | user_id; transactionId unique sparse; status | Square credit payments |
| PaymentCreditPlan (`paymentCreditPlans.model.ts`) | paymentCreditPlans | name, price, credit, discount, final_price | none | Square credit payments |
| Campaign, Citation, CitationDirectory, Aggregator, LocationCitation, ManualCiationCreditInfo, CitationDuplicateRemoveCredit | campaigns, citations, citationDirectorys, aggregators, locationCitations, manualCiationCreditInfo, citationDuplicateRemoveCredit | citation workflow | none | citations (out of scope) |
| Blog, BlogCategory, BlogCategoryMapping | blogs, blog_categories, blog_category_mappings | content | slug unique; mapping compound unique | blog (out of scope) |
| `citationPayment.model.ts` | locationCitations | **duplicate** of `LocationCitation` (same model name and collection) | none | nothing. Dead code; importing it would throw `OverwriteModelError`. |

---

## 3. External integrations

No outbound HTTP call sets a timeout, and none retries (see C20). "Request path" means the call happens while an API request is waiting; "Job" means it runs in agenda.

| Service / endpoint | File | Credential | Paid | When |
|---|---|---|---|---|
| Places **legacy** Text Search `maps.googleapis.com/maps/api/place/textsearch/json` (no field mask) | [location.controller.ts:87](../src/controllers/common/location.controller.ts#L87) | `GOOGLE_PLACE_API_KEY` in the query string | Yes (legacy Text Search) | Request path, **unauthenticated** |
| Places **legacy** Place Details `.../place/details/json` (no `fields` = all fields) | [location.controller.ts:123](../src/controllers/common/location.controller.ts#L123), [localSearchGridReport.ts:8](../src/helpers/localSearchGridReport.ts#L8), [citation.service.ts:512](../src/services/common/citation.service.ts#L512) | same | Yes (all fields: highest tier) | Request path |
| Places legacy Place Details with `reviews, photos, opening_hours, …` | [gbpAudit.ts:12](../src/helpers/gbpAudit.ts#L12) (`fetchNAPDatFromGoogle`, also used by location create and GBP account listing) | same | Yes (Atmosphere and Contact data) | Request path |
| Places legacy Nearby Search `.../place/nearbysearch/json` | [gbpAudit.ts:99](../src/helpers/gbpAudit.ts#L99) | same | Yes | Request path (every GBP audit GET) |
| Geocoding API `.../geocode/json` | [localSearchGridReport.ts:47](../src/helpers/localSearchGridReport.ts#L47) | same | Yes | Request path |
| SerpAPI `serpapi.com/search.json` (engines: google, google_local, google_maps, google_maps_reviews) via axios | [rankTrackerReport.ts:480,498,527,589](../src/helpers/rankTrackerReport.ts#L480), [localSearchGridReport.ts:94](../src/helpers/localSearchGridReport.ts#L94) | `SERP_API_KEY` in the query string | Yes (per search) | Request path |
| SerpAPI via `serpapi` npm `getJson` | [rankTrackerReport.ts:463](../src/helpers/rankTrackerReport.ts#L463), [localMapRankingReport.ts:26](../src/helpers/localMapRankingReport.ts#L26), [reputationManagerReport.ts:32](../src/helpers/reputationManagerReport.ts#L32), [gbpAudit.ts:45](../src/helpers/gbpAudit.ts#L45), [citation.ts:16](../src/helpers/citation.ts#L16), [serp.ts:33](../src/services/common/serp.ts#L33) | `config.api_key` is **never set** (C13), so these always throw | Yes | Request path |
| DataForSEO search volume `api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live` | [rankTrackerReport.ts:609](../src/helpers/rankTrackerReport.ts#L609) | **hardcoded** username and password (S13) | Yes | Request path |
| Moz `lsapi.seomoz.com/v2/url_metrics` | [gbpAudit.ts:209](../src/helpers/gbpAudit.ts#L209) | `SEO_MOZ_API_KEY` | Yes | Never called (dead) |
| Google Search Console `webmasters.searchanalytics.query` (googleapis) | [rankTrackerReport.ts:94,222](../src/helpers/rankTrackerReport.ts#L94) | user OAuth (ANALYTICS) | Free (quota) | Never called (dead) |
| GBP Account Management `accounts.list` | [gbpPostSchedular.service.ts:46](../src/services/common/gbpPostSchedular.service.ts#L46), [gbpPs.ts:8](../src/helpers/gbpPs.ts#L8) (dead) | user OAuth (GBP) | Free (quota) | Request path |
| GBP Business Information `accounts.locations.list` | [gbpPostSchedular.service.ts:61](../src/services/common/gbpPostSchedular.service.ts#L61), [gbpPs.ts:24](../src/helpers/gbpPs.ts#L24) (dead) | user OAuth (GBP) | Free | Request path |
| GBP v4 `localPosts` create and delete | [gbpPostSchedular.service.ts:244,403](../src/services/common/gbpPostSchedular.service.ts#L244) | user OAuth (GBP) | Free | Request path and `post-to-gbp` job |
| Google OAuth token exchange and refresh (google-auth-library, googleapis) | [userAuth.service.ts:723](../src/services/user/userAuth.service.ts#L723), [gbpOauthClinet.ts:26](../src/configs/gbpOauthClinet.ts#L26) | `GOOGLE_GBP_*`, `GOOGLE_ANALYTICS_*` | Free | Request path |
| Google OAuth revoke `oauth2.googleapis.com/revoke?token=` | [userAuth.service.ts:707](../src/services/user/userAuth.service.ts#L707) | refresh token **in the URL** | Free | Request path |
| PayPal REST `api-m[.sandbox].paypal.com` | [paypal.service.ts](../src/services/common/paypal.service.ts) | `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_MODE` | Transaction fees | Request path |
| Square `connect.squareupsandbox.com/v2/payments` (**hardcoded sandbox**) and Square SDK (sandbox) | [payment.service.ts:38](../src/services/common/payment.service.ts#L38), [square.ts:7](../src/configs/square.ts#L7) | `SQUARE_ACCESS_TOKEN` | Transaction fees | Request path |
| SMTP (nodemailer) | [email.service.ts:20](../src/services/common/email.service.ts#L20) | `SMTP_*` | Depends on provider | Request path |
| countriesnow.space | [fetchCountryStateCityDataFromRemoteApi.ts](../src/configs/fetchCountryStateCityDataFromRemoteApi.ts) | none | Free | One-off seed script |

**Approximate cost of one Rank Tracker generation today** (had it worked; see C13). For each keyword:
- 1 desktop organic search
- 1 mobile organic search
- 1 local-pack search (`tbm=lcl`)
- 3 local-finder pages
- 1 DataForSEO lookup

Plus 1 SerpAPI place lookup per target (the client plus each competitor). That totals about **6 SerpAPI searches per keyword + (1 + number of competitors)**, all synchronous, with sleeps of 400 ms per keyword and 3 s between local-finder pages.

---

## 4. Jobs and scheduling

| Mechanism | Where | What | Behaviour under pm2 `instances: "max"` |
|---|---|---|---|
| Agenda (Mongo collection `agendaJobs`) | [mongoConnection.ts:35-50](../src/configs/mongoConnection.ts#L35-L50) | `processEvery('1 minute')`. Started on every instance after Mongo opens. | Each instance runs a poller. Agenda's Mongo locking prevents double execution. |
| Job `post-to-gbp` | [jobs/postToGbp.ts](../src/jobs/postToGbp.ts) | Publishes a scheduled GBP post, then updates `GBPPost` status. Job data contains the **full user object and post payload**, not IDs (C21). Not idempotent. | Safe from double-locking. A retry after a successful API call would publish the post twice. |
| `src/configs/agenda.ts` | — | **Empty file.** No registry exists. | — |
| node-cron `* * * * *` heartbeat | [app.ts:49](../src/app.ts#L49) | Logs "still running" every minute. | Runs once per instance. Noise only. |
| Report "scheduling" fields (`scheduling.frequency/run_time/run_at/time_zone`) | report models | Stored, **never executed** (C7). | — |
| In-memory state | `node-cache` in [app.ts:33](../src/app.ts#L33) (file path cache); `express-rate-limit` memory store | Per instance. | Each instance keeps its own cache and rate-limit counts. |
| `setInterval` | none | — | — |

---

## 5. Security findings

**Severity scale:**
- **Critical:** unauthenticated compromise of data or accounts.
- **High:** authenticated or conditional compromise, secret exposure, or cost abuse.
- **Medium:** hardening gaps with a realistic impact.
- **Low:** defence in depth.

### 5.1 Known issues from CLAUDE.md (all confirmed)

| ID | Severity | Verdict | Evidence | Status |
|---|---|---|---|---|
| S1 | Critical | **Confirmed.** `register`, `getAllAdmins`, `getAdminById`, `updateAdmin` and `deleteAdmin` have no auth, and neither does any `/admin/operations/*` route. `PUT updateAdmin` can change any admin's `email` and `role_id` ([adminAuth.service.ts:345-368](../src/services/admin/adminAuth.service.ts#L345-L368)). An attacker can point the super-admin's email at an inbox they control, then use `sendOTP` and `verifyOTP` to take over the account. | [adminAuth.route.ts](../src/routes/v1/admin/adminAuth.route.ts), [adminOperations.route.ts](../src/routes/v1/admin/adminOperations.route.ts) | Open |
| S2 | Critical | **Confirmed.** The following have no auth: `/roles` (all), `/business-categories` POST and PUT, `/subscription` plan CRUD, `coupon/generate`, `coupons`, `payments/all`, `payment-status`, `send-subscription-welcome-mail`, `/payments/getAllPayments`, support admin routes (`getAllSupportByAdmin`, `updateSupportTicketStatus`, `getSupportTicketStatusCounts`), `/citation/getAllCitatioList` and `/system/*`. `/system/info` returns `os.userInfo()`, network interfaces and CPU details. | route files under `src/routes/v1/common/` | Open |
| S3 | High | **Confirmed.** `GET` returns today's request log and `DELETE` deletes all log files. Neither requires auth. | [app.ts:138](../src/app.ts#L138), [app.ts:153](../src/app.ts#L153) | Open |
| S4 | High | **Confirmed.** No signature verification. The handler also logs the full event payload (PII) and uses `resource.id` / `billing_agreement_id` unvalidated in Mongo filters. A forged `BILLING.SUBSCRIPTION.ACTIVATED` event would activate a subscription. | [subscription.service.ts:1247](../src/services/common/subscription.service.ts#L1247), [paypal.service.ts:413](../src/services/common/paypal.service.ts#L413) | Open |
| S5 | High | **Confirmed.** The limiter is mounted on `/v1/auth`, which matches no route. There is no `app.set('trust proxy', …)` anywhere, so behind nginx every client shares the proxy's IP. | [app.ts:120-122](../src/app.ts#L120-L122) | Open |
| S6 | High | **Confirmed.** `sanitizeFilter` is not set anywhere. Raw body values reach filters in: user forgot-password (`email` and `token` in [auth.middlware.ts:313-328](../src/middlewares/auth/auth.middlware.ts#L313-L328)); user verify-otp (`email`; an operator object can mark the first matching user `ACCEPTED` via [userAuth.service.ts:124](../src/services/user/userAuth.service.ts#L124)); admin `sendOTP`, `verifyOTP` and `forgotPassword` (`email`); and PayPal webhook handlers (`resource.id`). User and admin **login are protected**, because `validator.isEmail` throws on non-strings. | as listed | Open |
| S7 | High | **Confirmed.** `upload` runs on every `/api/v1` request before auth. Files are written to disk with no `fileSize` or `files` limits. `LIMIT_UNEXPECTED_FILE` is silently ignored. The extension comes from the client-supplied mimetype. | [app.ts:134](../src/app.ts#L134), [multer.ts:108-136](../src/configs/multer.ts#L108-L136) | Open |
| S8 | Medium | **Confirmed.** A wildcard `Access-Control-Allow-*: *` middleware runs before `credentials` and `cors`. | [app.ts:108-114](../src/app.ts#L108-L114) | Open |
| S9 | Medium | **Confirmed.** Only `helmet.contentSecurityPolicy` is used, so other helmet headers are missing. `script-src` includes `*.polyfill.io` (compromised CDN) plus `'unsafe-eval'` and `'unsafe-inline'`. `img-src` contains the single malformed token `"'self' data:"`. | [app.ts:54-79](../src/app.ts#L54-L79) | Open |
| S10 | Medium | **Confirmed.** 100 MB limit for both JSON and urlencoded bodies. | [app.ts:82](../src/app.ts#L82), [app.ts:84](../src/app.ts#L84) | Open |
| S11 | High | **Confirmed**, for both the GBP and the Search Console ("analytics") flows. `state = JSON.stringify({user_id,…})` is neither signed nor bound to the session. The callback trusts `state.user_id`. A victim can be tricked into binding their Google Business Profile to the attacker's account. | [userAuth.service.ts:522](../src/services/user/userAuth.service.ts#L522), [:620](../src/services/user/userAuth.service.ts#L620), [:645-651](../src/services/user/userAuth.service.ts#L645-L651) | Planned P6 |
| S12 | High | **Confirmed.** `access_token` and `refresh_token` are stored in plaintext. | [userAuth.model.ts:36-45](../src/models/userAuth.model.ts#L36-L45) | Planned P3/P6 |
| S13 | Critical | **Confirmed.** Hardcoded DataForSEO username and password. Hardcoded AES key in `fileEncryption.ts`. **The DataForSEO credential is in git history and must be rotated regardless of code changes.** | [rankTrackerReport.ts:613-614](../src/helpers/rankTrackerReport.ts#L613-L614), `fileEncryption.ts:23` (file removed) | Partial: the AES key was removed with `fileEncryption.ts` (Phase 1.5). DataForSEO remains in code (P9) and **needs rotation (Mohit)**. |
| S14 | Medium | **Confirmed.** The admin temporary password uses `Math.random().toString(36)`. The admin OTP also uses `Math.random` ([:135](../src/services/admin/adminAuth.service.ts#L135)) and has no expiry. | [adminAuth.service.ts:37](../src/services/admin/adminAuth.service.ts#L37) | Open |
| S15 | High | **Confirmed.** `validFetchRankTrackerReportBody`, `validFetchLocalSearchGridReportDocBody`, `validFetchLocalMapRankingReportDocBody` and `validFetchGBPAuditReportBody` load the location by id with no `created_by` check. Any logged-in user can read any location's reports. The GBP audit GET also spends paid API calls on the victim's location (C8). The `validCreate*` variants do check ownership, but only after the grid middleware has already made a paid call (C18). | [rankTrackerMiddleware.ts:110-150](../src/middlewares/common/rankTrackerMiddleware.ts#L110-L150), [localSearchGrid.middleware.ts:182](../src/middlewares/common/localSearchGrid.middleware.ts#L182), [localMapRanking.middleware.ts:137](../src/middlewares/common/localMapRanking.middleware.ts#L137), [gbpAudit.middleware.ts:102](../src/middlewares/common/gbpAudit.middleware.ts#L102) | Open |

### 5.2 New findings

| ID | Severity | Finding | Evidence | Status |
|---|---|---|---|---|
| S16 | **Critical** | **Path traversal and arbitrary file read (tested).** `GET /{images,videos,gifs,docs,songs}/:filename` joins the decoded `filename` into a path with no containment check. `/images/..%2F..%2F..%2F<path>` returns files outside `public/`. Dotfiles are refused by `send`'s default, so `.env` itself is blocked, but source, `logs/`, other users' uploads and system files are readable. The cache is also keyed by filename only, so a name shared across folders returns the wrong file. | [app.ts:184-205](../src/app.ts#L184-L205) | Open |
| S17 | **Critical** | **Unauthenticated location and white-label data exposure.** `GET /locations/:locationId` has no auth and returns any location joined with its white-label profile, **including `access_password`**. `GET /white-label-profiles/:id` has no auth and its select list includes `access_password`. The three `/white-label-profiles/*-report/:id` routes have no auth and never check `access_password`. The GBP audit variant triggers paid API calls (C8). | [location.route.ts](../src/routes/v1/common/location.route.ts), [location.service.ts:177-216](../src/services/common/location.service.ts#L177-L216), [whiteLabelProfile.middleware.ts:97](../src/middlewares/common/whiteLabelProfile.middleware.ts#L97), [selectFields.ts:19](../src/constants/selectFields.ts#L19) | Open |
| S18 | High | **Unauthenticated paid Google proxy.** `/locations/google-locations/:name` and `/details/:placeId` call legacy Text Search and legacy Place Details with no field mask (the highest SKU) for anyone. `name` and `placeId` are not URL-encoded (query-parameter injection into the Google URL). This is a cost-abuse vector. | [location.controller.ts:85-128](../src/controllers/common/location.controller.ts#L85-L128) | Open |
| S19 | **Critical (conditional)** | **Admin JWT key may be empty (tested).** Admin tokens are signed and verified with `Buffer.from(JWT_SECRET, 'hex')`. If `JWT_SECRET` is not a hex string, the key truncates at the first non-hex character. `"mySuperSecretKey"` gives a **0-byte key**, which makes admin tokens trivially forgeable. The format is not validated in config. **Check the production secret format.** User tokens use the same secret as a UTF-8 string, so the two token types effectively have different keys. | [adminAuth.middleware.ts:71](../src/middlewares/auth/adminAuth.middleware.ts#L71), [adminAuth.service.ts:106](../src/services/admin/adminAuth.service.ts#L106) | Open (verify: Mohit) |
| S20 | High | **Cross-tenant OAuth credential race.** `oAuth2ClientGBP` is a module-level singleton. `setCredentials` is called per request and per refresh, followed by `await`ed API calls. Two concurrent requests from different users can run with each other's Google credentials (for example, listing another user's GBP accounts and locations). | [gbpOauthClinet.ts:14-33](../src/configs/gbpOauthClinet.ts#L14-L33), [gbpPostSchedular.service.ts:31-65](../src/services/common/gbpPostSchedular.service.ts#L31-L65) | Planned P6 |
| S21 | High | **Secrets and PII in logs.** [gbpPs.ts:20](../src/helpers/gbpPs.ts#L20) logs the GBP access token. [rankTrackerReport.ts:552](../src/helpers/rankTrackerReport.ts#L552) logs the SerpAPI URL including `api_key`. `mongoose.set('debug', true)` ([mongoConnection.ts:24](../src/configs/mongoConnection.ts#L24)) prints every query to stdout in every environment, including token writes and password hashes. [mongoMigrate.ts](../src/configs/mongoMigrate.ts) logs the super-admin password. The PayPal webhook logs full payloads. There are about 100 `console.*` calls that bypass winston. | as listed | Partial: the `gbpPs.ts` token log was removed with the file (Phase 1.5). The rest is open. |
| S22 | High | **OTP brute force and non-expiring reset token.** OTPs are 6 digits with no attempt counter, and the rate limiter is not mounted (S5). After verification the forgot-password "token" is stored in `OTP.code`, and `validateForgetPassordToken` never checks expiry. The OTP model's `pre('validate')` hook also **resets** `otp_expiration_time` to now+5 min on every save. | [userAuth.service.ts:87-141](../src/services/user/userAuth.service.ts#L87-L141), [otp.model.ts:88-93](../src/models/otp.model.ts#L88-L93), [auth.middlware.ts:323](../src/middlewares/auth/auth.middlware.ts#L323) | Open |
| S23 | Medium | **Soft delete is a no-op, and deletes are hard.** `deactivateAccount` hard-deletes the user and profile but leaves `UserAuth` Google refresh tokens stored and unrevoked, and leaves the user's locations and reports orphaned. `deleteLocation` hard-deletes reports and posts but does not cancel scheduled `post-to-gbp` jobs. | [mongoPlugins.ts:75-88](../src/configs/mongoPlugins.ts#L75-L88), [userAuth.service.ts:488-510](../src/services/user/userAuth.service.ts#L488-L510), [location.service.ts:323-439](../src/services/common/location.service.ts#L323-L439) | Open |
| S24 | Medium | Access tokens last 7 days and are not revocable. Logout and password reset only delete refresh tokens. `verifyAuthJWTToken` uses `aggregate`, which bypasses the `deleted_at` filter. | [token.service.ts:151-184](../src/services/common/token.service.ts#L151-L184), [auth.middlware.ts:48](../src/middlewares/auth/auth.middlware.ts#L48) | Open |
| S25 | Medium | **IDOR on post delete.** `deletePost` loads `GBPPost` by `post_id` with no owner or location check. | [gbpPostSchedular.service.ts:354-384](../src/services/common/gbpPostSchedular.service.ts#L354-L384) | Planned P8 |
| S26 | Low | Unescaped user input in `$regex` (blog, blog category, contact us, subscription, business category) allows ReDoS. Out of scope; recorded only. | e.g. [businessCategory.service.ts:49](../src/services/common/businessCategory.service.ts#L49) | Won't fix (out of scope) |
| S27 | High | Additional unauthenticated write and PII routes not in S2: contact-us list, get, status and delete (PII); blog and blog-category create, update and delete; FAQ create, update and delete. | [contactUs.route.ts](../src/routes/v1/common/contactUs.route.ts), [blog.routes.ts](../src/routes/v1/common/blog.routes.ts), [blogCategory.routes.ts](../src/routes/v1/common/blogCategory.routes.ts), [faq.route.ts](../src/routes/v1/common/faq.route.ts) | Open |
| S28 | Low | Error responses leak internals. 500s return `An internal server error occurred: ${err}`, and most services re-wrap raw Mongo and axios messages. `apiErrorHandler` also calls `next(err)` before responding, so Express's final handler logs every error's stack a second time (tested; the response is still the JSON envelope). | [errorHandler.ts:8-15](../src/utils/errorHandler.ts#L8-L15) | Open |
| S29 | Low | `revokeToken` puts the refresh token in a URL query, ignores the HTTP status (`fetch` does not throw on 4xx), and always reports success. | [userAuth.service.ts:704-718](../src/services/user/userAuth.service.ts#L704-L718) | Planned P6 |

---

## 6. Correctness findings (in-scope features)

### 6.1 Known issues from CLAUDE.md (all confirmed)

| ID | Verdict | Evidence | Status |
|---|---|---|---|
| C1 | **Confirmed.** Every SERP fetcher returns `null` on error; `getSerpRanking` destructures `{search_parameters, data}` from it and throws; `asyncPool`'s `Promise.all` rejects; the whole report fails. Combined with C13 this happens on every run. | [rankTrackerReport.ts:417](../src/helpers/rankTrackerReport.ts#L417), [:467](../src/helpers/rankTrackerReport.ts#L467), [:485](../src/helpers/rankTrackerReport.ts#L485), [:503](../src/helpers/rankTrackerReport.ts#L503), [:578](../src/helpers/rankTrackerReport.ts#L578) | Planned P4/P5 |
| C2 | **Confirmed.** "Local pack" uses `engine=google&tbm=lcl` (Local Finder page 1), duplicating the first page of `engine=google_local`. | [rankTrackerReport.ts:498](../src/helpers/rankTrackerReport.ts#L498) vs [:531](../src/helpers/rankTrackerReport.ts#L531) | Planned P9 (delete) |
| C3 | **Confirmed.** `change: 0` is hardcoded for self and every competitor in all four channels. Movement is computed only from `local_finder` against the previous report. | [rankTracker.service.ts:91](../src/services/common/rankTracker.service.ts#L91), [:101](../src/services/common/rankTracker.service.ts#L101), [:117](../src/services/common/rankTracker.service.ts#L117), [:142](../src/services/common/rankTracker.service.ts#L142), [:171](../src/services/common/rankTracker.service.ts#L171), [:264-342](../src/services/common/rankTracker.service.ts#L264-L342) | Planned P5 |
| C4 | **Confirmed.** `generateGrid` is imported but never called. The grid report runs one UULE search per keyword at the center; `grid_size`, `spacing` and `max_points` are validated but unused. | [localSearchGrid.service.ts:9](../src/services/common/localSearchGrid.service.ts#L9), [:53-73](../src/services/common/localSearchGrid.service.ts#L53-L73) | Planned P4 |
| C5 | **Confirmed.** UULE is `w+CAIQICI` + base64(formatted_address). The length-key character is missing, and the canonical name is a street address. It also costs a paid Geocoding call. `gl=us` is hardcoded (wrong for Canada). | [localSearchGridReport.ts:45-71](../src/helpers/localSearchGridReport.ts#L45-L71), [:94](../src/helpers/localSearchGridReport.ts#L94) | Planned P9 (delete) |
| C6 | **Confirmed.** Grid and map reports store raw competitor lists only. The client's own rank is never computed; `keywords_up`, `keywords_down` and `all_keywords_avg` are never set; `deleteOne` removes the previous report on every run, so no history is kept. | [localSearchGrid.service.ts:77](../src/services/common/localSearchGrid.service.ts#L77), [localMapRankingReport.service.ts:69](../src/services/common/localMapRankingReport.service.ts#L69) | Planned P5 |
| C7 | **Confirmed.** `src/configs/agenda.ts` is empty. The `scheduling` sub-documents are persisted and never read. | [agenda.ts](../src/configs/agenda.ts) | Planned P3/P5 |
| C8 | **Confirmed.** `getGBPAuditReport` recomputes on every GET: 1 Place Details call (reviews and photos fields), plus for each keyword 1 Nearby Search and 10 Place Details, so **1 + 11K paid calls per page view**. It is also reachable without auth through the white-label route (S17). `verified` is guessed from "has website or phone". Citations, links, photos and Moz fields are hardcoded to 0. The "rank" is Nearby Search order within 2 km, not search rank. | [gbpAudit.service.ts:39-76](../src/services/common/gbpAudit.service.ts#L39-L76), [gbpAudit.ts:125-139](../src/helpers/gbpAudit.ts#L125-L139) | Planned P7 |
| C9 | **Confirmed, with a correction.** The helper that uses only the first account and omits `readMask` ([gbpPs.ts:17](../src/helpers/gbpPs.ts#L17), [:23](../src/helpers/gbpPs.ts#L23)) is **dead code**. The live path, `getRegisteredGoogleBusinessProfile`, also uses only `accounts[0]` and does not paginate, but it does send a `readMask`. | [gbpPostSchedular.service.ts:53-65](../src/services/common/gbpPostSchedular.service.ts#L53-L65) | Planned P6 |
| C10 | **Confirmed** (out of scope: recorded only). Square is hardcoded to the sandbox in both the SDK and the raw URL. | [square.ts:7](../src/configs/square.ts#L7), [payment.service.ts:38](../src/services/common/payment.service.ts#L38) | Won't fix (out of scope) |
| C11 | **Confirmed.** `oAuth2Client.setCredentials` is called on a function, causing 2 of the 46 build errors. `getDatesArr` returns newest-first with no reverse, so "current" is the oldest month and the movement comparison is inverted. The functions are imported by `rankTracker.service.ts` but never called (dead). | [rankTrackerReport.ts:67-83](../src/helpers/rankTrackerReport.ts#L67-L83), [:220-225](../src/helpers/rankTrackerReport.ts#L220-L225) | Planned P9 (delete) |

### 6.2 New findings

| ID | Finding | Evidence | Status |
|---|---|---|---|
| C12 | **Unbind is a copy of bind.** `unbindGoogleBusinessProfileWithUser` deletes the user's `UserGBP` rows for the location and then **re-creates** a binding from the request body, so it never unbinds. It does not remove stored GBP tokens or cancel jobs. No route calls it yet. Fix in Phase 6: remove the `UserGBP` binding, delete the stored GBP tokens for that binding, and cancel `gbp-sync` jobs for the location. Test: bind → unbind → no binding, no tokens, no scheduled jobs. Raised by Mohit during Phase 1.5. | [gbpPostSchedular.service.ts:424-456](../src/services/common/gbpPostSchedular.service.ts#L424-L456) | Planned P6 |
| C13 | **SerpAPI key never configured.** `src/configs/serpConfig.ts` (which sets `serpapi`'s `config.api_key`) is never imported. `serpapi@2.2.1` `getJson` then throws `MissingApiKeyError` (verified in the library source, `validators.js`). Effect: **Rank Tracker generation always fails** (desktop organic returns `null`, which triggers C1). Map Ranking always saves empty keyword results. Reputation Manager always errors. The GBP audit organic helper would also fail, but it is dead. | [serpConfig.ts](../src/configs/serpConfig.ts), [rankTrackerReport.ts:463](../src/helpers/rankTrackerReport.ts#L463), [localMapRankingReport.ts:26](../src/helpers/localMapRankingReport.ts#L26) | Planned P9 (SerpAPI removed) |
| C14 | **GBP post payload is wrong.** `callToAction` is validated but never added to `gbpPostData`, so CTAs are never sent. `media` is sent as an object, but v4 `LocalPost.media` is an array. Stored CTA enum values `CALL_NOW`, `BUY` and `ORDER_ONLINE` are not valid v4 `ActionType`s (valid: `BOOK, ORDER, SHOP, LEARN_MORE, SIGN_UP, CALL`). The `media.mediaFormat` enum contains the typo `VEDIO`. `JSON.parse` on `schedule`, `event`, `offer` and `callToAction` is unguarded, so malformed input returns 500. | [gbpPostSchedular.middleware.ts:102-340](../src/middlewares/common/gbpPostSchedular.middleware.ts#L102-L340), [constantTypes.ts:578-595](../src/configs/constantTypes.ts#L578-L595), [gbpPost.model.ts:195](../src/models/gbpPost.model.ts#L195) | Planned P8 |
| C15 | **Immediate-publish status never saved (tested).** `addPostToGBP` updates with `{ _id: gbpPostObj.gbpPostID }`, but `gbpPostObj` has no `gbpPostID` (only the copy passed to `publishPostToGBP` does). The driver sends `_id: null` and matches nothing. As a result, `gbpPostId` and `searchUrl` are never stored, and a failed publish still shows `status: LIVE, is_posted: true` (the middleware defaults). Google's error message is discarded. | [gbpPostSchedular.service.ts:152-186](../src/services/common/gbpPostSchedular.service.ts#L152-L186), [:258-267](../src/services/common/gbpPostSchedular.service.ts#L258-L267) | Planned P8 |
| C16 | **Post delete is a silent no-op.** Because `gbpPostId` is never stored (C15), `deletePost` neither deletes on Google nor deactivates locally, yet returns "Deleted Successfully". Deleting a *scheduled* post never cancels its agenda job, so the post is still published later. | [gbpPostSchedular.service.ts:354-384](../src/services/common/gbpPostSchedular.service.ts#L354-L384) | Planned P8 |
| C17 | **OAuth token storage bugs.** The `storeToken` update filter is `{user_id, is_active}` with **no `token_type`**, so connecting GBP overwrites the user's Search Console row (and vice versa). It writes `expires`, but the schema field is `expiry_date`, so expiry is never saved. Every GBP call therefore treats the token as expired and refreshes it, and the refreshed token is never persisted. The GBP scope list also includes the deprecated `plus.business.manage`. The "analytics" flow actually requests `webmasters.readonly` (Search Console). | [userAuth.service.ts:720-772](../src/services/user/userAuth.service.ts#L720-L772), [:616-619](../src/services/user/userAuth.service.ts#L616-L619), [gbpPostSchedular.service.ts:31-34](../src/services/common/gbpPostSchedular.service.ts#L31-L34) | Planned P6 |
| C18 | **Grid middleware always spends a paid call.** The condition `place_id \|\| place_id !== '' \|\| typeof place_id !== 'undefined'` is always true. Place Details (all fields) is called even when the client sent lat/lng, even when `place_id` is null, and **before** the ownership check at line 162. | [localSearchGrid.middleware.ts:107-115](../src/middlewares/common/localSearchGrid.middleware.ts#L107-L115) | Planned P9 (delete) |
| C19 | **Rank tracker service defects.** The mobile and local-pack blocks are guarded by `localFinder[keyword][placeName]` instead of their own tables, so a missing table throws a TypeError. Rank tables are keyed by business **name**, so duplicate or renamed names collide. `overallAvgPosition` returns `NaN` when a channel count is 0 (`?? 51` never catches NaN). "Not found" is 51 here vs 61 in the CLAUDE.md spec. The report is generated synchronously on the request path (minutes per request). | [rankTracker.service.ts:110](../src/services/common/rankTracker.service.ts#L110), [:137](../src/services/common/rankTracker.service.ts#L137), [rankTrackerReport.ts:416-442](../src/helpers/rankTrackerReport.ts#L416-L442), [:772-789](../src/helpers/rankTrackerReport.ts#L772-L789) | Planned P4/P5 |
| C20 | **No timeouts or retries on any outbound call.** Report generation runs inside the HTTP request, with 400 ms per-keyword sleeps and 3 s sleeps between local-finder pages. | all axios call sites (§3) | Planned P3 (clients) |
| C21 | The `post-to-gbp` job stores the whole `user` object and post payload in job data (stale data, PII in `agendaJobs`). The job is not idempotent: it does not check a stored `gbpPostId` before publishing. | [gbpPostSchedular.service.ts:197-201](../src/services/common/gbpPostSchedular.service.ts#L197-L201), [postToGbp.ts](../src/jobs/postToGbp.ts) | Planned P3/P8 |
| C22 | Listing GBP locations (`GET /gbp`) makes a paid legacy Place Details call (reviews and photos fields) per location on the request path, just to read `formatted_address`. It uses only `accounts[0]` and does not paginate. | [gbpPostSchedular.service.ts:71-96](../src/services/common/gbpPostSchedular.service.ts#L71-L96) | Planned P6 |
| C23 | Location create resolves lat/lng with a paid legacy Place Details call (reviews and photos fields). Locations created without `place_id` never get coordinates. | [location.service.ts:46-53](../src/services/common/location.service.ts#L46-L53) | Planned P5 (center resolution) |
| C24 | Missing indexes on hot query paths, and `users.email` is not unique (§2). Duplicate accounts are possible under a race. | §2 | Open |

---

## 7. Dead code and duplication

| Item | Evidence | Status |
|---|---|---|
| `src/services/common/serp.ts` | not imported anywhere | Removed (Phase 1.5 step 4) |
| `src/utils/fileEncryption.ts`: standalone express app on :8080, hardcoded key, imports `body-parser` (not a declared dependency) | not imported | Removed (Phase 1.5 step 4) |
| `src/lib/crypto.ts` (`encrypt`, `decrypt`, `getEncryptedText`, `getDecryptedText`; the `APPLY_ENCRYPTION` feature is never wired) | not imported | Removed (Phase 1.5 step 4). `APPLY_ENCRYPTION` and `SECRET_KEY` remain in config. |
| `src/helpers/gbpPs.ts` (`getBusinessLocations`) | exported from `helpers/index.ts`, never called | Removed with its barrel export (Phase 1.5 step 4) |
| `keywordPositionSearch` ([gbpAudit.ts:34](../src/helpers/gbpAudit.ts#L34)) | imported by `gbpAudit.service.ts`, never called | Removed with the unused import (Phase 1.5 step 4) |
| Moz helpers `getDomainOverviewFromSEOMOZ` and `fetchMozData` ([gbpAudit.ts:168-228](../src/helpers/gbpAudit.ts#L168-L228)) | only a commented-out call site | Removed with the commented call site and unused import (Phase 1.5 step 4). The `SEO_MOZ_*` config keys remain until P9. |
| `src/models/citationPayment.model.ts` (duplicate `LocationCitation`) | not imported, not in the barrel | Removed (Phase 1.5 step 4) |
| `src/configs/serpConfig.ts` | never imported: this is the C13 bug, not safe dead code | Planned P9 |
| `src/configs/razorpay.ts` (entirely commented out) | — | Open |
| `getAverageGooglePositionData`, `getKeywordMovmentData`, `calculateMovement`, `getLastFiveMonthPosition`, `transformData`, `getDatesArr` in `rankTrackerReport.ts` | imported, never called | Planned P9 |
| `unbindGoogleBusinessProfileWithUser` ([gbpPostSchedular.service.ts:424](../src/services/common/gbpPostSchedular.service.ts#L424)) is a copy of bind, and no route calls it | — | **Not dead: it is a bug.** See C12. |
| `src/helpers/getSerpCountryCode.ts` (`getShortCountryCode`): its only caller, `keywordPositionSearch`, was removed in Phase 1.5 | still exported from `helpers/index.ts` | Planned P9 |
| Duplicate country lists: `constants/serpCountryCode.ts` and `configs/google-countries.ts` | — | Planned P9 |
| Duplicate timezone lists: `utils/timezone.ts` (not imported) and `constantTypes.timezones` | — | Open |
| Duplicate OAuth client factories: `configs/oAuth2Client.ts` (function) and `configs/gbpOauthClinet.ts` (singleton, S20) | — | Planned P3/P6 |
| `@paypal/checkout-server-sdk` client created in `configs/paypal.ts`; only `BASE_URL` is used | — | Removed (Phase 1.5) |
| Large commented-out blocks: `subscription.service.ts` (hundreds of lines), `citation.service.ts` (SerpAPI sample payloads), `reputationManagerReport.service.ts` (sample reviews containing real Google reviewer profile URLs) | — | Won't fix (out of scope), but the sample review data should not live in the repo |

---

## 8. Dependency review

**npm audit:** 1 high (`nodemailer` < 7.0.x fixes; latest 10.x) and 5 moderate (`uuid` via `googleapis` and `node-cron`). The fixes are major bumps: `googleapis@182`, `node-cron@4`, `nodemailer@10`.

**Unused dependencies:**

| Package | Evidence | Status |
|---|---|---|
| `http-proxy-middleware` | no import | Removed (Phase 1.5 step 5) |
| `http-status-codes` | no import | Removed (Phase 1.5 step 5) |
| `fs-extra` | no import | Removed (Phase 1.5 step 5) |
| `razorpay` | only a commented-out import in `configs/razorpay.ts` | Removed (Phase 1.5 step 5); the file is untouched |
| `@paypal/checkout-server-sdk` | imported by `configs/paypal.ts`; the client it builds is unused, and only `BASE_URL` is used by `paypal.service.ts` | Removed (Phase 1.5, approved); `configs/paypal.ts` now exports only `BASE_URL` |
| `serpapi` | becomes unused after P9 | Planned P9 |

**Undeclared (phantom) dependencies:**
- `moment-timezone` is imported by `userAuth.service.ts` and `gbpPostSchedular.service.ts` but is not in `package.json`. It resolves only because another package installs it.
- `body-parser` was imported by `fileEncryption.ts` (resolved: the file was removed in Phase 1.5).

**Major versions behind** (`npm outdated`): express 4→5, mongoose 8→9, agenda 5→6, googleapis 148→182, google-auth-library 9→11, helmet 7→8, joi 17→18, nodemailer 6→10, eslint 8→10, typescript-eslint 7→8, typescript 5→7, dotenv 16→18, express-rate-limit 7→8, node-cron 3→4, square 43→46, `@types/node` 20→26. No upgrades are proposed in this phase.

**Tooling configuration:**
- The `build` script copies files that do not exist (§0).
- The `lint` glob is not quoted (§0).
- `tsconfig.json` includes a non-existent file, `src/utils/fetchCountryStateCityDataFromRemoteApi.ts`.
- `strict` is off.
- `.gitignore` excluded `package-lock.json` and `.env.example`.
- `.gitattributes` forced CRLF on `*.ts`.

The last four are addressed in Phase 1.5.

---

## 9. Out-of-scope observations (no changes proposed)

- **Citations:** `citation.service.ts` calls legacy Place Details (all fields). SerpAPI citation helpers fail because of C13. `getAllCitatioList` has no auth (S2).
- **Reputation Manager:** fetches **all** reviews via SerpAPI with unbounded pagination on every GET. Broken by C13. Percentages divide by `placeInfo.reviews`, which can be 0.
- **Payments (Square):** `amount: Math.round(final_price)` is sent as `amount_money.amount`, which Square treats as the smallest currency unit (cents). If `final_price` is in dollars, customers are charged 1/100th. Sandbox is hardcoded (C10).
- **Subscriptions (PayPal):** the webhook is unauthenticated (S4). `createPlan`, `generateCoupon` and similar routes have no auth (S2).
- **Seed scripts:** `mongoMigrate.ts` logs the super-admin password (S21). `fetchCountryStateCityDataFromRemoteApi.ts` inserts without dedupe.
- **Users:** `referral_code` uses `Math.random`. `post('save')` calls `save()` again. `validateRegisterUserBody` dereferences `countryDoc.name` without a null check, so an inactive country id returns 500.
- **Admin:** `resetAdminPassword` takes `admin_id` from the body instead of the token.
- **Swagger:** documents only `/system/*` and `/countries/*`.
- **`/docs`:** Swagger UI is mounted at `/docs`, shadowing the `/docs/:filename` file route.

