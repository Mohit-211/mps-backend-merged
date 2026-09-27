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
- `admin` (Phase 10): header `Authorization: Bearer <admin session token>` from `POST /admin/auth/login` (HS256, `ADMIN_JWT_SECRET`, 12 h). `admin (\`<permission>\`)` also needs that permission: `admins.manage` (super admin), `platform.read` / `platform.write` (super admin, admin), `content.manage` (super admin, admin, editor), `system.read` (super admin), `citations.view` and `citations.manage` (Phase 16; super admin, admin, editor). No token or an invalid one → **401**; a missing permission → **403** `{ reason: "forbidden", permission }`.
- `user`: header `Authorization: Bearer <access token>`. A missing or invalid token gives **401**.
- `owner` (location routes, Phase 8): the caller must be an active member of the location's **organization** (a `client_user` only for its clients' locations). Otherwise **404**; a malformed id gives **400**. Writes (anything but GET) need the role owner or member: a `client_user` gets **403** `{ reason: "read_only" }`.
- `org`: the route acts in the current organization: the `X-Organization-Id` header (one of the caller's organizations, else **403** `not_a_member`), otherwise the user's default organization. A user without an organization gets **403** `{ reason: "no_organization" }`.
- `none`: no MyPageSEO login (the Google OAuth callback, and the Phase 8 `/auth` endpoints).

**Roles (Phase 8):** `owner` (everything), `member` (everything except editing the organization), `client_user` (agency; read-only, only its assigned clients and their locations).

**Response envelope:** every response is `{ "success": bool, "status": number, "message": string, "data": … }`.

**Common errors:**

| Status | Meaning |
|---|---|
| 400 | Invalid input, or a missing precondition |
| 401 | No or invalid login |
| 404 | Not found, or not yours |
| 409 | Conflict |
| 422 | Run over the call cap |
| 403 | Phase 8: no access with a `reason` (`read_only`, `agency_only`, `owner_only`, `location_limit_reached`, `keyword_limit_reached`, `email_not_verified`, …) |
| 429 | Daily search limit, or an auth rate limit (`rate_limited`, `retry_after_seconds`) |
| 502 | Google failed |
| 503 | Not configured / GBP access not approved |

---

## Summary (Phase 16, in progress)

**207 endpoints:** 192 live, 14 deprecated, 1 dev-only.
- **By origin:** 84 rebuilt or new, 123 legacy.
- **By auth:** 95 user, 63 platform admin (each with a permission), 47 none, 2 refresh token.

This block is recounted with every commit that changes the catalogue.

**Phase 16 changes:**
- **Done:** the 13 legacy `/citation/*` routes retired.
- **Done:** the directory and category admin endpoints (#82–#93).
- **To come:** the per-location lists and work queue (`/admin/citations/locations|entries|queue`) and `GET /locations/:locationId/citations[/changes]`. See [plans/phase-16-citations.md](plans/phase-16-citations.md), §4.

**Phase 9b** removes the 14 deprecated routes once the frontend has moved.

## Catalogue: all current endpoints

Paths are full paths. Auth: `none`, `user` (user access token), `user + org` (acts in the current organization), `user + owner` (member of the location's organization, otherwise 404), `refresh token`, `admin`. The security findings for legacy routes (S1–S30) are in [AUDIT.md](AUDIT.md) and the [ROUTES.md](ROUTES.md) snapshot.

### Admin

| Method | Path | Auth | Purpose | Phase | Status |
|---|---|---|---|---|---|
| POST | `/api/v1/admin/auth/register` | admin (`admins.manage`) | Create Admin User (crypto temporary password, emailed) | legacy, changed 10 | live |
| POST | `/api/v1/admin/auth/login` | none (rate-limited) | Login Admin User: an admin session token (12 h, `ADMIN_JWT_SECRET`) | legacy, changed 10 | live |
| POST | `/api/v1/admin/auth/sendOTP` | none (rate-limited) | Send OTP (10 min, 5 attempts; same answer for unknown emails) | legacy, changed 10 | live |
| POST | `/api/v1/admin/auth/verifyOTP` | none (rate-limited) | Verify OTP; with `otp_type=FORGOT_PASSWORD` returns a single-use 15-min reset token | legacy, changed 10 | live |
| POST | `/api/v1/admin/auth/resetPassword` | admin | Change the signed-in admin's password (other sessions revoked; returns a new token) | legacy, changed 10 | live |
| POST | `/api/v1/admin/auth/forgotPassword` | none (reset token) | Set a new password with the reset token (sessions revoked) | legacy, changed 10 | live |
| GET | `/api/v1/admin/auth/getAllAdmins` | admin (`admins.manage`) | Get All Admins (no password/OTP/token fields) | legacy, changed 10 | live |
| GET | `/api/v1/admin/auth/getAdminById/:id` | admin (`admins.manage`) | Find Admin By Id | legacy, changed 10 | live |
| GET | `/api/v1/admin/auth/getProfile` | admin | Get Profile | legacy | live |
| PUT | `/api/v1/admin/auth/updateAdmin` | admin (`admins.manage`) | Update Admin (not your own role; a role or email change revokes that admin's tokens) | legacy, changed 10 | live |
| DELETE | `/api/v1/admin/auth/deleteAdmin` | admin (`admins.manage`) | Delete Admin (not yourself, not the last super admin) | legacy, changed 10 | live |
| GET | `/api/v1/admin/operations/getAllAgencies` | admin (`platform.read`) | Get All Agencies | legacy, changed 10 | live |
| GET | `/api/v1/admin/operations/getAgencyById/:id` | admin (`platform.read`) | Get Agency By Id | legacy, changed 10 | live |
| PUT | `/api/v1/admin/operations/updateAgencyStatus` | admin (`platform.write`) | Update Agency Status | legacy, changed 10 | live |
| GET | `/api/v1/admin/operations/getAllBusinesses` | admin (`platform.read`) | Get All Businesses | legacy, changed 10 | live |
| GET | `/api/v1/admin/operations/getBusinessesById/:id` | admin (`platform.read`) | Get Businesses By Id | legacy, changed 10 | live |
| GET | `/api/v1/admin/operations/getAllClients` | admin (`platform.read`) | Get All Clients | legacy, changed 10 | live |

### Auth (rebuilt app)

| Method | Path | Auth | Purpose | Phase | Status |
|---|---|---|---|---|---|
| POST | `/api/v1/auth/signup` | none | Signup as Business or Agency: user + organization + owner membership; emails a verification link (`FRONTEND_URL/verify-email?token=…`, 24 h; unverified accounts are deleted after 24 h) | 8, changed 8.1 | live |
| POST | `/api/v1/auth/verify-email` | none (rate-limited) | Verify the email with the link token; the first time returns the session, then `already_verified` (400 `link_expired` / `link_invalid`) | 8, changed 8.1 | live |
| POST | `/api/v1/auth/resend-verification` | none (rate-limited) | New verification link; older links stop working (same answer whether or not the account exists). Replaces `/auth/verify-email/resend` | 8.1 | live |
| POST | `/api/v1/auth/login` | none | Login; returns tokens, organizations and onboarding (403 `email_not_verified`: no tokens until the email is verified) | 8 | live |
| POST | `/api/v1/auth/forgot-password` | none | Password reset code by email (same answer whether or not the account exists) | 8 | live |
| POST | `/api/v1/auth/reset-password` | none | New password with the reset code; signs out every session | 8 | live |
| POST | `/api/v1/auth/invitations/inspect` | none | What a team invitation is for (`{ token }` in the body): organization, email, role, account exists | 11 | live |
| POST | `/api/v1/auth/invitations/accept` | none | Accept a team invitation: a new account is created and logged in; an existing account gets the membership (`login_required`) | 11 | live |

### User auth & account

| Method | Path | Auth | Purpose | Phase | Status |
|---|---|---|---|---|---|
| POST | `/api/v1/user/auth/otp` | none | Send a password-reset OTP (`FORGOT_PASSWORD` only since 8.1; `EMAIL_VERIFICATION` → 400 `verification_by_link`). Replaced by `/auth/forgot-password` | legacy | deprecated |
| POST | `/api/v1/user/auth/verify-otp` | none | Verify a password-reset OTP (`FORGOT_PASSWORD` only since 8.1). Replaced by `/auth/reset-password` | legacy | deprecated |
| POST | `/api/v1/user/auth/login` | none | Login (403 `email_not_verified` since 8.1). Replaced by `/auth/login` | legacy | deprecated |
| POST | `/api/v1/user/auth/reset-password` | user | Reset Password | legacy | live |
| POST | `/api/v1/user/auth/forgot-password` | none | Forgot Password. Replaced by `/auth/forgot-password` + `/auth/reset-password` | legacy | deprecated |
| POST | `/api/v1/user/auth/refresh-auth` | refresh token | Refresh Auth | legacy | live |
| POST | `/api/v1/user/auth/logout` | refresh token | Logout | legacy | live |
| GET | `/api/v1/user/auth/deactivate` | user | Deactivate Account | legacy | live |
| POST | `/api/v1/user/auth/employee/add` | user | Add Employee (Phase 8: also a `member` of the owner's organizations) | legacy | live |
| DELETE | `/api/v1/user/auth/employee/remove` | user | Delete Employee (Phase 8: memberships removed) | legacy | live |
| GET | `/api/v1/user/auth/employee/all` | user | Get All Employee By Owner | legacy | live |
| GET | `/api/v1/user/auth/employee/details/:employee_id` | user | Employee Details | legacy | live |
| GET | `/api/v1/user/profile` | user | Get Profile | legacy | live |
| POST | `/api/v1/user/notifications` | user | Notification Toogle | legacy | live |
| PUT | `/api/v1/user/profile` | user | Update Profile | legacy | live |
| POST | `/api/v1/user/clients` | user | Create Client. Replaced by `/clients` | legacy | deprecated |
| GET | `/api/v1/user/clients` | user | Get All Client. Replaced by `/clients` | legacy | deprecated |
| GET | `/api/v1/user/clients/:client_id` | user | Get Client Details. Replaced by `/clients/:clientId` | legacy | deprecated |
| PUT | `/api/v1/user/clients` | user | Update Client. Replaced by `PATCH /clients/:clientId` | legacy | deprecated |
| DELETE | `/api/v1/user/clients/:client_id` | user | Delete Client. Replaced by `DELETE /clients/:clientId` | legacy | deprecated |

### Locations

| Method | Path | Auth | Purpose | Phase | Status |
|---|---|---|---|---|---|
| GET | `/api/v1/locations` | user + org | The locations table: search, filter (client, status), sort, pagination; status, rank, GBP score, reviews per row | legacy, rebuilt 8 | live |
| POST | `/api/v1/locations` | user + org (owner/member) | Add a location from a Places search result `{ place_id, client_id? }` (1 Place Details call; plan limit; one place per organization). No manual entry | legacy, rebuilt 8 | live |
| GET | `/api/v1/locations/:locationId` | user + owner | Location header (was unauthenticated) | legacy, rebuilt 8 | live |
| GET | `/api/v1/locations/:locationId/overview` | user + owner | Header + the latest summary of every module (`available: false` sections when there's no data yet) | 8 | live |
| PATCH | `/api/v1/locations/:locationId` | user + owner (write) | Edit `name`, `timezone`, `client_id` | 8 | live |
| DELETE | `/api/v1/locations/:locationId` | user + owner (write) | Soft delete: jobs cancelled, GBP unbound, history kept, plan slot freed | legacy, rebuilt 8 | live |

### Organization

| Method | Path | Auth | Purpose | Phase | Status |
|---|---|---|---|---|---|
| GET | `/api/v1/organization` | user + org | The current organization, the caller's role and every organization they belong to | 8 | live |
| PATCH | `/api/v1/organization` | user + org (owner) | Edit `name`, `country` | 8 | live |
| GET | `/api/v1/organization/usage` | user + org | Plan and usage: locations used/limit, keywords used/limit, clients (agency); `api_usage` (Google API calls this and last month, list-price estimate; 12.5) | 8, changed 12.5 | live |
| GET | `/api/v1/organization/members` | user + org (owner/member) | Team members with roles, `invited_by`, `joined_at` | 8 | live |
| PATCH | `/api/v1/organization/members/:userId` | user + org (owner) | Change a member's role (`member` / `client_user` + `client_ids`); the owner is protected | 11 | live |
| DELETE | `/api/v1/organization/members/:userId` | user + org (owner) | Remove a member (the owner is protected) | 11 | live |
| POST | `/api/v1/organization/invitations` | user + org (owner) | Invite by email (`member`, or `client_user` with clients); 7-day single-use link | 11 | live |
| GET | `/api/v1/organization/invitations` | user + org (owner) | Invitations with status (`pending`, `accepted`, `revoked`, `expired`) | 11 | live |
| DELETE | `/api/v1/organization/invitations/:invitationId` | user + org (owner) | Revoke a pending invitation | 11 | live |
| GET | `/api/v1/organization/branding` | user + org | Report branding with defaults filled (`white_label` false for a business) | 12 | live |
| PUT | `/api/v1/organization/branding` | user + org (owner, agency) | White-label: agency name, colours, footer/contact text, hide MyPageSEO, email sender name and reply-to | 12 | live |
| GET | `/api/v1/organization/branding/logo` | user + org | The logo image (private storage) | 12 | live |
| PUT | `/api/v1/organization/branding/logo` | user + org (owner, agency) | Upload the logo `{ data }` (base64 PNG/JPEG, ≤ 512 KB) | 12 | live |
| DELETE | `/api/v1/organization/branding/logo` | user + org (owner, agency) | Remove the logo | 12 | live |

### Dashboard

| Method | Path | Auth | Purpose | Phase | Status |
|---|---|---|---|---|---|
| GET | `/api/v1/dashboard` | user + org | Business or Agency dashboard from stored summaries (visibility, GBP Score, reviews, movement, key competitor, actions; agency: portfolio, statuses, declines, GBP issues, table) | 11 | live |

### Reports center

| Method | Path | Auth | Purpose | Phase | Status |
|---|---|---|---|---|---|
| POST | `/api/v1/reports` | user + org (owner/member) | Create a report (Rank Tracker, GBP Audit, Competitor Analysis, Full); generated in the `report-generate` job | 12 | live |
| GET | `/api/v1/reports` | user + org | Report library: filters, pagination (a client_user sees its clients' reports) | 12 | live |
| GET | `/api/v1/reports/:reportId` | user + org | One report: status, frozen snapshot and the document blocks | 12 | live |
| GET | `/api/v1/reports/:reportId/pdf` | user + org | Download the PDF | 12 | live |
| DELETE | `/api/v1/reports/:reportId` | user + org (owner/member) | Archive (hidden from the library; share links stop working) | 12 | live |
| POST | `/api/v1/reports/:reportId/email` | user + org (owner/member) | Email the report (attachment, or a 30-day link above 10 MB); 20 / hour per organization | 12 | live |
| POST | `/api/v1/reports/:reportId/share` | user + org (owner/member) | Create a public share link (token shown once, optional expiry) | 12 | live |
| GET | `/api/v1/reports/:reportId/shares` | user + org (owner/member) | The report's share links (no tokens) with views | 12 | live |
| DELETE | `/api/v1/reports/:reportId/shares/:shareId` | user + org (owner/member) | Revoke a share link | 12 | live |
| POST | `/api/v1/report-schedules` | user + org (owner/member) | Monthly scheduled report for a location or a client (agency) | 12 | live |
| GET | `/api/v1/report-schedules` | user + org | Schedules with `next_expected`, `last_sent_at`, `last_error` | 12 | live |
| GET | `/api/v1/report-schedules/:scheduleId` | user + org | One schedule | 12 | live |
| PATCH | `/api/v1/report-schedules/:scheduleId` | user + org (owner/member) | Edit recipients, type, sections, range, or pause/resume | 12 | live |
| DELETE | `/api/v1/report-schedules/:scheduleId` | user + org (owner/member) | Delete a schedule | 12 | live |
| GET | `/r/:token` | none (share token) | Public branded HTML view of a shared report; noindex, rate-limited, no internal ids | 12 | live |
| GET | `/r/:token/pdf` | none (share token) | Public PDF download of a shared report | 12 | live |

### Clients (agency)

| Method | Path | Auth | Purpose | Phase | Status |
|---|---|---|---|---|---|
| GET | `/api/v1/clients` | user + org (agency) | Clients with location count and averages; search, status, pagination (a client_user sees its own) | 8 | live |
| POST | `/api/v1/clients` | user + org (agency, owner/member) | Create a client | 8 | live |
| GET | `/api/v1/clients/:clientId` | user + org (agency) | Client detail: client, assigned locations (list rows), summary | 8 | live |
| PATCH | `/api/v1/clients/:clientId` | user + org (agency, owner/member) | Edit a client | 8 | live |
| DELETE | `/api/v1/clients/:clientId` | user + org (agency, owner/member) | Soft delete; its locations stay, unassigned | 8 | live |
| POST | `/api/v1/clients/:clientId/locations` | user + org (agency, owner/member) | Assign a location `{ location_id }` | 8 | live |
| DELETE | `/api/v1/clients/:clientId/locations/:locationId` | user + org (agency, owner/member) | Unassign a location | 8 | live |

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
| GET | `/api/v1/locations/:locationId/map-ranking` | user + owner | Local Map Ranking page (`?keyword=&runId=&resolveNames=&point=C\|N\|S\|E\|W\|all`; 12.5: lists at the 5 tracker points) | 5, changed 12.5 | live |

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
| GET | `/api/v1/onboarding/state` | user + org | Organization onboarding steps (Business / Agency, resumable), empty states, connection, onboarding locations | 7a, rebuilt 8 | live |
| GET | `/api/v1/onboarding/gbp-profiles` | user + org | Every accessible profile, `supported` flag | 7a | live |
| POST | `/api/v1/onboarding/select-profile` | user + org | Create (plan limit) or link a location of the organization from a profile and bind; `client_id?` (agency) | 7a, changed 8 | live |
| POST | `/api/v1/onboarding/complete` | user + org (owner/member) | First rank run (+ GBP sync when bound) and the monthly refresh; no GBP needed since Phase 8 | 7a | live |
| POST | `/api/v1/onboarding/skip` | user + org (owner/member) | Skip an organization step (`google`, `reporting_brand`) | 8 | live |
| GET | `/api/v1/locations/:locationId/competitor-suggestions` | user + owner | Top 10 competitors across keywords (Places Enterprise, 24 h cache, daily cap) | 7a | live |
| GET | `/api/v1/places/search` | user + org (owner/member) | Places search (Pro, 10 results, daily cap): a competitor search with `locationId`, or an add-location search without it (Phase 8, `country`) | 7a, changed 8 | live |
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
| POST | `/api/v1/white-label-profiles` | user | Create New Profile. Replaced by organization branding (#76, #78); data carried over by `npm run migrate:branding` | legacy | deprecated |
| PATCH | `/api/v1/white-label-profiles` | user | Update White Label Profile. Replaced by #76 | legacy | deprecated |
| GET | `/api/v1/white-label-profiles` | user | Get White Label Profile. Replaced by #75 | legacy | deprecated |
| GET | `/api/v1/white-label-profiles/:whiteLevelProfileId` | user (owner) | Get White Label Profile Detail. Replaced by #75 | legacy, changed 10 | deprecated |
| DELETE | `/api/v1/white-label-profiles/:whiteLevelProfileId` | user | Delete White Level Profile. Replaced by #76 / #79 | legacy | deprecated |

### Citations (Phase 16)

Manual, admin-managed citation tracking (no external citation APIs). Admin routes need a platform-admin token with `citations.view` (read) or `citations.manage` (write). Examples: [API.md](API.md#citations-phase-16).

| Method | Path | Auth | Purpose | Phase | Status |
|---|---|---|---|---|---|
| GET | `/api/v1/admin/citations/directories` | admin (`citations.view`) | Directory master list (search, type, country, category, active; paginated) | 16 | live |
| POST | `/api/v1/admin/citations/directories` | admin (`citations.manage`) | Create a directory | 16 | live |
| GET | `/api/v1/admin/citations/directories/export` | admin (`citations.view`) | Export every directory as CSV | 16 | live |
| POST | `/api/v1/admin/citations/directories/import` | admin (`citations.manage`) | Import directories from CSV (`text/csv`; `?dry_run=true`; all-or-nothing; upsert by domain) | 16 | live |
| GET | `/api/v1/admin/citations/directories/:directoryId` | admin (`citations.view`) | Directory detail + how many locations use it | 16 | live |
| PATCH | `/api/v1/admin/citations/directories/:directoryId` | admin (`citations.manage`) | Update a directory | 16 | live |
| DELETE | `/api/v1/admin/citations/directories/:directoryId` | admin (`citations.manage`) | Deactivate a directory (entries keep it; no longer suggested) | 16 | live |
| GET | `/api/v1/admin/citations/categories` | admin (`citations.view`) | Directory categories (industry groups) with their GBP business categories and directory counts | 16 | live |
| POST | `/api/v1/admin/citations/categories` | admin (`citations.manage`) | Create a directory category | 16 | live |
| PATCH | `/api/v1/admin/citations/categories/:categoryId` | admin (`citations.manage`) | Update a directory category | 16 | live |
| DELETE | `/api/v1/admin/citations/categories/:categoryId` | admin (`citations.manage`) | Delete a directory category (409 `in_use` while directories use it) | 16 | live |
| GET | `/api/v1/admin/citations/business-categories` | admin (`citations.view`) | Search the GBP business categories (`?q=`, 20 results) for mapping | 16 | live |

### Payments & subscriptions

| Method | Path | Auth | Purpose | Phase | Status |
|---|---|---|---|---|---|
| POST | `/api/v1/subscription` | admin (`platform.write`) | Create Plan | legacy, changed 10 | live |
| GET | `/api/v1/subscription` | admin (`platform.read`) | Get All Plans | legacy, changed 10 | live |
| GET | `/api/v1/subscription/plans/country/:country` | none | Get Plans By Country | legacy | live |
| PUT | `/api/v1/subscription/:plan_id` | admin (`platform.write`) | Update Plan | legacy, changed 10 | live |
| DELETE | `/api/v1/subscription/:plan_id` | admin (`platform.write`) | Delete Plan | legacy, changed 10 | live |
| POST | `/api/v1/subscription/create-subscription` | none (guest checkout, rate-limited) | Create Subscription | legacy | live |
| POST | `/api/v1/subscription/paypal/webhook` | none (PayPal signature, verified with PayPal) | Paypal Webhook. Phase 10: refused (400 `invalid_signature`) unless PayPal confirms it (`PAYPAL_WEBHOOK_ID`) | legacy, changed 10 | live |
| GET | `/api/v1/subscription/payment-status` | none (guest checkout, rate-limited) | Get Payment Status | legacy | live |
| POST | `/api/v1/subscription/coupon/generate` | admin (`platform.write`) | Generate Coupon | legacy, changed 10 | live |
| POST | `/api/v1/subscription/coupon/validate` | none | Validate Coupon | legacy | live |
| GET | `/api/v1/subscription/coupons` | admin (`platform.read`) | Get All Coupons | legacy, changed 10 | live |
| GET | `/api/v1/subscription/payments/all` | admin (`platform.read`) | Get All Payment History | legacy, changed 10 | live |
| POST | `/api/v1/subscription/send-subscription-welcome-mail` | admin (`platform.write`) | Send Subscription Welcome Mail Controller | legacy, changed 10 | live |
| POST | `/api/v1/payments/process-payment` | user | Make Square Payment | legacy | live |
| GET | `/api/v1/payments/plans/list` | none | Get Plans | legacy | live |
| GET | `/api/v1/payments/getAllPayments` | admin (`platform.read`) | Get All Payments | legacy, changed 10 | live |

### Reference data

| Method | Path | Auth | Purpose | Phase | Status |
|---|---|---|---|---|---|
| GET | `/api/v1/countries` | none | Get All Country | legacy | live |
| GET | `/api/v1/countries/states/:countryId` | none | Get All State By Country Id | legacy | live |
| GET | `/api/v1/countries/cities/:stateId` | none | Get All City By State Id | legacy | live |
| POST | `/api/v1/roles` | admin (`admins.manage`) | Create Role | legacy, changed 10 | live |
| GET | `/api/v1/roles/:roleId` | admin (`admins.manage`) | Find Role By Id | legacy, changed 10 | live |
| GET | `/api/v1/roles` | admin (`admins.manage`) | Get All Roles | legacy, changed 10 | live |
| PUT | `/api/v1/roles/:roleId` | admin (`admins.manage`) | Update Role | legacy, changed 10 | live |
| DELETE | `/api/v1/roles/:roleId` | admin (`admins.manage`) | Delete Role | legacy, changed 10 | live |
| GET | `/api/v1/languages` | none | Get All Language | legacy | live |
| GET | `/api/v1/timezones` | none | Get All Timezone | legacy | live |
| POST | `/api/v1/business-categories` | admin (`content.manage`) | Create Business Category | legacy, changed 10 | live |
| GET | `/api/v1/business-categories` | none | Get All Business Category | legacy | live |
| PUT | `/api/v1/business-categories/:businessCategoryId` | admin (`content.manage`) | Update Business Category | legacy, changed 10 | live |

### Content & support

| Method | Path | Auth | Purpose | Phase | Status |
|---|---|---|---|---|---|
| GET | `/api/v1/faqs` | none | Get All Faq | legacy | live |
| POST | `/api/v1/faqs` | admin (`content.manage`) | Create Faq | legacy, changed 10 | live |
| PUT | `/api/v1/faqs/:faqId` | admin (`content.manage`) | Update Faq | legacy, changed 10 | live |
| DELETE | `/api/v1/faqs/:faqId` | admin (`content.manage`) | Delete Faq | legacy, changed 10 | live |
| POST | `/api/v1/supports` | user | Create Support | legacy | live |
| GET | `/api/v1/supports` | user | Get All Support | legacy | live |
| DELETE | `/api/v1/supports/:supportId` | user | Delete Support | legacy | live |
| GET | `/api/v1/supports/getAllSupportByAdmin` | admin (`platform.read`) | Get All Support Tickets By Admin | legacy, changed 10 | live |
| PUT | `/api/v1/supports/updateSupportTicketStatus` | admin (`platform.write`) | Update Support Ticket Status | legacy, changed 10 | live |
| GET | `/api/v1/supports/getSupportTicketStatusCounts` | admin (`platform.read`) | Get Support Ticket Status Counts | legacy, changed 10 | live |
| POST | `/api/v1/contact-us` | none | Create Contact Us | legacy | live |
| GET | `/api/v1/contact-us/get` | admin (`platform.read`) | Get All Contact Us | legacy, changed 10 | live |
| GET | `/api/v1/contact-us/:contactId` | admin (`platform.read`) | Get Contact Us By Id | legacy, changed 10 | live |
| PUT | `/api/v1/contact-us/:contactId/status` | admin (`platform.write`) | Update Contact Us Status | legacy, changed 10 | live |
| DELETE | `/api/v1/contact-us/:contactId` | admin (`platform.write`) | Delete Contact Us | legacy, changed 10 | live |
| POST | `/api/v1/blog` | admin (`content.manage`) | Create Blog | legacy, changed 10 | live |
| GET | `/api/v1/blog/get` | none | Get All Blogs | legacy | live |
| GET | `/api/v1/blog/slug/:slug` | none | Get Blog By Slug | legacy | live |
| GET | `/api/v1/blog/:blogId` | none | Get Blog By Id | legacy | live |
| PUT | `/api/v1/blog/:blogId` | admin (`content.manage`) | Update Blog | legacy, changed 10 | live |
| DELETE | `/api/v1/blog/:blogId` | admin (`content.manage`) | Delete Blog | legacy, changed 10 | live |
| POST | `/api/v1/blog-category` | admin (`content.manage`) | Create Blog Category | legacy, changed 10 | live |
| GET | `/api/v1/blog-category/get` | none | Get All Blog Categories | legacy | live |
| GET | `/api/v1/blog-category/:categoryId` | none | Get Blog Category By Id | legacy | live |
| PUT | `/api/v1/blog-category/:categoryId` | admin (`content.manage`) | Update Blog Category | legacy, changed 10 | live |
| DELETE | `/api/v1/blog-category/:categoryId` | admin (`content.manage`) | Delete Blog Category | legacy, changed 10 | live |

### System & infrastructure

| Method | Path | Auth | Purpose | Phase | Status |
|---|---|---|---|---|---|
| GET | `/api/v1/system/info` | admin (`system.read`) | Get System Info | legacy, changed 10 | live |
| GET | `/api/v1/system/time` | admin (`system.read`) | Get Server Time | legacy, changed 10 | live |
| GET | `/api/v1/system/usage` | admin (`system.read`) | Get Resource Usage | legacy, changed 10 | live |
| GET | `/api/v1/system/process` | admin (`system.read`) | Get Process Info | legacy, changed 10 | live |
| GET | `/api/v1/logs` | admin (`system.read`) | Read today's log file | legacy, changed 10 | live |
| DELETE | `/api/v1/logs` | admin (`system.read`) | Delete all log files | legacy, changed 10 | live |
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
| 5 | GET | `/locations/:locationId/rank-runs/:runId` | user, owner | `locationId`, `runId` | – | – | Run status, timings, `api_calls`, estimate (12.5: + `samples`, `mapPoints`), `config` (`samples`, `sample_spacing_sec`, `map_points`), `expected_duration_ms`, `errors_count`, `failure_reason` |

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
| 8 | GET | `/locations/:locationId/map-ranking` | user, owner | `locationId` | `runId` (optional), `keyword` (optional), `resolveNames` (optional boolean; only when `STORE_PLACE_NAMES=false`), `point` (12.5: `C` default, `N`, `S`, `E`, `W`, `all`) | **Local Map Ranking page:** per keyword and point, the top 20 (`rank`, `place_id`, `name`, `is_self`, `target_key`), plus `point`, `points_available`, `attribution`. **404** for a point the run doesn't have (runs before 12.5: center only) |

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
| 20 | GET | `/locations/:locationId/competitor-suggestions` | user, owner | `locationId`; query `refresh` (optional boolean) | – | `{ generated_at, cached, keywords_used, api_calls, suggestions: [{ place_id, name, address, rating, userRatingCount, best_position, keywords, already_selected }], attribution }` |
| 21 | GET | `/places/search` | user, owner (via `locationId`) | query `q` (required, 2–100 chars), `locationId` (required, 24-hex) | – | `{ results: [{ place_id, name, address }], api_calls, attribution }` |
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
| 28 | GET | `/locations/:locationId/gbp/report` | user, owner | query `range` (`28d` default, `90d`, `12m`) | `{ location_id, generated_at, trigger, gbp_connected, v4_enabled, range, gbp_score, performance, keywords, reviews, media, posts, pending_google_edits, verification, competitors: { rows (12.5: + `photo_count`, `photos_capped`, `reviews`, `recent_review_at`), insights, warning }, sync, score_history, api_calls, inputs, generation, attribution }` |

**Notes:**
- **#28:** **404** before the first report; **400** for another `range`. A section that can't be shown is `{ available: false, reason }`: `gbp_not_connected` (every private section of a location added via Places search; the competitor comparison still works), `v4_access_pending` (reviews, media, posts; the GBP Score then excludes those pillars with `partial: true`), `not_synced_yet`, `no_place_id`. Shapes and examples: [API.md](API.md#gbp-report-phase-7c).

### Auth, organization, locations and clients (Phase 8)

Every location, client and report belongs to an organization; roles `owner`, `member`, `client_user` (see Conventions). Shapes and examples: [API.md](API.md#auth-organizations-locations-and-clients-phase-8).

| # | Method | Path | Auth | Params / body | Returns |
|---|---|---|---|---|---|
| 29 | POST | `/auth/signup` | none | `{ account_type: business\|agency, name, email, password, organization_name, country: US\|CA, accept_terms: true }` | **201** `{ user_id, organization_id, email_verification, verify_before }` |
| 30 | POST | `/auth/verify-email` | none | `{ token }` | First time: `{ verified, already_verified: false, tokens, user, organizations, current_organization_id, onboarding }`; then `{ verified: true, already_verified: true }`; **400** `link_expired` / `link_invalid` |
| 31 | POST | `/auth/resend-verification` | none | `{ email }` | `{ email_verification: 'sent_if_pending' }` |
| 32 | POST | `/auth/login` | none | `{ email, password }` | Session; **403** `email_not_verified` |
| 33 | POST | `/auth/forgot-password` | none | `{ email }` | `{ reset: 'sent_if_account_exists' }` |
| 34 | POST | `/auth/reset-password` | none | `{ email, code, password }` | `{ reset: true }` (sessions revoked) |
| 35 | GET | `/organization` | user + org | – | `{ organization, role, memberships }` |
| 36 | PATCH | `/organization` | user + org (owner) | `{ name?, country? }` | As #35 |
| 37 | GET | `/organization/usage` | user + org | – | `{ plan, locations: { used, limit }, keywords: { used, limit }, clients, api_usage: { month, by_sku, estimated_cost_usd, previous_month, note } }` (12.5) |
| 38 | GET | `/organization/members` | user + org (owner/member) | – | `[{ user_id, name, email, role, client_ids, status }]` |
| 39 | GET | `/locations` | user + org | `search, client_id, status, sort, order, page, limit` | `{ locations: [row], page, limit, total }` |
| 40 | POST | `/locations` | user + org (owner/member) | `{ place_id, client_id? }` | **201** `{ location, api_calls }`; **409** `duplicate_place`; **403** `location_limit_reached` |
| 41 | GET | `/locations/:locationId` | user, owner | – | Location header |
| 42 | GET | `/locations/:locationId/overview` | user, owner | – | Header + `rankings, gbp, performance, reviews, competitors, refresh, empty_states` |
| 43 | PATCH | `/locations/:locationId` | user, owner (write) | `{ name?, timezone?, client_id? }` | Header |
| 44 | DELETE | `/locations/:locationId` | user, owner (write) | – | `{ deleted, gbp_unbound, jobs_cancelled, usage }` |
| 45 | GET | `/clients` | user + org (agency) | `search, status, page, limit` | `{ clients, page, limit, total }` |
| 46 | POST | `/clients` | user + org (agency, owner/member) | `{ name, website?, contact_email? }` | **201** client |
| 47 | GET | `/clients/:clientId` | user + org (agency) | – | `{ client, locations, summary }` |
| 48 | PATCH | `/clients/:clientId` | user + org (agency, owner/member) | `{ name?, website?, contact_email?, status? }` | Client |
| 49 | DELETE | `/clients/:clientId` | user + org (agency, owner/member) | – | `{ deleted, locations_unassigned }` |
| 50 | POST | `/clients/:clientId/locations` | user + org (agency, owner/member) | `{ location_id }` | `{ assigned, client_id, location_id }` |
| 51 | DELETE | `/clients/:clientId/locations/:locationId` | user + org (agency, owner/member) | – | `{ unassigned, client_id, location_id }` |
| 52 | POST | `/onboarding/skip` | user + org (owner/member) | `{ step: google\|reporting_brand }` | As #17 |

| 53 | GET | `/dashboard` | user + org | `page, limit, sort (name\|client\|rank\|rank_change\|gbp_score), order` | Business: `{ type, locations_count, visibility, gbp, reviews, movement, key_competitor, recommended_actions, refresh, status_counts, locations }`; Agency: `{ type, clients_count, locations_count, portfolio, status_counts, declines, gbp_issues, recommended_actions, table }` |
| 54 | POST | `/organization/invitations` | user + org (owner) | `{ email, role: member\|client_user, client_ids? }` | **201** `{ invitation_id, email, role, client_ids, status, expires_at, email_sent }`; **409** `already_member` |
| 55 | GET | `/organization/invitations` | user + org (owner) | `status?` | `[{ invitation_id, email, role, client_ids, status, expires_at, invited_by, created_at }]` |
| 56 | DELETE | `/organization/invitations/:invitationId` | user + org (owner) | – | `{ revoked, invitation_id }` |
| 57 | PATCH | `/organization/members/:userId` | user + org (owner) | `{ role, client_ids? }` | `{ user_id, role, client_ids }`; **403** `owner_protected` |
| 58 | DELETE | `/organization/members/:userId` | user + org (owner) | – | `{ removed, user_id }`; **403** `owner_protected` |
| 59 | POST | `/auth/invitations/inspect` | none | `{ token }` | `{ organization, email, role, status, expires_at, account_exists }`; **404** unknown; **410** `expired` / `revoked` / `accepted` |
| 60 | POST | `/auth/invitations/accept` | none | `{ token, name?, password? }` | New account: `{ accepted, organization_id, login_required: false, tokens, user, organizations, … }`; existing: `{ accepted, organization_id, login_required: true }` |

**Notes:**
- **#53:** reads only the stored per-location summaries (no rank-run or report documents, no Google). A client_user gets the agency shape for its clients only.
- **#54–#60:** the invitation token (32 random bytes) is stored as a SHA-256 hash, valid `INVITATION_TTL_DAYS` (7), single use, and travels in the request body (never a URL path). In development no email is sent: the link is logged with the email masked.
- **#17 (Phase 8):** `GET /onboarding/state` now returns `organization` (steps, `next_step`, `completed`) and `empty_states` before `gbp` and `locations`; every location of the organization is listed (unfinished first) with `source` and `client_id`.
- **#19 (Phase 8):** `select-profile` takes `client_id?`, is limit-checked when it creates a location, links a location of the organization with the same place, and answers **409** `place_id_mismatch` for a location with a different place (also #15).
- **#21 (Phase 8):** without `locationId` it is the add-location search (`country` or the organization's).
- **#22 (Phase 8):** no GBP binding needed; the GBP sync is queued only when bound.
- **#29–#34:** codes are stored hashed, expire in 15 minutes, allow 5 attempts, single use; rate-limited per email (and IP) with **429** `rate_limited`.
- **#40:** 1 Place Details call (US/CA only), after the limit and duplicate checks.
- **#44:** soft delete; history is kept and the plan slot freed at once.

### Reports center (Phase 12)

A report freezes stored data (rank runs, the GBP report, the profile snapshot) and the organization's branding in a snapshot, and its PDF is rendered once (PDFKit, no browser). Shapes and examples: [API.md](API.md#reports-center-phase-12).

| # | Method | Path | Auth | Params / body | Returns |
|---|---|---|---|---|---|
| 61 | POST | `/reports` | user + org (owner/member) | `{ location_id, type: rank_tracker\|gbp_audit\|competitor_analysis\|full, sections?, run_id?, range?: 28d\|90d\|12m }` | **202** report view with `existing`; **400** `invalid_section`, `no_rank_run`, `gbp_not_connected`, `no_gbp_report`, `no_data` |
| 62 | GET | `/reports` | user + org | `location_id, client_id, type, status (queued\|generating\|ready\|failed\|expired\|archived), page, limit` | `{ reports: [view], page, limit, total }` |
| 63 | GET | `/reports/:reportId` | user + org | – | `{ report, snapshot: { location, data, sources } \| null, document: { title, period, generated_at, branding, blocks } \| null }` |
| 64 | GET | `/reports/:reportId/pdf` | user + org | – | `application/pdf` attachment; **409** `not_ready` / `expired` |
| 65 | DELETE | `/reports/:reportId` | user + org (owner/member) | – | `{ archived, report_id }` |
| 66 | POST | `/reports/:reportId/email` | user + org (owner/member) | `{ recipients: [email] (1–10), message? }` | `{ sent, recipients, delivery: attachment\|link }`; **429** `rate_limited` |
| 67 | POST | `/reports/:reportId/share` | user + org (owner/member) | `{ expires_in_days?: 1–365 \| null }` | **201** `{ share_id, url, expires_at }`; **409** unless ready and unarchived |
| 68 | GET | `/reports/:reportId/shares` | user + org (owner/member) | – | `[{ share_id, purpose, created_at, expires_at, revoked_at, active, views, last_viewed_at }]` |
| 69 | DELETE | `/reports/:reportId/shares/:shareId` | user + org (owner/member) | – | `{ revoked, share_id }` |
| 70 | POST | `/report-schedules` | user + org (owner/member) | `{ scope: location\|client, location_id \| client_id, type, sections?, range?, recipients (1–10) }` | **201** schedule view; **400** `manual_only`, `gbp_not_connected`; **403** `agency_only` (client scope) |
| 71 | GET | `/report-schedules` | user + org | `location_id, client_id, status` | `[schedule view]` |
| 72 | GET | `/report-schedules/:scheduleId` | user + org | – | `{ schedule_id, scope, location_id, client_id, type, sections, range, recipients, frequency, status, locations, next_expected, last_sent_at, last_error, last_report_id, created_at }` |
| 73 | PATCH | `/report-schedules/:scheduleId` | user + org (owner/member) | `{ type?, sections?, range?, recipients?, status?: active\|paused }` | schedule view |
| 74 | DELETE | `/report-schedules/:scheduleId` | user + org (owner/member) | – | `{ deleted, schedule_id }` |
| 75 | GET | `/organization/branding` | user + org | – | `{ white_label, name, agency_name, primary_color, secondary_color, footer_text, contact_text, hide_mypageseo, email_sender_name, email_reply_to, logo: { mime, bytes, url } \| null, updated_at }` |
| 76 | PUT | `/organization/branding` | user + org (owner, agency) | any of `agency_name, primary_color (#rrggbb), secondary_color, footer_text, contact_text, hide_mypageseo, email_sender_name, email_reply_to` (`""` clears) | as #75; **403** `agency_only` / `owner_only` |
| 77 | GET | `/organization/branding/logo` | user + org | – | the image; **404** without a logo |
| 78 | PUT | `/organization/branding/logo` | user + org (owner, agency) | `{ data: "data:image/png;base64,…" }` | as #75; **400** `logo_type`, `logo_too_large` |
| 79 | DELETE | `/organization/branding/logo` | user + org (owner, agency) | – | as #75 |

Public share links (outside `/api/v1`, no login):

| # | Method | Public path | Auth | Returns |
|---|---|---|---|---|
| 80 | GET | `/r/:token` | share token | Branded HTML (no scripts, CSP `default-src 'none'`, `X-Robots-Tag: noindex`, no internal ids); the same **404** page for an unknown, revoked, expired or archived link; **429** above 60 requests / minute per IP |
| 81 | GET | `/r/:token/pdf` | share token | `application/pdf` attachment (views are counted on #80 only) |

**Notes:**
- **#61:** one active (queued / generating) report per location and type: a second request returns it with `existing: true`. A report stuck for 30 minutes is marked failed. `run_id` pins a rank run (default: the latest done/partial). A Full report includes each part that exists; a missing one (e.g. GBP not connected) is an "unavailable" block.
- **GBP v4:** reviews, photos and posts say "Not available yet: this needs Google My Business v4 access" until `GBP_V4_ENABLED`; never sample data.
- **#63:** the snapshot is written once; later rank runs, GBP reports or branding changes never alter a generated report.
- **#66:** in development nothing is sent (`sent: false`); the delivery is logged with the recipients masked.
- **#67:** the token (32 random bytes) is stored as a SHA-256 hash and returned only in this response. The request log redacts `/r/<token>`.
- **#70:** a schedule fires once per monthly automatic refresh of each covered location, after that location's GBP report is generated (job `report-schedule-dispatch`); the report is emailed when ready (job `report-email`). Manual refreshes don't fire schedules. `next_expected` is the next monthly refresh of the covered location(s).
- **Retention:** reports older than `REPORT_RETENTION_MONTHS` (24) lose their PDF and snapshot (status `expired`, daily job `report-retention`).

### Ranking & data quality (Phase 12.5)

No new endpoints; changed responses (examples in [API.md](API.md#ranking--data-quality-phase-125)):
- **Cells** (#6 rank-tracker, #7 grid): each `byTarget` cell also has `samples` (one value per sample: 1–60, 61 = not in the top 60, null = failed) and `spread`; `rank`/`status` are the median. Older runs have neither field.
- **#8 map-ranking:** `?point=`, and `point` on each keyword list.
- **Attribution:** responses with Google Places content carry `attribution: { provider: "Google", text: "Google Maps" }`: #8, #20, #21, #28, `GET /locations`, `GET /locations/:id/overview`, `GET /dashboard`, `GET /reports/:id`.
- **#37:** `api_usage` (Google API calls per billing SKU from the usage ledger, this and last month).
- **#28 competitor rows:** `photo_count` (0–10; 10 = "10+"), `photos_capped`, `reviews` (up to 5, with `author: { name, uri }`), `recent_review_at`; insights `photos_gap`, `review_freshness`.
- **Reports** (#61): Rank Tracker gains the section `map_ranking`, Competitor Analysis the section `reviews`.

### Citations (Phase 16)

Admin auth: a platform-admin token with the permission shown. Errors carry `data.reason`. Shapes and examples: [API.md](API.md#citations-phase-16).

| # | Method | Path | Auth | Params / body | Returns |
|---|---|---|---|---|---|
| 82 | GET | `/admin/citations/directories` | admin (`citations.view`) | `q, type, country (US\|CA), category_id, active, page, limit (≤ 100)` | `{ directories: [directory], page, limit, total }` |
| 83 | POST | `/admin/citations/directories` | admin (`citations.manage`) | `{ name, url, type, countries, category_ids?, regions?, authority?, notes?, is_active? }` | **201** directory; **400** `invalid_directory` (`problems[]`); **409** `domain_taken` |
| 84 | GET | `/admin/citations/directories/export` | admin (`citations.view`) | – | `text/csv` (UTF-8 with BOM), columns `name,url,type,countries,categories,regions,authority,notes,active` |
| 85 | POST | `/admin/citations/directories/import` | admin (`citations.manage`) | body: the CSV (`Content-Type: text/csv`, ≤ 1 MB, ≤ 2,000 rows); `?dry_run=true` | `{ dry_run, applied, rows, created, updated, unchanged, errors: [{ row, field, message }] }`; **422** with `errors` (nothing applied); **400** `invalid_csv`, `invalid_csv_header`, `empty_csv`, `too_many_rows` |
| 86 | GET | `/admin/citations/directories/:directoryId` | admin (`citations.view`) | – | directory + `used_by_locations` |
| 87 | PATCH | `/admin/citations/directories/:directoryId` | admin (`citations.manage`) | any field of #83 | directory |
| 88 | DELETE | `/admin/citations/directories/:directoryId` | admin (`citations.manage`) | – | directory with `is_active: false` |
| 89 | GET | `/admin/citations/categories` | admin (`citations.view`) | – | `[{ id, name, slug, is_active, business_categories: [{ id, name }], directory_count }]` |
| 90 | POST | `/admin/citations/categories` | admin (`citations.manage`) | `{ name, slug?, business_category_ids?, is_active? }` | **201** category; **409** `slug_taken`; **400** `unknown_business_category` |
| 91 | PATCH | `/admin/citations/categories/:categoryId` | admin (`citations.manage`) | any field of #90 | category |
| 92 | DELETE | `/admin/citations/categories/:categoryId` | admin (`citations.manage`) | – | `{ deleted: true }`; **409** `in_use` (`directory_count`) |
| 93 | GET | `/admin/citations/business-categories` | admin (`citations.view`) | `q` | `[{ id, name }]` (20, by name) |

## Removed endpoints

Removed in Phase 8: `GET /locations/google-locations/:name` and `GET /locations/google-locations/details/:placeId` (unauthenticated proxies to the old paid Places API; use `GET /places/search`), and `PUT /locations` (now `PATCH /locations/:locationId`).

Removed in Phase 16: the 13 legacy `/api/v1/citation/*` routes (manual pricings, aggregators, remove prices, `lists/:location_id`, campaign add / business info / details / all, `locations/campaigns/list/all`, tracker GET / POST, builder, `getAllCitatioList`). They were a paid citation-campaign ordering flow with a SerpAPI "tracker" returning sample data and a stub builder; replaced by the Phase 16 citation endpoints. See [plans/phase-16-citations.md](plans/phase-16-citations.md) §1.

Removed in Phase 8.1: `POST /api/v1/auth/verify-email/resend` (now `POST /api/v1/auth/resend-verification`) and the legacy `POST /api/v1/user/auth/register` (use `POST /api/v1/auth/signup`).

Removed in the legacy cleanup (Phase 9a): the old ranking routes (`/rank-tracker`, `/local-search-grid`, `/local-map-ranking`), `/gbp-audit`, `/reputation-manager`, the white-label report links and the Search Console connect. See [LEGACY_FEATURES.md](LEGACY_FEATURES.md).
