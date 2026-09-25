# Route inventory

- **Baseline:** commit `62240ac`.
- **Totals:** 155 live routes. 95 unauthenticated, 56 user token, 2 refresh token, 2 admin token.
- **Findings column:** IDs point to [AUDIT.md](AUDIT.md) (S = security, C = correctness).
- **Middleware order, services and models:** see AUDIT.md §1.

**Auth values:**
- **none**: no authentication.
- `user`: `verifyAuthJWTToken` (user access JWT).
- `refresh token`: `verifyRefreshAuthJWTToken`.
- `admin`: `validateAdminJWTToken`.

**"Purpose"** is taken from the handler name.

**Ownership:** a route marked `user` only proves the caller is logged in. It does not prove the caller owns the location or record they asked for (S15, S25).

Some routes are public by design and are not flagged: login, register, OTP, the OAuth callbacks, reference lists, plan lists, contact-us submit, coupon validation, blog reads and health checks.

Keep this file in sync when routes are added or removed. New Phase 5+ endpoints go in `docs/API.md`.

### Admin

| Method | Path | Auth | Purpose | Findings |
|---|---|---|---|---|
| POST | `/api/v1/admin/auth/register` | **none** | Create Admin User | S1 |
| POST | `/api/v1/admin/auth/login` | **none** | Login Admin User |  |
| POST | `/api/v1/admin/auth/sendOTP` | **none** | Send OTP | S6 |
| POST | `/api/v1/admin/auth/verifyOTP` | **none** | Verify OTP | S6 |
| POST | `/api/v1/admin/auth/resetPassword` | admin | Reset Admin Password |  |
| POST | `/api/v1/admin/auth/forgotPassword` | **none** | Forgot Admin Password | S6 |
| GET | `/api/v1/admin/auth/getAllAdmins` | **none** | Get All Admins | S1 |
| GET | `/api/v1/admin/auth/getAdminById/:id` | **none** | Find Admin By Id | S1 |
| GET | `/api/v1/admin/auth/getProfile` | admin | Get Profile |  |
| PUT | `/api/v1/admin/auth/updateAdmin` | **none** | Update Admin | S1 (admin takeover) |
| DELETE | `/api/v1/admin/auth/deleteAdmin` | **none** | Delete Admin | S1 |
| GET | `/api/v1/admin/operations/getAllAgencies` | **none** | Get All Agencies | S1 |
| GET | `/api/v1/admin/operations/getAgencyById/:id` | **none** | Get Agency By Id | S1 |
| PUT | `/api/v1/admin/operations/updateAgencyStatus` | **none** | Update Agency Status | S1 |
| GET | `/api/v1/admin/operations/getAllBusinesses` | **none** | Get All Businesses | S1 |
| GET | `/api/v1/admin/operations/getBusinessesById/:id` | **none** | Get Businesses By Id | S1 |
| GET | `/api/v1/admin/operations/getAllClients` | **none** | Get All Clients | S1 |

### User auth & account

| Method | Path | Auth | Purpose | Findings |
|---|---|---|---|---|
| POST | `/api/v1/user/auth/register` | **none** | Register |  |
| POST | `/api/v1/user/auth/otp` | **none** | Send OTP |  |
| POST | `/api/v1/user/auth/verify-otp` | **none** | Verify OTP | S22 |
| POST | `/api/v1/user/auth/login` | **none** | Login |  |
| POST | `/api/v1/user/auth/reset-password` | user | Reset Password |  |
| POST | `/api/v1/user/auth/forgot-password` | **none** | Forgot Password | S6, S22 |
| POST | `/api/v1/user/auth/refresh-auth` | refresh token | Refresh Auth |  |
| POST | `/api/v1/user/auth/logout` | refresh token | Logout |  |
| GET | `/api/v1/user/auth/deactivate` | user | Deactivate Account | S23 |
| GET | `/api/v1/user/auth/google/analytics` | user | Get Analytics Auth Url |  |
| GET | `/api/v1/user/auth/google/analytics/callback` | **none** | Analytics Auth Callback | S11, C17 |
| POST | `/api/v1/user/auth/google/analytics/revoke` | user | Analytics Connection Revoke |  |
| GET | `/api/v1/user/auth/google/gbp` | user | Get GBP Auth Url |  |
| GET | `/api/v1/user/auth/google/gbp/callback` | **none** | GBP Auth Callback | S11, C17 |
| POST | `/api/v1/user/auth/google/gbp/revoke` | user | GBP Connection Revoke | S29 |
| POST | `/api/v1/user/auth/employee/add` | user | Add Employee |  |
| DELETE | `/api/v1/user/auth/employee/remove` | user | Delete Employee |  |
| GET | `/api/v1/user/auth/employee/all` | user | Get All Employee By Owner |  |
| GET | `/api/v1/user/auth/employee/details/:employee_id` | user | Employee Details |  |
| GET | `/api/v1/user/profile` | user | Get Profile |  |
| POST | `/api/v1/user/notifications` | user | Notification Toogle |  |
| PUT | `/api/v1/user/profile` | user | Update Profile |  |
| POST | `/api/v1/user/clients` | user | Create Client |  |
| GET | `/api/v1/user/clients` | user | Get All Client |  |
| GET | `/api/v1/user/clients/:client_id` | user | Get Client Details |  |
| PUT | `/api/v1/user/clients` | user | Update Client |  |
| DELETE | `/api/v1/user/clients/:client_id` | user | Delete Client |  |

### Locations

| Method | Path | Auth | Purpose | Findings |
|---|---|---|---|---|
| POST | `/api/v1/locations` | user | Create Location |  |
| GET | `/api/v1/locations/:locationId` | **none** | Get Location Details | S17 |
| DELETE | `/api/v1/locations/:locationId` | user | Delete Location | S23 |
| PUT | `/api/v1/locations` | user | Update Location |  |
| GET | `/api/v1/locations` | user | Get Location By User |  |
| GET | `/api/v1/locations/google-locations/:name` | **none** | Get Google Locations | S18 |
| GET | `/api/v1/locations/google-locations/details/:placeId` | **none** | Get Google Location Details | S18 |

### Ranking (in scope)

| Method | Path | Auth | Purpose | Findings |
|---|---|---|---|---|
| POST | `/api/v1/rank-tracker` | user | Generate Rank Tracker Report | C1, C2, C3, C13, C19 |
| GET | `/api/v1/rank-tracker/:locationId` | user | Get Rank Tracker Report | S15 |
| POST | `/api/v1/local-search-grid` | user | Generate Local Search Grid Report | C4, C5, C6, C18 |
| GET | `/api/v1/local-search-grid/:locationId` | user | Get Local Search Grid Report | S15 |
| POST | `/api/v1/local-map-ranking` | user | Generate Local Map Ranking Report | C6, C13 |
| GET | `/api/v1/local-map-ranking/:locationId` | user | Get Local Map Ranking Report | S15 |

### GBP (in scope)

| Method | Path | Auth | Purpose | Findings |
|---|---|---|---|---|
| POST | `/api/v1/gbp-audit` | user | Generate GBP Audit Report |  |
| GET | `/api/v1/gbp-audit/:locationId` | user | Get GBP Audit Report | S15, C8 |
| GET | `/api/v1/gbp` | user | Get Registered Google Business Profile | S20, C22 |
| POST | `/api/v1/gbp/bind-with-user` | user | Bind Google Business Profile With User |  |
| POST | `/api/v1/gbp/post/add` | user | Add Post To GBP | C14, C15 |
| GET | `/api/v1/gbp/post/all/:location_id/:type` | user | Get All Post By Location Id |  |
| DELETE | `/api/v1/gbp/post/remove` | user | Delete Post | S25, C16 |

### White label

| Method | Path | Auth | Purpose | Findings |
|---|---|---|---|---|
| POST | `/api/v1/white-label-profiles` | user | Create New Profile |  |
| PATCH | `/api/v1/white-label-profiles` | user | Update White Label Profile |  |
| GET | `/api/v1/white-label-profiles` | user | Get White Label Profile |  |
| GET | `/api/v1/white-label-profiles/:whiteLevelProfileId` | **none** | Get White Label Profile Detail | S17 |
| DELETE | `/api/v1/white-label-profiles/:whiteLevelProfileId` | user | Delete White Level Profile | S17 |
| GET | `/api/v1/white-label-profiles/rank-tracker-report/:whiteLevelProfileId` | **none** | Get Rank Tracker Report For WLP | S17 |
| GET | `/api/v1/white-label-profiles/reputation-manager-report/:whiteLevelProfileId` | **none** | Get Reputation Manager Report For WLP | S17 |
| GET | `/api/v1/white-label-profiles/gbp-audit-report/:whiteLevelProfileId` | **none** | Get GBP Audit Report For WLP | S17, C8 |

### Reputation manager

| Method | Path | Auth | Purpose | Findings |
|---|---|---|---|---|
| GET | `/api/v1/reputation-manager/monitor-reviews/:locationId` | user | Get Monitor Review Report |  |

### Citations

| Method | Path | Auth | Purpose | Findings |
|---|---|---|---|---|
| GET | `/api/v1/citation/manual/listings/pricings` | user | Get Manual Submission Prices |  |
| GET | `/api/v1/citation/aggregators/list` | user | Get Aggregators Details |  |
| GET | `/api/v1/citation/remove/prices/list` | user | Get Citatio Remove Prices |  |
| GET | `/api/v1/citation/lists/:location_id` | user | Get Citatio List |  |
| POST | `/api/v1/citation/campaign/add/new` | user | Add Citation Campaign |  |
| POST | `/api/v1/citation/campaign/add/busines/info` | user | Add Citation Campaign Busines Info |  |
| GET | `/api/v1/citation/:location_id/campaign/:campaign_id/details` | user | Get Campaign Details |  |
| GET | `/api/v1/citation/:location_id/campaign/all` | user | Get All Campaign |  |
| GET | `/api/v1/citation/locations/campaigns/list/all` | user | Get All Citation By Token |  |
| POST | `/api/v1/citation/tracker` | user | Generate Citation Tracker Report |  |
| GET | `/api/v1/citation/tracker` | user | Get Citation Tracker Report |  |
| POST | `/api/v1/citation/builder` | user | Citation Builder |  |
| GET | `/api/v1/citation/getAllCitatioList` | **none** | Get All Citatio List | S2 |

### Payments & subscriptions

| Method | Path | Auth | Purpose | Findings |
|---|---|---|---|---|
| POST | `/api/v1/subscription` | **none** | Create Plan | S2 |
| GET | `/api/v1/subscription` | **none** | Get All Plans | S2 |
| GET | `/api/v1/subscription/plans/country/:country` | **none** | Get Plans By Country |  |
| PUT | `/api/v1/subscription/:plan_id` | **none** | Update Plan | S2 |
| DELETE | `/api/v1/subscription/:plan_id` | **none** | Delete Plan | S2 |
| POST | `/api/v1/subscription/create-subscription` | **none** | Create Subscription |  |
| POST | `/api/v1/subscription/paypal/webhook` | **none** | Paypal Webhook | S4 |
| GET | `/api/v1/subscription/payment-status` | **none** | Get Payment Status | S2 |
| POST | `/api/v1/subscription/coupon/generate` | **none** | Generate Coupon | S2 |
| POST | `/api/v1/subscription/coupon/validate` | **none** | Validate Coupon |  |
| GET | `/api/v1/subscription/coupons` | **none** | Get All Coupons | S2 |
| GET | `/api/v1/subscription/payments/all` | **none** | Get All Payment History | S2 |
| POST | `/api/v1/subscription/send-subscription-welcome-mail` | **none** | Send Subscription Welcome Mail Controller | S2 |
| POST | `/api/v1/payments/process-payment` | user | Make Square Payment |  |
| GET | `/api/v1/payments/plans/list` | **none** | Get Plans |  |
| GET | `/api/v1/payments/getAllPayments` | **none** | Get All Payments | S2 |

### Reference data

| Method | Path | Auth | Purpose | Findings |
|---|---|---|---|---|
| GET | `/api/v1/countries` | **none** | Get All Country |  |
| GET | `/api/v1/countries/states/:countryId` | **none** | Get All State By Country Id |  |
| GET | `/api/v1/countries/cities/:stateId` | **none** | Get All City By State Id |  |
| POST | `/api/v1/roles` | **none** | Create Role | S2 |
| GET | `/api/v1/roles/:roleId` | **none** | Find Role By Id | S2 |
| GET | `/api/v1/roles` | **none** | Get All Roles | S2 |
| PUT | `/api/v1/roles/:roleId` | **none** | Update Role | S2 |
| DELETE | `/api/v1/roles/:roleId` | **none** | Delete Role | S2 |
| GET | `/api/v1/languages` | **none** | Get All Language |  |
| GET | `/api/v1/timezones` | **none** | Get All Timezone |  |
| POST | `/api/v1/business-categories` | **none** | Create Business Category | S2 |
| GET | `/api/v1/business-categories` | **none** | Get All Business Category | S2 |
| PUT | `/api/v1/business-categories/:businessCategoryId` | **none** | Update Business Category | S2 |

### Content & support

| Method | Path | Auth | Purpose | Findings |
|---|---|---|---|---|
| GET | `/api/v1/faqs` | **none** | Get All Faq |  |
| POST | `/api/v1/faqs` | **none** | Create Faq | S27 |
| PUT | `/api/v1/faqs/:faqId` | **none** | Update Faq | S27 |
| DELETE | `/api/v1/faqs/:faqId` | **none** | Delete Faq | S27 |
| POST | `/api/v1/supports` | user | Create Support |  |
| GET | `/api/v1/supports` | user | Get All Support |  |
| DELETE | `/api/v1/supports/:supportId` | user | Delete Support |  |
| GET | `/api/v1/supports/getAllSupportByAdmin` | **none** | Get All Support Tickets By Admin | S2 |
| PUT | `/api/v1/supports/updateSupportTicketStatus` | **none** | Update Support Ticket Status | S2 |
| GET | `/api/v1/supports/getSupportTicketStatusCounts` | **none** | Get Support Ticket Status Counts | S2 |
| POST | `/api/v1/contact-us` | **none** | Create Contact Us |  |
| GET | `/api/v1/contact-us/get` | **none** | Get All Contact Us | S27 |
| GET | `/api/v1/contact-us/:contactId` | **none** | Get Contact Us By Id | S27 |
| PUT | `/api/v1/contact-us/:contactId/status` | **none** | Update Contact Us Status | S27 |
| DELETE | `/api/v1/contact-us/:contactId` | **none** | Delete Contact Us | S27 |
| POST | `/api/v1/blog` | **none** | Create Blog | S27 |
| GET | `/api/v1/blog/get` | **none** | Get All Blogs |  |
| GET | `/api/v1/blog/slug/:slug` | **none** | Get Blog By Slug |  |
| GET | `/api/v1/blog/:blogId` | **none** | Get Blog By Id |  |
| PUT | `/api/v1/blog/:blogId` | **none** | Update Blog | S27 |
| DELETE | `/api/v1/blog/:blogId` | **none** | Delete Blog | S27 |
| POST | `/api/v1/blog-category` | **none** | Create Blog Category | S27 |
| GET | `/api/v1/blog-category/get` | **none** | Get All Blog Categories |  |
| GET | `/api/v1/blog-category/:categoryId` | **none** | Get Blog Category By Id |  |
| PUT | `/api/v1/blog-category/:categoryId` | **none** | Update Blog Category | S27 |
| DELETE | `/api/v1/blog-category/:categoryId` | **none** | Delete Blog Category | S27 |

### System & infrastructure

| Method | Path | Auth | Purpose | Findings |
|---|---|---|---|---|
| GET | `/api/v1/system/info` | **none** | Get System Info | S2 |
| GET | `/api/v1/system/time` | **none** | Get Server Time | S2 |
| GET | `/api/v1/system/usage` | **none** | Get Resource Usage | S2 |
| GET | `/api/v1/system/process` | **none** | Get Process Info | S2 |
| GET | `/api/v1/logs` | **none** | Ts) | S3 |
| DELETE | `/api/v1/logs` | **none** | Ts) | S3 |
| GET | `/images/:filename` | **none** | Ts) | S16 |
| GET | `/videos/:filename` | **none** | Ts) | S16 |
| GET | `/gifs/:filename` | **none** | Ts) | S16 |
| GET | `/docs/:filename` | **none** | Ts) | S16 |
| GET | `/songs/:filename` | **none** | Ts) | S16 |
| GET | `/api/healthcheck` | **none** | Ts) |  |
| GET | `/ping` | **none** | Ts) |  |
| GET | `/docs` | **none** | Swagger-ui |  |
