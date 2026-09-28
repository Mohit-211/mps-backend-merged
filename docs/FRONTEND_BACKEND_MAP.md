# Frontend → backend map

For the frontend team (Lovable). Every screen in the roadmap's **§16 Master Screen Inventory** ([product/frontend-roadmap.pdf](product/frontend-roadmap.pdf)) is listed with the backend endpoint(s) behind it and whether the data exists.

**Rule:** build a screen (or a section of one) only when it says **available**. **partial** means part of the data exists; the other parts are listed. **planned (phase N)** means the backend is coming; show an empty state or hide it. **not supported** means **don't build it**: the data won't exist.

Every current endpoint (legacy included) is in [ENDPOINTS.md](ENDPOINTS.md); request and response shapes are in [API.md](API.md).

Status as of 2026-09-28: everything through Phase 16 (citations) is merged and pushed. Billing (Phase 13a) is built (awaiting merge): the billing screen is **available**. The admin panel backend and support tickets (13b) are next. Summary: [PROJECT_SUMMARY.md](PROJECT_SUMMARY.md).

## Notes for the frontend team (Phase 10, 2026-09-27)

**1. Sessions: refresh the access token.**
- Access tokens last **1 day** (they were 7). Refresh tokens last **30 days** (`JWT_REFRESH_EXPIRATION_DAYS`).
- On a **401** from any endpoint, call `POST /user/auth/refresh-auth { refresh_token }` once and retry with the new access token.
- If the refresh itself fails (401 expired or revoked, 404 disabled account), clear the tokens and go to login. After 30 days the user always logs in again.
- A password change or reset, or an account deletion, ends every session (the next refresh is 401).
- Exact flow, responses and error messages: [API.md](API.md) "Session tokens and refresh".

**2. Admin panel: admin sign-in only.**
- The admin panel signs in with `POST /admin/auth/login` and sends that **admin** token (12 h) on every admin call. User tokens never work on admin routes, and admin tokens never work on user routes.
- Every admin route is guarded. No token → **401**. A role without the permission → **403** `{ "reason": "forbidden", "permission": "…" }`; hide the menu entries the role can't use.
- Forgot password: `sendOTP` → `verifyOTP` → `forgotPassword` (see API.md "Platform admin authentication").

| Permission | Roles | Routes |
|---|---|---|
| `admins.manage` | super admin | `/admin/auth/{register, getAllAdmins, getAdminById/:id, updateAdmin, deleteAdmin}`, `/roles` (all) |
| `platform.read` | super admin, admin | `GET /contact-us/get`, `GET /contact-us/:contactId` |
| `platform.write` | super admin, admin | `PUT /contact-us/:contactId/status`, `DELETE /contact-us/:contactId` |
| `content.manage` | super admin, admin, editor | blog, blog categories and FAQs create / update / delete; `POST/PUT /business-categories` |
| `system.read` | super admin | `/system/{info, process, time, usage}`, `GET/DELETE /logs` |
| `citations.view` / `citations.manage` | super admin, admin, editor | Phase 16 citation admin (directories, per-location lists, work queue) |
| `billing.read` / `billing.manage` | super admin, admin | Phase 13a billing admin `/admin/billing/*`: prices, custom plans, subscriptions, invoices, tokens, packs, coupons, legacy links, audit log |

The full per-route list is in [ENDPOINTS.md](ENDPOINTS.md) (auth column `admin (permission)`). The public admin routes are `login`, `sendOTP`, `verifyOTP` and `forgotPassword` (rate-limited).

**3. CORS: register every frontend origin.** The wildcard CORS header is gone. The API answers cross-origin requests only from the origins listed in **`ACCESSDOMAINS`** (comma-separated, exact scheme + host + port, e.g. `https://app.mypageseo.com,https://admin.mypageseo.com`). A new frontend URL (staging, preview, admin panel) must be added there, and the API restarted, before it can call the API. Otherwise the browser blocks the request with a CORS error.

**4. Billing (Phase 13a, 2026-09-28).**
- **Read-only organizations:** after the trial (7 days) without a subscription, after a failed payment's 7-day grace, or with an overdue invoice past grace, money-costing actions answer **402** `{ reason: "subscription_required", billing: { state, trial_ends_at } }` (list in ENDPOINTS.md "Billing gates"). Show a banner linking to the billing page; reads keep working. Show `state` / `trial_ends_at` / `grace_ends_at` from `GET /billing`.
- **Adding a location** beyond the paid quantity answers **402** `location_payment_required` with a `quote`: show it, call `POST /billing/location-slots`, send the user to `approve_url`, capture on return, then retry the add. **403** `enterprise_required` above the plan cap (20): show "contact us".
- **Invitations** over the user limit (3 per paid location) answer **403** `user_limit_reached`.
- **PayPal returns** to `FRONTEND_URL/settings/billing?...`: `checkout=success` → `POST /billing/sync`; `order=return&token=<id>` → `POST /billing/orders/<id>/capture`; `checkout=cancelled` / `order=cancelled` → show nothing.

## Auth

| Screen | Backend | Status |
|---|---|---|
| Login | `POST /auth/login` (returns organizations + onboarding), `POST /user/auth/refresh-auth`, `POST /user/auth/logout` | **available (8)**. The legacy `/user/auth/login` is deprecated. |
| Signup | `POST /auth/signup` (Business or Agency, user details, organization name, country, terms) | **available (8, 8.1)**: creates the user, the organization and the owner membership, and emails a **verification link**. Then show "Check your email" with a resend button (`POST /auth/resend-verification`). Unverified accounts are deleted after 24 h. |
| Forgot password | `POST /auth/forgot-password` | **available (8)**: a 6-digit code by email (not a link); same answer whether or not the account exists |
| Reset password | `POST /auth/reset-password` `{ email, code, password }` | **available (8)**; signs out every session. (Changing the password while logged in: legacy `POST /user/auth/reset-password`.) |
| Verify email (`/verify-email?token=…`) | `POST /auth/verify-email { token }`, `POST /auth/resend-verification { email }` | **available (8.1)**: the page the email link opens. Call verify once on load. The first time it logs the user in (continue to onboarding); `already_verified` → "already verified" + Log in (no error page); `link_expired` / `link_invalid` → "Send a new link". Login before verifying is **403** `email_not_verified` (offer resend). Full table: API.md "The `/verify-email` page". |
| Social login ("optional") | – | not supported (not planned) |

## Onboarding

| Screen | Backend | Status |
|---|---|---|
| Business onboarding | `GET /onboarding/state` (organization steps + empty states), `POST /onboarding/skip`, `POST /onboarding/select-profile` or `GET /places/search` + `POST /locations`, `PUT /locations/:id/center`, `PUT /locations/:id/tracking`, `GET /locations/:id/competitor-suggestions`, `POST /onboarding/complete` | **available (8)**: resumable at any step; Google can be skipped (Places-search path) |
| Agency onboarding | as above + `POST /clients` (first client) and `client_id` on add-location | **available (8)**. The "reporting brand" step (Phase 12) is `done` once branding is saved (`PUT /organization/branding`), or skipped. |
| Google/GBP connection | `GET /user/auth/google/gbp/popup` + `POST /user/auth/google/gbp/code` (popup), `GET /user/auth/google/gbp` (redirect), `POST /user/auth/google/gbp/revoke` | available (several Google accounts per user) |
| Setup completion | `POST /onboarding/complete` | available (queues the first rank run and the first GBP sync; sets the monthly refresh) |

## Dashboard

| Screen | Backend | Status |
|---|---|---|
| Business dashboard | `GET /dashboard` (business shape) | **available (11)**: visibility (average rank, change, top-3 rate, trend), GBP Score + grade + change, rating/reviews (public numbers until v4), ranking movement, key competitor, top 5 recommended actions, last/next refresh. "Local Visibility score" = the average-rank block (no separate score). "Citation health": **available (16)**: the `citations` block (score, grade, coverage, listings, live / wrong NAP / not listed / unchecked counts) and `locations[].citation_score`; recommended actions `citations:nap_wrong` and `citations:not_found`. |
| Agency dashboard | `GET /dashboard` (agency shape) | **available (11)**: client and location counts, portfolio averages (rank, GBP Score), statuses (reconnect / setup), locations with ranking declines, GBP issues, recommended actions, portfolio table (paged, sortable). Citations (16): `portfolio.avg_citation_score`, the `citations` block, and `table.rows[].citations`. "Unanswered reviews across portfolio" needs v4; "Reports ready/scheduled/failed": use `GET /reports?status=` and `GET /report-schedules` (Phase 12; not in the dashboard response). |

## Locations

| Screen | Backend | Status |
|---|---|---|
| Location list (`/locations`) | `GET /locations` (search, filter by client/status, sort, pages) | **available (8)**: name, city, client, rank + change, GBP score + grade, rating/reviews, status (`active \| setup_required \| gbp_not_connected \| reconnect_required`), last/next refresh. "Visibility" = the rank summary (no separate visibility score). |
| Add location | (a) GBP: `GET /onboarding/gbp-profiles` → `POST /onboarding/select-profile`; (b) `GET /places/search?q=` → `POST /locations { place_id }` | **available (8)**: plan limit, one place per organization, optional client. No manual entry, by design. **13a:** 402 `location_payment_required` (+ `quote`) at the paid quantity, 403 `enterprise_required` above the cap, 402 `subscription_required` when read-only. |
| Location overview (`/locations/:id`) | `GET /locations/:id` (header), `GET /locations/:id/overview` | **available (8)**: header + rankings, GBP score, performance, reviews, competitors, refresh and empty states |
| Location settings | `PUT/GET /locations/:id/tracking`, `PATCH /locations/:id` (name, timezone, client), `DELETE /locations/:id` (soft delete) | **available (8)** |
| Refresh button | `POST /locations/:id/refresh`, `GET /locations/:id/refresh` (`next_allowed_at`, monthly schedule, `tokens: { cost, balance }`) | available (7b): once per 24 h per type. **13a:** a manual refresh costs tokens (show the cost on the button); 402 `insufficient_tokens` → link to buying tokens. |
| GBP data freshness | `GET /locations/:id/gbp/sync` (status per data type, last synced); `GET /locations/:id/refresh` → `report.pending` | available (7b, 7c) |

## Rankings

| Screen | Backend | Status |
|---|---|---|
| Overview | `GET /locations/:id/rank-tracker` (avgRank, foundRate, top3Rate, change, trend of the last 12 runs) | **partial**: average rank, movement (change labels), history and distribution (buckets per cell) are available. **"Local Pack coverage" = Maps top-3 rate** (not a Google SERP pack). |
| Keywords | `GET /locations/:id/rank-tracker`, `PUT /locations/:id/tracking` | **partial**: keywords, current and previous rank, change. **Search volume: not supported.** "Result type Google / Local Finder": **not supported**; Maps only. |
| Keyword groups | – | not supported yet (no groups in the model; could be added later if needed) |
| Positions | `GET /locations/:id/rank-tracker` (5 tracker points), `GET /locations/:id/rank-runs` | available |
| Map rankings | `GET /locations/:id/map-ranking?point=C\|N\|S\|E\|W\|all` (top 20 per keyword at the center and the 4 compass points, client highlighted) | available; **12.5:** point selector (default center) to show how the list changes across the area. Show `attribution` near the names. |
| Local Search Grid | `GET /locations/:id/grid` (3×3 / 5×5 / 7×7, rank per point, summary; `?runId=` for history) | available. "Search type" selector: Maps only. **12.5:** each cell has `samples` and `spread` (how stable the rank was across repeated searches; 61 = not in the top 60). |
| Competitor rankings | `GET /locations/:id/rank-tracker` / `grid` (`byTarget` per tracked competitor) | available |

## GBP

| Screen | Backend | Status |
|---|---|---|
| Overview | `GET /locations/:id/gbp/report?range=28d\|90d\|12m`: `performance` (totals, previous period, same period last year, by day, by surface, by device, actions per 1,000), `keywords` (top, change, not tracked), `pending_google_edits`, `verification` | **available (7c)**. Locations without GBP: `{ available: false, reason: "gbp_not_connected" }`. |
| Audit | GBP report `gbp_score` (score, grade, 5 pillars, checks, top 5 fixes, `partial` + `excluded_pillars`), `score_history` | **available (7c)**. Until v4 access, Activity and Reviews are excluded (`partial: true`). **Duplicates: not supported.** "Website signals" beyond "website set": not supported. |
| Audit competitor analysis | GBP report `competitors` (Place Details + center ranks, Public Score, insights) | **available (7c)**, also for locations without GBP. Competitor citations, links, authority and photos: **not supported.** |
| Reviews | GBP report `reviews` (v4: average, total, new 30/90 d, reply rate, median reply time, per month, distribution, unreplied) | **built (7c), needs Google v4 access**. Until then `{ available: false, reason: "v4_access_pending" }`. Demo data: `npm run seed:gbp-demo`. |
| Review reply | – | **planned (Phase 9+)**, needs v4. AI reply drafting: not planned yet. |
| Posts | legacy `/gbp/post/*` | **partial / legacy**: rebuilt in **Phase 9** (needs v4) |
| Post editor / calendar | legacy `/gbp/post/add` | planned (Phase 9) |

## Citations

| Screen | Backend | Status |
|---|---|---|
| Citation dashboard per location (Citation Health score, counts by status, recent changes) | `GET /locations/:id/citations` (`health`, `counts`, `recent_changes`, `last_checked_at`), `GET /locations/:id/citations/changes` | **available (16)**: read-only for every organization role (a client_user only for its clients' locations). Before an admin builds the list: `{ available: false, reason: "no_citations_yet" }`. Changes show "MyPageSEO team"; internal notes are never shown. |
| Citation table (directory, type, status, NAP issues, listing link, last checked) | `GET /locations/:id/citations[?status=]` → `citations[]` | **available (16)**: problems first (`nap_wrong`, `duplicate`, `not_found`, …); `nap_issues: [{ field, found, expected }]`. |
| Admin: directory master list, categories, per-location citation lists, work queue | `/admin/citations/directories*` (incl. CSV import / export), `/admin/citations/categories*`, `/admin/citations/business-categories`, `/admin/citations/locations/:id` (+ `/suggest`, `/entries`), `/admin/citations/entries/*` (update, bulk, remove, restore, history), `/admin/citations/queue/{unchecked,stale,recent}` | **available (Phase 16)**: platform admins only (`citations.view` to read, `citations.manage` to change). API.md "Citations (Phase 16)" |
| Legacy citation screens / campaign UI | – | **removed (Phase 16)**: the legacy `/citation/*` routes (campaign ordering, SerpAPI tracker, builder stub) are gone. Don't build them. |

## Competitors

| Screen | Backend | Status |
|---|---|---|
| Competitor overview | `GET /locations/:id/competitor-suggestions`, tracking competitors, GBP report `competitors` | **available (7c)**: suggestions, selection and the comparison (rating, reviews, center rank, category, hours, website, phone, Public Score). **Photos: not supported.** |
| Comparison | GBP report `competitors.rows` | available (7c). **12.5:** photos (`photo_count`, "10+" when `photos_capped`) and up to 5 recent Google reviews per business with the author (show the author name, link `author.uri`). Show `attribution`. |
| Competitive gaps | GBP report `competitors.insights` (rule-based, max 5: review gap, rating gap, missing hours/website/phone, rank gap, category) | available (7c). **Citation gap: not supported.** |

## Reports

| Screen | Backend | Status |
|---|---|---|
| Report library | `GET /reports` (filters `location_id`, `client_id`, `type`, `status` incl. `archived`; paged) | **available (12)**. A client_user sees its clients' reports only. |
| Create report | `POST /reports { location_id, type, sections?, run_id?, range? }` → poll `GET /reports/:id` until `ready` | **available (12)**: Rank Tracker, GBP Audit, Competitor Analysis, Full. Generated in a job (usually a second or two). |
| Report viewer | `GET /reports/:id` → `document.blocks` (heading, paragraph, kpis, table, line_chart, heatmap, list, unavailable) and `snapshot.data` | **available (12)**. The blocks are exactly what the PDF shows; render them in the app. GBP v4 sections show "Not available yet", never sample data. |
| Download / email / archive | `GET /reports/:id/pdf`, `POST /reports/:id/email { recipients, message? }`, `DELETE /reports/:id` | **available (12)**. Emails above 10 MB carry a 30-day link instead of the attachment. |
| Share link | `POST /reports/:id/share { expires_in_days? }`, `GET /reports/:id/shares`, `DELETE /reports/:id/shares/:shareId`; public page `/r/<token>` | **available (12)**. The URL is shown once; branded, noindex, revocable. |
| Scheduled reports | `GET/POST /report-schedules`, `GET/PATCH/DELETE /report-schedules/:id` (`next_expected`, `last_sent_at`, `last_error`) | **available (12)**: monthly only, after each covered location's automatic refresh; location or client (agency) scope. |
| Citation Report | `POST /reports { type: "citation" }`, then the usual report endpoints (PDF, email, share, `POST /report-schedules { type: "citation" }`) | **available (16)**: sections `score`, `table`, `nap_issues`, `changes`; the Full report has a Citations part. Needs a citation list (else **400** `no_citations_yet`). |

## Agency

| Screen | Backend | Status |
|---|---|---|
| Clients / client detail | `GET/POST /clients`, `GET/PATCH/DELETE /clients/:id` | **available (8)**: list with location count and averages; detail with assigned locations and summary. "Reports" on the detail page: `GET /reports?client_id=` and `GET /report-schedules?client_id=` (12). "Activity": not planned yet. |
| Client locations | `POST /clients/:id/locations`, `DELETE /clients/:id/locations/:locationId`, `client_id` on add-location | **available (8)** |
| Client users | `POST /organization/invitations { role: "client_user", client_ids }`, `POST /auth/invitations/inspect` + `accept`, role `client_user` (read-only, assigned clients only; dashboard limited to them) | **available (11)** |
| Agency team | `GET /organization/members`, `POST/GET/DELETE /organization/invitations`, `PATCH/DELETE /organization/members/:userId` | **available (11)**: owner-managed; ownership transfer not available |

## Automations

| Screen | Backend | Status |
|---|---|---|
| Automation list / create / detail | – | **not planned yet**. The only scheduled work is the monthly refresh (7b) and GBP post scheduling (Phase 9). |

## Settings

| Screen | Backend | Status |
|---|---|---|
| Organization | `GET/PATCH /organization`, `GET /organization/usage` (plan, locations and keywords used/limit, clients) | **available (8)** |
| Profile | legacy `GET/PUT /user/profile` | available (legacy) |
| Team / permissions | roles `owner`, `member`, `client_user`; invitations, role change, removal (owner only) | **available (11)**. The legacy `/user/auth/employee/*` routes still work (they add a member directly). |
| Integrations | GBP connections (above) | **partial**: GBP only. **Google Analytics / Search Console: not supported** (removed; organic scope). |
| Notifications | – | **not planned yet** (Phase 15: notifications & automations). The legacy toggle was removed in 13b. |
| Billing (one page) | `GET /billing` (state, plan, prices, subscription, next renewal, locations / users / tokens, billing details), `POST /billing/{checkout, sync, cancel}`, `GET /billing/location-slots/quote` + `POST /billing/location-slots`, `GET /billing/token-packs`, `POST /billing/coupon/validate`, `POST /billing/tokens/checkout`, `POST /billing/orders/:orderId/capture`, `GET /billing/tokens/ledger`, `PATCH /billing/details`, `GET /billing/invoices[/:id/pdf]`; `GET /organization/usage` (limits + `api_usage`) | **available (13a)**: owner pays and edits, member reads, client_user no access. PayPal flow and return URLs: API.md "Billing (Phase 13a)". Pricing page on the marketing site: public `GET /pricing?country=US\|CA`. |
| White label | `GET/PUT /organization/branding`, `GET/PUT/DELETE /organization/branding/logo` | **available (12), agency only**: agency name, logo (PNG/JPEG ≤ 512 KB), colours, footer/contact text, hide MyPageSEO, email sender name and reply-to. Business organizations use the default branding. |
| Security | – | not planned yet |

## Support

| Screen | Backend | Status |
|---|---|---|
| Help / support tickets | – | **planned (13b)**: support tickets with threads (the legacy `/supports` routes were removed) |

## Not supported (don't build these)

| PDF mentions | Why |
|---|---|
| Organic Google rankings / "Google" result type / Google Local Pack from a SERP | The product is Maps / Places only (CLAUDE.md §1). Use Maps ranks and the Maps top-3 rate. |
| Keyword search volume | No source (the third-party vendor was removed 2026-09-27). GBP search-keyword impressions (7b) are the alternative. |
| Competitor citations, key citations, links, linking domains, website authority | No SEO-authority data source. |
| Full competitor photo counts | Places `photos` is not in our field set and moves billing to the top tier. Only the client's own photos (v4). |
| Google Q&A | API discontinued 2025-11-03. |
| Duplicate listings | No data source. |
| Google Analytics / Search Console integrations | Removed (organic scope). |
| Social login | Not planned. |
