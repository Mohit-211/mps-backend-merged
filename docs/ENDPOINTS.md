# Endpoints

**The single source of truth for every current endpoint** (method, path, auth, purpose, phase added, status). Request and response examples for the rebuilt endpoints are in [API.md](API.md). [ROUTES.md](ROUTES.md) is a frozen Phase 1 snapshot (with the audit findings) and is no longer updated.

**Rule (Mohit, 2026-09-26):**
- Every commit that adds, changes or removes an endpoint updates this file in the **same commit**, and [API.md](API.md) too when a request or response shape changes.
- `npm run check:endpoints` loads the Express app, lists every registered route and compares it with the catalogue below. It fails on a route missing here, on an entry here with no route, on a bad status, and on a detail-table row (`#`) that isn't in the catalogue. It runs as part of `npm test`.

**Status values:**

| Status | Meaning |
|---|---|
| live | Registered in every environment |
| behind flag | Registered, but answers only when a config flag enables it (the flag is named in the purpose) |
| deprecated | Still registered; will be removed (the replacement is named in the purpose) |
| dev only | Registered only when `NODE_ENV=development`; never in test or production |

**Phase:** `legacy` = from the old codebase and not rebuilt; `legacy, rebuilt N` = old path, rebuilt in phase N; otherwise the phase that added it.

## Conventions

**Base URL:** `/api/v1`. Local: `http://localhost:5055/api/v1`.

**Auth:**
- `user`: header `Authorization: Bearer <access token>`. A missing or invalid token gives **401**.
- `owner`: `:locationId` must be one of the caller's own active locations. Otherwise **404**; a malformed id gives **400**.
- `none`: no MyPageSEO login (the Google OAuth callback only).

**Response envelope:** every response is `{ "success": bool, "status": number, "message": string, "data": … }`.

**Common errors:**

| Status | Meaning |
|---|---|
| 400 | Invalid input, or a missing precondition |
| 401 | No or invalid login |
| 404 | Not found, or not yours |
| 409 | Conflict |
| 422 | Run over the call cap |
| 429 | Daily search limit |
| 502 | Google failed |
| 503 | Not configured / GBP access not approved |

---

## Catalogue: all current endpoints

Paths are full paths. Auth: `none`, `user` (user access token), `user + owner` (also owns the location, otherwise 404), `refresh token`, `admin`. The security findings for legacy routes (S1–S30) are in [AUDIT.md](AUDIT.md) and the [ROUTES.md](ROUTES.md) snapshot.

### Admin

| Method | Path | Auth | Purpose | Phase | Status |
|---|---|---|---|---|---|
| POST | `/api/v1/admin/auth/register` | none | Create Admin User | legacy | live |
| POST | `/api/v1/admin/auth/login` | none | Login Admin User | legacy | live |
| POST | `/api/v1/admin/auth/sendOTP` | none | Send OTP | legacy | live |
| POST | `/api/v1/admin/auth/verifyOTP` | none | Verify OTP | legacy | live |
| POST | `/api/v1/admin/auth/resetPassword` | admin | Reset Admin Password | legacy | live |
| POST | `/api/v1/admin/auth/forgotPassword` | none | Forgot Admin Password | legacy | live |
| GET | `/api/v1/admin/auth/getAllAdmins` | none | Get All Admins | legacy | live |
| GET | `/api/v1/admin/auth/getAdminById/:id` | none | Find Admin By Id | legacy | live |
| GET | `/api/v1/admin/auth/getProfile` | admin | Get Profile | legacy | live |
| PUT | `/api/v1/admin/auth/updateAdmin` | none | Update Admin | legacy | live |
| DELETE | `/api/v1/admin/auth/deleteAdmin` | none | Delete Admin | legacy | live |
| GET | `/api/v1/admin/operations/getAllAgencies` | none | Get All Agencies | legacy | live |
| GET | `/api/v1/admin/operations/getAgencyById/:id` | none | Get Agency By Id | legacy | live |
| PUT | `/api/v1/admin/operations/updateAgencyStatus` | none | Update Agency Status | legacy | live |
| GET | `/api/v1/admin/operations/getAllBusinesses` | none | Get All Businesses | legacy | live |
| GET | `/api/v1/admin/operations/getBusinessesById/:id` | none | Get Businesses By Id | legacy | live |
| GET | `/api/v1/admin/operations/getAllClients` | none | Get All Clients | legacy | live |

### User auth & account

| Method | Path | Auth | Purpose | Phase | Status |
|---|---|---|---|---|---|
| POST | `/api/v1/user/auth/register` | none | Register | legacy | live |
| POST | `/api/v1/user/auth/otp` | none | Send OTP | legacy | live |
| POST | `/api/v1/user/auth/verify-otp` | none | Verify OTP | legacy | live |
| POST | `/api/v1/user/auth/login` | none | Login | legacy | live |
| POST | `/api/v1/user/auth/reset-password` | user | Reset Password | legacy | live |
| POST | `/api/v1/user/auth/forgot-password` | none | Forgot Password | legacy | live |
| POST | `/api/v1/user/auth/refresh-auth` | refresh token | Refresh Auth | legacy | live |
| POST | `/api/v1/user/auth/logout` | refresh token | Logout | legacy | live |
| GET | `/api/v1/user/auth/deactivate` | user | Deactivate Account | legacy | live |
| POST | `/api/v1/user/auth/employee/add` | user | Add Employee | legacy | live |
| DELETE | `/api/v1/user/auth/employee/remove` | user | Delete Employee | legacy | live |
| GET | `/api/v1/user/auth/employee/all` | user | Get All Employee By Owner | legacy | live |
| GET | `/api/v1/user/auth/employee/details/:employee_id` | user | Employee Details | legacy | live |
| GET | `/api/v1/user/profile` | user | Get Profile | legacy | live |
| POST | `/api/v1/user/notifications` | user | Notification Toogle | legacy | live |
| PUT | `/api/v1/user/profile` | user | Update Profile | legacy | live |
| POST | `/api/v1/user/clients` | user | Create Client | legacy | live |
| GET | `/api/v1/user/clients` | user | Get All Client | legacy | live |
| GET | `/api/v1/user/clients/:client_id` | user | Get Client Details | legacy | live |
| PUT | `/api/v1/user/clients` | user | Update Client | legacy | live |
| DELETE | `/api/v1/user/clients/:client_id` | user | Delete Client | legacy | live |

### Locations

| Method | Path | Auth | Purpose | Phase | Status |
|---|---|---|---|---|---|
| POST | `/api/v1/locations` | user | Create Location | legacy | live |
| GET | `/api/v1/locations/:locationId` | none | Get Location Details | legacy | live |
| DELETE | `/api/v1/locations/:locationId` | user | Delete Location | legacy | live |
| PUT | `/api/v1/locations` | user | Update Location | legacy | live |
| GET | `/api/v1/locations` | user | Get Location By User | legacy | live |
| GET | `/api/v1/locations/google-locations/:name` | none | Get Google Locations | legacy | live |
| GET | `/api/v1/locations/google-locations/details/:placeId` | none | Get Google Location Details | legacy | live |

### Ranking

| Method | Path | Auth | Purpose | Phase | Status |
|---|---|---|---|---|---|
| GET | `/api/v1/locations/:locationId/tracking` | user + owner | Ranking settings (keywords, competitors, grid, frequency) and the cost estimate | 5 | live |
| PUT | `/api/v1/locations/:locationId/tracking` | user + owner | Update ranking settings (bumps `keywords_version` when the keyword set changes) | 5 | live |
| POST | `/api/v1/locations/:locationId/rank-runs` | user + owner | "Run now": queue a rank run (one active run per location; 422 over the call cap; 7b: shares the 24 h rankings refresh limit, 429) | 5 | live |
| GET | `/api/v1/locations/:locationId/rank-runs` | user + owner | Run history (paginated) | 5 | live |
| GET | `/api/v1/locations/:locationId/rank-runs/:runId` | user + owner | Run status, API calls, errors | 5 | live |
| GET | `/api/v1/locations/:locationId/rank-tracker` | user + owner | Rank Tracker page (`?runId=`) | 5 | live |
| GET | `/api/v1/locations/:locationId/grid` | user + owner | Local Search Grid page (`?keyword=&runId=`) | 5 | live |
| GET | `/api/v1/locations/:locationId/map-ranking` | user + owner | Local Map Ranking page (`?keyword=&runId=&resolveNames=`) | 5 | live |

### GBP connection

| Method | Path | Auth | Purpose | Phase | Status |
|---|---|---|---|---|---|
| GET | `/api/v1/user/auth/google/gbp` | user | Google consent URL (redirect fallback flow) | legacy, rebuilt 6 | live |
| GET | `/api/v1/user/auth/google/gbp/callback` | none (one-time `state`) | Google OAuth callback (redirect flow): stores encrypted tokens | legacy, rebuilt 6 | live |
| POST | `/api/v1/user/auth/google/gbp/revoke` | user | Disconnect one Google account (`google_sub`): revoke it, remove its bindings, jobs and tokens | legacy, rebuilt 6 | live |
| GET | `/api/v1/user/auth/google/gbp/popup` | user | GIS popup config with a one-time state | 7a | live |
| POST | `/api/v1/user/auth/google/gbp/code` | user | Exchange the popup code (`postmessage`), verify id_token | 7a | live |
| GET | `/api/v1/gbp` | user | Every GBP profile from every connected Google account, grouped (`{ connections: [...] }`; no Places calls) | legacy, rebuilt 6 | live |
| POST | `/api/v1/gbp/bind-with-user` | user | Bind a GBP location to a Location (read from Google, `place_id` rules; `google_sub` with several accounts) | legacy, rebuilt 6 | live |
| POST | `/api/v1/gbp/unbind` | user | Unbind a Location | 6 | live |

### Onboarding

| Method | Path | Auth | Purpose | Phase | Status |
|---|---|---|---|---|---|
| GET | `/api/v1/onboarding/state` | user | Connection + onboarding locations (resume) | 7a | live |
| GET | `/api/v1/onboarding/gbp-profiles` | user | Every accessible profile, `supported` flag | 7a | live |
| POST | `/api/v1/onboarding/select-profile` | user | Create or link a Location from a profile and bind | 7a | live |
| POST | `/api/v1/onboarding/complete` | user | First rank run + GBP sync request | 7a | live |
| GET | `/api/v1/locations/:locationId/competitor-suggestions` | user + owner | Top 10 competitors across keywords (Places Enterprise, 24 h cache, daily cap) | 7a | live |
| GET | `/api/v1/places/search` | user + owner (`locationId`) | Manual competitor search (Places Pro, 10 results, daily cap) | 7a | live |
| PUT | `/api/v1/locations/:locationId/center` | user + owner | Manual business center from a city or ZIP (service-area businesses; 1 IDs-only search + 1 Details `location`) | 7a | live |

### Refresh and GBP sync

| Method | Path | Auth | Purpose | Phase | Status |
|---|---|---|---|---|---|
| POST | `/api/v1/locations/:locationId/refresh` | user + owner | Manual refresh `{ types? }` (24 h per type) | 7b | live |
| GET | `/api/v1/locations/:locationId/refresh` | user + owner | Refresh button state and monthly schedule | 7b | live |
| GET | `/api/v1/locations/:locationId/gbp/sync` | user + owner | Latest (or `?syncId=`) GBP sync, status per data type | 7b | live |

### GBP report

| Method | Path | Auth | Purpose | Phase | Status |
|---|---|---|---|---|---|
| GET | `/api/v1/locations/:locationId/gbp/report` | user + owner | The stored GBP report (`?range=28d\|90d\|12m`): GBP Score, performance, keywords, reviews/media/posts, competitor comparison with Public Scores and gap insights | 7c | live |

### GBP posting (legacy, rebuilt in Phase 9)

| Method | Path | Auth | Purpose | Phase | Status |
|---|---|---|---|---|---|
| POST | `/api/v1/gbp/post/add` | user | Add Post To GBP | legacy | live |
| GET | `/api/v1/gbp/post/all/:location_id/:type` | user | Get All Post By Location Id | legacy | live |
| DELETE | `/api/v1/gbp/post/remove` | user | Delete Post | legacy | live |

### White label

| Method | Path | Auth | Purpose | Phase | Status |
|---|---|---|---|---|---|
| POST | `/api/v1/white-label-profiles` | user | Create New Profile | legacy | live |
| PATCH | `/api/v1/white-label-profiles` | user | Update White Label Profile | legacy | live |
| GET | `/api/v1/white-label-profiles` | user | Get White Label Profile | legacy | live |
| GET | `/api/v1/white-label-profiles/:whiteLevelProfileId` | none | Get White Label Profile Detail | legacy | live |
| DELETE | `/api/v1/white-label-profiles/:whiteLevelProfileId` | user | Delete White Level Profile | legacy | live |

### Citations

| Method | Path | Auth | Purpose | Phase | Status |
|---|---|---|---|---|---|
| GET | `/api/v1/citation/manual/listings/pricings` | user | Get Manual Submission Prices | legacy | live |
| GET | `/api/v1/citation/aggregators/list` | user | Get Aggregators Details | legacy | live |
| GET | `/api/v1/citation/remove/prices/list` | user | Get Citatio Remove Prices | legacy | live |
| GET | `/api/v1/citation/lists/:location_id` | user | Get Citatio List | legacy | live |
| POST | `/api/v1/citation/campaign/add/new` | user | Add Citation Campaign | legacy | live |
| POST | `/api/v1/citation/campaign/add/busines/info` | user | Add Citation Campaign Busines Info | legacy | live |
| GET | `/api/v1/citation/:location_id/campaign/:campaign_id/details` | user | Get Campaign Details | legacy | live |
| GET | `/api/v1/citation/:location_id/campaign/all` | user | Get All Campaign | legacy | live |
| GET | `/api/v1/citation/locations/campaigns/list/all` | user | Get All Citation By Token | legacy | live |
| POST | `/api/v1/citation/tracker` | user | Generate Citation Tracker Report | legacy | live |
| GET | `/api/v1/citation/tracker` | user | Get Citation Tracker Report | legacy | live |
| POST | `/api/v1/citation/builder` | user | Citation Builder | legacy | live |
| GET | `/api/v1/citation/getAllCitatioList` | none | Get All Citatio List | legacy | live |

### Payments & subscriptions

| Method | Path | Auth | Purpose | Phase | Status |
|---|---|---|---|---|---|
| POST | `/api/v1/subscription` | none | Create Plan | legacy | live |
| GET | `/api/v1/subscription` | none | Get All Plans | legacy | live |
| GET | `/api/v1/subscription/plans/country/:country` | none | Get Plans By Country | legacy | live |
| PUT | `/api/v1/subscription/:plan_id` | none | Update Plan | legacy | live |
| DELETE | `/api/v1/subscription/:plan_id` | none | Delete Plan | legacy | live |
| POST | `/api/v1/subscription/create-subscription` | none | Create Subscription | legacy | live |
| POST | `/api/v1/subscription/paypal/webhook` | none | Paypal Webhook | legacy | live |
| GET | `/api/v1/subscription/payment-status` | none | Get Payment Status | legacy | live |
| POST | `/api/v1/subscription/coupon/generate` | none | Generate Coupon | legacy | live |
| POST | `/api/v1/subscription/coupon/validate` | none | Validate Coupon | legacy | live |
| GET | `/api/v1/subscription/coupons` | none | Get All Coupons | legacy | live |
| GET | `/api/v1/subscription/payments/all` | none | Get All Payment History | legacy | live |
| POST | `/api/v1/subscription/send-subscription-welcome-mail` | none | Send Subscription Welcome Mail Controller | legacy | live |
| POST | `/api/v1/payments/process-payment` | user | Make Square Payment | legacy | live |
| GET | `/api/v1/payments/plans/list` | none | Get Plans | legacy | live |
| GET | `/api/v1/payments/getAllPayments` | none | Get All Payments | legacy | live |

### Reference data

| Method | Path | Auth | Purpose | Phase | Status |
|---|---|---|---|---|---|
| GET | `/api/v1/countries` | none | Get All Country | legacy | live |
| GET | `/api/v1/countries/states/:countryId` | none | Get All State By Country Id | legacy | live |
| GET | `/api/v1/countries/cities/:stateId` | none | Get All City By State Id | legacy | live |
| POST | `/api/v1/roles` | none | Create Role | legacy | live |
| GET | `/api/v1/roles/:roleId` | none | Find Role By Id | legacy | live |
| GET | `/api/v1/roles` | none | Get All Roles | legacy | live |
| PUT | `/api/v1/roles/:roleId` | none | Update Role | legacy | live |
| DELETE | `/api/v1/roles/:roleId` | none | Delete Role | legacy | live |
| GET | `/api/v1/languages` | none | Get All Language | legacy | live |
| GET | `/api/v1/timezones` | none | Get All Timezone | legacy | live |
| POST | `/api/v1/business-categories` | none | Create Business Category | legacy | live |
| GET | `/api/v1/business-categories` | none | Get All Business Category | legacy | live |
| PUT | `/api/v1/business-categories/:businessCategoryId` | none | Update Business Category | legacy | live |

### Content & support

| Method | Path | Auth | Purpose | Phase | Status |
|---|---|---|---|---|---|
| GET | `/api/v1/faqs` | none | Get All Faq | legacy | live |
| POST | `/api/v1/faqs` | none | Create Faq | legacy | live |
| PUT | `/api/v1/faqs/:faqId` | none | Update Faq | legacy | live |
| DELETE | `/api/v1/faqs/:faqId` | none | Delete Faq | legacy | live |
| POST | `/api/v1/supports` | user | Create Support | legacy | live |
| GET | `/api/v1/supports` | user | Get All Support | legacy | live |
| DELETE | `/api/v1/supports/:supportId` | user | Delete Support | legacy | live |
| GET | `/api/v1/supports/getAllSupportByAdmin` | none | Get All Support Tickets By Admin | legacy | live |
| PUT | `/api/v1/supports/updateSupportTicketStatus` | none | Update Support Ticket Status | legacy | live |
| GET | `/api/v1/supports/getSupportTicketStatusCounts` | none | Get Support Ticket Status Counts | legacy | live |
| POST | `/api/v1/contact-us` | none | Create Contact Us | legacy | live |
| GET | `/api/v1/contact-us/get` | none | Get All Contact Us | legacy | live |
| GET | `/api/v1/contact-us/:contactId` | none | Get Contact Us By Id | legacy | live |
| PUT | `/api/v1/contact-us/:contactId/status` | none | Update Contact Us Status | legacy | live |
| DELETE | `/api/v1/contact-us/:contactId` | none | Delete Contact Us | legacy | live |
| POST | `/api/v1/blog` | none | Create Blog | legacy | live |
| GET | `/api/v1/blog/get` | none | Get All Blogs | legacy | live |
| GET | `/api/v1/blog/slug/:slug` | none | Get Blog By Slug | legacy | live |
| GET | `/api/v1/blog/:blogId` | none | Get Blog By Id | legacy | live |
| PUT | `/api/v1/blog/:blogId` | none | Update Blog | legacy | live |
| DELETE | `/api/v1/blog/:blogId` | none | Delete Blog | legacy | live |
| POST | `/api/v1/blog-category` | none | Create Blog Category | legacy | live |
| GET | `/api/v1/blog-category/get` | none | Get All Blog Categories | legacy | live |
| GET | `/api/v1/blog-category/:categoryId` | none | Get Blog Category By Id | legacy | live |
| PUT | `/api/v1/blog-category/:categoryId` | none | Update Blog Category | legacy | live |
| DELETE | `/api/v1/blog-category/:categoryId` | none | Delete Blog Category | legacy | live |

### System & infrastructure

| Method | Path | Auth | Purpose | Phase | Status |
|---|---|---|---|---|---|
| GET | `/api/v1/system/info` | none | Get System Info | legacy | live |
| GET | `/api/v1/system/time` | none | Get Server Time | legacy | live |
| GET | `/api/v1/system/usage` | none | Get Resource Usage | legacy | live |
| GET | `/api/v1/system/process` | none | Get Process Info | legacy | live |
| GET | `/api/v1/logs` | none | Read today's log file | legacy | live |
| DELETE | `/api/v1/logs` | none | Delete all log files | legacy | live |
| GET | `/images/:filename` | none | Serve an uploaded file (`public/uploads/images`) | legacy | live |
| GET | `/videos/:filename` | none | Serve an uploaded file (`public/uploads/videos`) | legacy | live |
| GET | `/gifs/:filename` | none | Serve an uploaded file (`public/uploads/gifs`) | legacy | live |
| GET | `/docs/:filename` | none | Serve an uploaded file (`public/uploads/docs`) | legacy | live |
| GET | `/songs/:filename` | none | Serve an uploaded file (`public/uploads/songs`) | legacy | live |
| GET | `/api/healthcheck` | none | Health check | legacy | live |
| GET | `/ping` | none | Ping | legacy | live |
| GET | `/docs` | none | Swagger UI | legacy | live |
### Development only

| Method | Path | Auth | Purpose | Phase | Status |
|---|---|---|---|---|---|
| GET | `/dev/gbp-connect` | none (the page asks for a MyPageSEO token) | Test page for the Google popup connect (GIS code client) without the real frontend; calls #11 and #12, then optionally #18. See [GBP_CONNECT.md](GBP_CONNECT.md) §3a | after 7b | dev only |

---

## Details: rebuilt endpoints

The `#` numbers are used across the docs. Paths below are relative to `/api/v1`.

### Ranking: tracking settings and runs (Phase 5)

| # | Method | Path | Auth | Path params | Query params | Body | Returns |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/locations/:locationId/tracking` | user, owner | `locationId` | – | – | Tracking settings (defaults filled) + the API-call estimate for a run |
| 2 | PUT | `/locations/:locationId/tracking` | user, owner | `locationId` | – | At least one of the fields below | Saved settings, estimate, `keywords_version_bumped`, `onboarding_step` (onboarding locations only) |
| 3 | POST | `/locations/:locationId/rank-runs` | user, owner | `locationId` | – | – | **202** `{ run_id, status, existing, estimate, dev_capped }` |
| 4 | GET | `/locations/:locationId/rank-runs` | user, owner | `locationId` | `page` (default 1), `limit` (default 15, max 100) | – | Run history: `{ runs, page, limit, total }` |
| 5 | GET | `/locations/:locationId/rank-runs/:runId` | user, owner | `locationId`, `runId` | – | – | Run status, timings, `api_calls`, estimate, `errors_count`, `failure_reason` |

**Body fields for #2** (all optional; send at least one):

| Field | Rule |
|---|---|
| `keywords` | string[]: 1–20 keywords, each 2–80 characters. Duplicates are merged ignoring case. Changing the set bumps `keywords_version`. |
| `competitors` | string[]: up to 5 place IDs, not your own. `[]` means none. |
| `grid` | `{ size: 3 \| 5 \| 7, spacing_km: 0.25–5 }` |
| `frequency` | `'auto_monthly'` (default: refreshed monthly) \| `'manual_only'` (only on demand). Sending `next_run_at` is rejected (400). |

**Notes:**
- **#3:** "run now" is a rankings refresh: it shares the **24 h manual-refresh limit** with #25 and returns **429** `{ next_allowed_at }` inside the window. Returns **400** without a `place_id`, without keywords, or when the country is not US/CA; **422** when over `RANK_MAX_CALLS_PER_RUN`. If a run is already active it returns that run with `existing: true` (no limit used). In development the run is capped at 2 keywords and a 3×3 grid.
- **#5:** returns **404** for an unknown run.

### Ranking: report pages (Phase 5)

All three read the latest `done` or `partial` run, or the run given by `runId`.

| # | Method | Path | Auth | Path params | Query params | Returns |
|---|---|---|---|---|---|---|
| 6 | GET | `/locations/:locationId/rank-tracker` | user, owner | `locationId` | `runId` (optional, 24-hex) | **Rank Tracker page:** per keyword, the summary (`avgRank`, `foundRate`, `top3Rate`, `change`, `changeLabel`) and the 5 tracker points; `overall`; `trend` (last 12 runs) |
| 7 | GET | `/locations/:locationId/grid` | user, owner | `locationId` | `runId` (optional), `keyword` (optional, 1–80 chars) | **Local Search Grid page:** grid size and spacing; per keyword, the summary and every point (`row`, `col`, `lat`, `lng`, rank display) |
| 8 | GET | `/locations/:locationId/map-ranking` | user, owner | `locationId` | `runId` (optional), `keyword` (optional), `resolveNames` (optional boolean; only when `STORE_PLACE_NAMES=false`) | **Local Map Ranking page:** per keyword, the top 20 at the location (`rank`, `place_id`, `name`, `is_self`, `target_key`) |

**404** means there is no completed run yet, an unknown `runId`, or a keyword not in the run. **409** means the `runId` isn't finished.

### GBP connection (Phase 6, updated in 7a)

| # | Method | Path | Auth | Query params | Body | Returns |
|---|---|---|---|---|---|---|
| 9 | GET | `/user/auth/google/gbp` | user | – | – | Google consent URL (**redirect flow**, the fallback). One-time `state`, valid 10 minutes. |
| 10 | GET | `/user/auth/google/gbp/callback` | none (Google calls it) | `code`, `state`, `error` (from Google) | – | `{ connected: true, google_email, google_sub }` |
| 11 | GET | `/user/auth/google/gbp/popup` | user | – | – | **Popup flow** config for Google Identity Services: `{ client_id, scope, state, ux_mode: "popup", select_account: true }` |
| 12 | POST | `/user/auth/google/gbp/code` | user | – | `{ code, state }` (from the popup callback) | `{ connected: true, google_email, google_sub }` |
| 13 | POST | `/user/auth/google/gbp/revoke` | user | – | `{ google_sub? }` | **Disconnect one Google account:** `{ revoked, bindings_removed, google_email }` |
| 14 | GET | `/gbp` | user | – | – | Every GBP profile from every connected Google account, grouped: `{ connections: [{ google_sub, google_email, label, status, error, accounts, locations, errors }] }` |
| 15 | POST | `/gbp/bind-with-user` | user | – | `{ location_id, gbpAccountId: "accounts/…", gbpLocationId: "locations/…", google_sub? }` | `{ binding, place_id: { location, gbp, status }, coordinates }` |
| 16 | POST | `/gbp/unbind` | user | – | `{ location_id }` | `{ unbound, jobs_cancelled: { gbp_sync, scheduled_posts }, tokens_deleted }` |

**Notes:**
- **#9:** scopes `openid email business.manage`, with `prompt=select_account consent`.
- **#10:** returns **400** for an unknown, expired or reused state, `error=access_denied`, or an unverifiable Google account. A user can connect **several Google accounts**: a new account is added as its own connection (`google_sub`), and the same account again updates it.
- **#11:** the `state` is valid 10 minutes and works once. Scopes are the same as #9. There is no `prompt` / `access_type` in the popup settings (GIS doesn't support them).
- **#12:** the code is exchanged with `redirect_uri=postmessage`. The state must be a popup state belonging to the caller. Errors as #10.
- **#13:** revokes that Google account at Google (best effort), then removes only its bindings, their scheduled jobs and its tokens. Other connected accounts are untouched. `google_sub` is required when several accounts are connected.
- **#14:** read from Business Information only (no Places calls). Each location includes `address`, `place_id`, `latlng`, `region_code` and `bound_location_id`. Returns **400** if not connected, **503** if GBP access is not approved (quota 0).
- **#15:** you must own the location, and it needs 1 GBP call. `google_sub` is required when several Google accounts are connected. `place_id` is set only if empty (never overwritten; a conflict is reported). lat/lng are filled only if both are empty. Returns **409** if that GBP location is bound to another of your locations.
- **#16:** cancels the location's sync jobs and pending scheduled posts. Deletes that Google account's tokens only if it was that account's last binding. Returns **404** if the location is not bound.

### Onboarding (Phase 7a)

| # | Method | Path | Auth | Path / query params | Body | Returns |
|---|---|---|---|---|---|---|
| 17 | GET | `/onboarding/state` | user | – | – | `{ gbp: { connected, connections: [{ google_sub, google_email, status }] }, locations: [{ location_id, name, onboarding: { step, started_at, completed_at } }] }` |
| 18 | GET | `/onboarding/gbp-profiles` | user | – | – | Same as #14 (grouped per Google account), plus `supported` (US/CA) per location |
| 19 | POST | `/onboarding/select-profile` | user | – | `{ gbpAccountId, gbpLocationId, location_id?, google_sub? }` | `{ location: { location_id, name, address, place_id, lat, lng }, created, center_needed, binding }` |
| 19b | PUT | `/locations/:locationId/center` | user, owner | `locationId` | `{ query }` (city or ZIP, 2–100 chars) | `{ lat, lng, center_source: "manual", center_label, api_calls, onboarding_step? }` |
| 20 | GET | `/locations/:locationId/competitor-suggestions` | user, owner | `locationId`; query `refresh` (optional boolean) | – | `{ generated_at, cached, keywords_used, api_calls, suggestions: [{ place_id, name, address, rating, userRatingCount, best_position, keywords, already_selected }] }` |
| 21 | GET | `/places/search` | user, owner (via `locationId`) | query `q` (required, 2–100 chars), `locationId` (required, 24-hex) | – | `{ results: [{ place_id, name, address }], api_calls }` |
| 22 | POST | `/onboarding/complete` | user | – | `{ location_id }` | `{ completed, completed_at, rank_run: { run_id, status, existing }, gbp_sync: { sync_id, status, existing } \| { error }, refresh: { anchor_day, next_refresh_at } }` |

**Notes:**
- **#17:** use it to resume. Each connection's `status` is `active` or `revoked` (reconnect). `step` goes `profile_selected` → (`center_needed` → `center_set`, service-area only) → `keywords_set` → `competitors_set` → `completed`.
- **#19:** links `location_id` if given, else your location with the same place ID, else creates a new Location from the profile. Then it binds (1 GBP call). `google_sub` is required with several Google accounts. `center_needed: true` means the profile has no coordinates (service-area business), so #19b comes next. Returns **400** for a non-US/CA profile or one the account can't access, **404** if `location_id` is not yours.
- **#19b:** resolves a city or ZIP once: 1 Places Text Search (IDs-only, free SKU) + 1 Place Details (`location` only), counted against the daily Places limit. It saves the location's lat/lng with `center_source: "manual"`. Rank runs and suggestions then use it. Returns **404** if nothing is found, **429** at the daily limit, **502** if Google failed.
- **#20:** top 10 competitors across your keywords. 1 Places Enterprise search per keyword (2 in development). Cached 24 hours per keyword set. Returns **400** with no keywords or no coordinates, **429** at the daily limit, **502** if every search failed.
- **#21:** 1 Places Pro call, up to 10 results near the location, excluding the location itself. Returns **404** if `locationId` is not yours, **429** at the daily limit.
- **#22:** needs a bound profile, a center (lat/lng) and at least 1 keyword. It queues the first rank run **and the first GBP sync**, and sets the monthly refresh (the setup day of the month, clamped to 28, at about 03:00 local). Calling it again returns the same state. Returns **422** if the run is over the call cap.

**Onboarding keywords and competitors** use the ranking endpoint #2 (`PUT /locations/:locationId/tracking`). Sending `keywords` moves the step to `keywords_set` (except while it is `center_needed`); sending `competitors` (even `[]`) moves it to `competitors_set`.

**Daily Places limit:** #19b, #20 and #21 share `PLACES_USER_DAILY_LIMIT` (default 50) calls per user per UTC day.

---

### Refresh and GBP sync (Phase 7b)

Every location refreshes **automatically once a month** (rankings, then the GBP sync if connected). Users can also refresh on demand, at most once per 24 h per type.

| # | Method | Path | Auth | Params / body | Returns |
|---|---|---|---|---|---|
| 25 | POST | `/locations/:locationId/refresh` | user, owner | body `{ types?: ["rankings","gbp"] }` (default: rankings, plus gbp when connected) | **202** `{ rankings: { run_id, status, existing, estimate, next_allowed_at } \| { skipped: 'rate_limited', next_allowed_at }, gbp: { sync_id, status, existing, estimated_calls, next_allowed_at } \| { skipped: 'gbp_not_connected' \| 'rate_limited', next_allowed_at } }` |
| 26 | GET | `/locations/:locationId/refresh` | user, owner | – | Button state: `{ frequency, gbp_connected, next_refresh_at, last_auto_refresh_at, rankings: { next_allowed_at, active_run }, gbp: { next_allowed_at, active_sync, last_synced_at } \| null, report: { pending, scheduled_for, last_generated_at } }` |
| 27 | GET | `/locations/:locationId/gbp/sync` | user, owner | query `syncId?` (24-hex) | `{ gbp_connected, sync: { sync_id, status, trigger, backfill, run_at, started_at, finished_at, duration_ms, types, api_calls, failure_reason } \| null, last_synced_at }` |

**Notes:**
- **#25:** **429** only when every requested type is rate-limited; the body still has `next_allowed_at` per type, so the button can say when it's available again. An in-progress run or sync is returned (`existing: true`) without using the limit. **400** for an unknown type; **422** if the rank run is over the call cap.
- **#25 (7c):** a refresh that queues something also marks competitor Place Details for refetch in the next GBP report (facts older than 24 h).
- **#26:** `next_allowed_at` is `null` when the type can be refreshed now. `report` (7c): `pending` while a GBP report generation is scheduled.
- **#27:** `types` has one entry per data type (`performance`, `keywords`, `profile`, `verification`, `reviews`, `media`, `posts`), each `{ status: pending | ok | error | not_available | skipped, message, rows, range }`. Reviews, media and posts are `not_available` (`v4_access_pending`) until Google approves v4 access. Sync `status`: `queued`, `running`, `done`, `partial` (some types failed) or `failed`.

### GBP report (Phase 7c)

Generated in the `gbp-report` job about 2 minutes after a rank run or GBP sync finishes (one report when both finish together), after a change of tracked competitors, and after an unbind. GET only reads it.

| # | Method | Path | Auth | Params | Returns |
|---|---|---|---|---|---|
| 28 | GET | `/locations/:locationId/gbp/report` | user, owner | query `range` (`28d` default, `90d`, `12m`) | `{ location_id, generated_at, trigger, gbp_connected, v4_enabled, range, gbp_score, performance, keywords, reviews, media, posts, pending_google_edits, verification, competitors: { rows, insights, warning }, sync, score_history, api_calls, inputs, generation }` |

**Notes:**
- **#28:** **404** before the first report; **400** for another `range`. A section that can't be shown is `{ available: false, reason }`: `gbp_not_connected` (every private section of a location added via Places search; the competitor comparison still works), `v4_access_pending` (reviews, media, posts; the GBP Score then excludes those pillars with `partial: true`), `not_synced_yet`, `no_place_id`. Shapes and examples: [API.md](API.md#gbp-report-phase-7c).

## Removed endpoints

Removed in the legacy cleanup (Phase 9a): the old ranking routes (`/rank-tracker`, `/local-search-grid`, `/local-map-ranking`), `/gbp-audit`, `/reputation-manager`, the white-label report links and the Search Console connect. See [LEGACY_FEATURES.md](LEGACY_FEATURES.md).
