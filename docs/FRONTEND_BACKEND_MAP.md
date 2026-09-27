# Frontend → backend map

For the frontend team (Lovable). Every screen in the roadmap's **§16 Master Screen Inventory** ([product/frontend-roadmap.pdf](product/frontend-roadmap.pdf)) is listed with the backend endpoint(s) behind it and whether the data exists.

**Rule:** build a screen (or a section of one) only when it says **available**. **partial** means part of the data exists; the other parts are listed. **planned (phase N)** means the backend is coming; show an empty state or hide it. **not supported** means **don't build it**: the data won't exist.

Every current endpoint (legacy included) is in [ENDPOINTS.md](ENDPOINTS.md); request and response shapes are in [API.md](API.md).

Status as of 2026-09-26, with 7a, 9a and 7b built and awaiting merge.

## Auth

| Screen | Backend | Status |
|---|---|---|
| Login | `POST /auth/login` (returns organizations + onboarding), `POST /user/auth/refresh-auth`, `POST /user/auth/logout` | **available (8)**. The legacy `/user/auth/login` is deprecated. |
| Signup | `POST /auth/signup` (Business or Agency, user details, organization name, country, terms) | **available (8)**: creates the user, the organization and the owner membership, and emails a code |
| Forgot password | `POST /auth/forgot-password` | **available (8)**: a 6-digit code by email (not a link); same answer whether or not the account exists |
| Reset password | `POST /auth/reset-password` `{ email, code, password }` | **available (8)**; signs out every session. (Changing the password while logged in: legacy `POST /user/auth/reset-password`.) |
| Verify email | `POST /auth/verify-email`, `POST /auth/verify-email/resend` | **available (8)**: 6-digit code, 15 minutes, 5 attempts; verify logs the user in |
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
| Business dashboard | `GET /dashboard` (business shape) | **available (11)**: visibility (average rank, change, top-3 rate, trend), GBP Score + grade + change, rating/reviews (public numbers until v4), ranking movement, key competitor, top 5 recommended actions, last/next refresh. "Local Visibility score" = the average-rank block (no separate score). "Citation health": **planned (Phase 16)**. |
| Agency dashboard | `GET /dashboard` (agency shape) | **available (11)**: client and location counts, portfolio averages (rank, GBP Score), statuses (reconnect / setup), locations with ranking declines, GBP issues, recommended actions, portfolio table (paged, sortable). "Unanswered reviews across portfolio" needs v4; "Reports ready/scheduled/failed": use `GET /reports?status=` and `GET /report-schedules` (Phase 12; not in the dashboard response). |

## Locations

| Screen | Backend | Status |
|---|---|---|
| Location list (`/locations`) | `GET /locations` (search, filter by client/status, sort, pages) | **available (8)**: name, city, client, rank + change, GBP score + grade, rating/reviews, status (`active \| setup_required \| gbp_not_connected \| reconnect_required`), last/next refresh. "Visibility" = the rank summary (no separate visibility score). |
| Add location | (a) GBP: `GET /onboarding/gbp-profiles` → `POST /onboarding/select-profile`; (b) `GET /places/search?q=` → `POST /locations { place_id }` | **available (8)**: plan limit, one place per organization, optional client. No manual entry, by design. |
| Location overview (`/locations/:id`) | `GET /locations/:id` (header), `GET /locations/:id/overview` | **available (8)**: header + rankings, GBP score, performance, reviews, competitors, refresh and empty states |
| Location settings | `PUT/GET /locations/:id/tracking`, `PATCH /locations/:id` (name, timezone, client), `DELETE /locations/:id` (soft delete) | **available (8)** |
| Refresh button | `POST /locations/:id/refresh`, `GET /locations/:id/refresh` (`next_allowed_at`, monthly schedule) | available (7b): once per 24 h per type |
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
| Citation dashboard per location (Citation Health score, counts by status, recent changes) | – | **planned (Phase 16)**: manual, admin-managed citation tracking (no external citation APIs). Read-only for organization users; a client_user sees its assigned clients only. |
| Citation table (directory, type, status, NAP issues, listing link, last checked) | – | **planned (Phase 16)** |
| Admin: directory master list, categories, per-location citation lists, work queue | – | **planned (Phase 16)**, platform admins only (needs Phase 10's admin auth and roles) |
| Legacy citation screens / campaign UI | legacy `/citation/*` (tracker via SerpAPI, broken, AUDIT C13) | legacy; Phase 16 audits it and lists what's reused, replaced or retired. Don't build on it. |

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
| Citation Report | – | **planned (Phase 16)**: in the Reports center (PDF, email, schedules, share links), plus a Citations section in the Full report. Data source decided (Mohit, 2026-09-27): manual, admin-managed tracking. |

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
| Notifications | legacy `POST /user/notifications` (toggle) | legacy toggle only; event notifications not planned yet |
| Billing | legacy `/subscription/*`, `/payments/*`; limits via `GET /organization/usage` (12.5: + `api_usage`, Google API calls and a list-price estimate this and last month) | legacy (Square / PayPal). Plan limits (`location_limit`, `keyword_limit` on the plan) are enforced since Phase 8; the payment logic is unchanged. |
| White label | `GET/PUT /organization/branding`, `GET/PUT/DELETE /organization/branding/logo` | **available (12), agency only**: agency name, logo (PNG/JPEG ≤ 512 KB), colours, footer/contact text, hide MyPageSEO, email sender name and reply-to. Business organizations use the default branding. The legacy `/white-label-profiles` routes are deprecated (`npm run migrate:branding` copies them). |
| Security | – | not planned yet |

## Support

| Screen | Backend | Status |
|---|---|---|
| Help / support entry | legacy support routes | legacy (out of scope) |

## Not supported (don't build these)

| PDF mentions | Why |
|---|---|
| Organic Google rankings / "Google" result type / Google Local Pack from a SERP | The product is Maps / Places only (CLAUDE.md §1). Use Maps ranks and the Maps top-3 rate. |
| Keyword search volume | DataForSEO removed; no source. GBP search-keyword impressions (7b) are the alternative. |
| Competitor citations, key citations, links, linking domains, website authority | No SEO-authority data source. |
| Full competitor photo counts | Places `photos` is not in our field set and moves billing to the top tier. Only the client's own photos (v4). |
| Google Q&A | API discontinued 2025-11-03. |
| Duplicate listings | No data source. |
| Google Analytics / Search Console integrations | Removed (organic scope). |
| Social login | Not planned. |
