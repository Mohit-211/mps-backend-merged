# Frontend → backend map

For the frontend team (Lovable). Every screen in the roadmap's **§16 Master Screen Inventory** ([product/frontend-roadmap.pdf](product/frontend-roadmap.pdf)) is listed with the backend endpoint(s) behind it and whether the data exists.

**Rule:** build a screen (or a section of one) only when it says **available**. **partial** means part of the data exists; the other parts are listed. **planned (phase N)** means the backend is coming; show an empty state or hide it. **not supported** means **don't build it**: the data won't exist.

Every current endpoint (legacy included) is in [ENDPOINTS.md](ENDPOINTS.md); request and response shapes are in [API.md](API.md).

Status as of 2026-09-26, with 7a, 9a and 7b built and awaiting merge.

## Auth

| Screen | Backend | Status |
|---|---|---|
| Login | `POST /user/auth/login`, `POST /user/auth/refresh-auth`, `POST /user/auth/logout` | available (legacy auth) |
| Signup | `POST /user/auth/register` | **partial**: creates a user; **no Business/Agency type, organization name or country yet → Phase 8** |
| Forgot password | `POST /user/auth/forgot-password` (OTP by email) | available (legacy; OTP-based, not a link) |
| Reset password | `POST /user/auth/reset-password` | available (legacy) |
| Verify email | `POST /user/auth/otp`, `POST /user/auth/verify-otp` | available (legacy OTP flow) |
| Social login ("optional") | – | not supported (not planned) |

## Onboarding

| Screen | Backend | Status |
|---|---|---|
| Business onboarding | `GET /onboarding/state`, `POST /onboarding/select-profile`, `PUT /locations/:id/center`, `PUT /locations/:id/tracking`, `GET /locations/:id/competitor-suggestions`, `GET /places/search`, `POST /onboarding/complete` | **partial**: the location part is available (7a); the organization step and the Places-search "add location" path are **planned (Phase 8)** |
| Agency onboarding | as above + clients | **partial**: the location part is available; agency info, the first client and the reporting brand are **planned (Phase 8)** |
| Google/GBP connection | `GET /user/auth/google/gbp/popup` + `POST /user/auth/google/gbp/code` (popup), `GET /user/auth/google/gbp` (redirect), `POST /user/auth/google/gbp/revoke` | available (several Google accounts per user) |
| Setup completion | `POST /onboarding/complete` | available (queues the first rank run and the first GBP sync; sets the monthly refresh) |

## Dashboard

| Screen | Backend | Status |
|---|---|---|
| Business dashboard | – | **planned (after Phase 8)**. Inputs will exist (rank summary, GBP score, reviews); there is no aggregate endpoint yet. "Citation health" is **not supported** (see Citations). |
| Agency dashboard | – | **planned (after Phase 8)**. "Reports ready/scheduled/failed" depends on the report center (not planned yet). |

## Locations

| Screen | Backend | Status |
|---|---|---|
| Location list (`/locations`) | legacy `GET /locations` (basic fields) | **partial**: the table with client, rank summary, GBP score, rating/reviews and status is **planned (Phase 8)** |
| Add location | (a) GBP: `GET /onboarding/gbp-profiles` → `POST /onboarding/select-profile`; (b) Places search → pick | (a) available; (b) **planned (Phase 8)**. No manual entry, by design. |
| Location overview (`/locations/:id`) | – | **planned (Phase 8)**: header (name, city, rating, reviews) + latest summaries |
| Location settings | `PUT/GET /locations/:id/tracking` (keywords, competitors, grid, `frequency: auto_monthly \| manual_only`) | **partial**: tracking is available; other settings in Phase 8 |
| Refresh button | `POST /locations/:id/refresh`, `GET /locations/:id/refresh` (`next_allowed_at`, monthly schedule) | available (7b): once per 24 h per type |
| GBP data freshness | `GET /locations/:id/gbp/sync` (status per data type, last synced) | available (7b); the GBP report itself is 7c |

## Rankings

| Screen | Backend | Status |
|---|---|---|
| Overview | `GET /locations/:id/rank-tracker` (avgRank, foundRate, top3Rate, change, trend of the last 12 runs) | **partial**: average rank, movement (change labels), history and distribution (buckets per cell) are available. **"Local Pack coverage" = Maps top-3 rate** (not a Google SERP pack). |
| Keywords | `GET /locations/:id/rank-tracker`, `PUT /locations/:id/tracking` | **partial**: keywords, current and previous rank, change. **Search volume: not supported.** "Result type Google / Local Finder": **not supported**; Maps only. |
| Keyword groups | – | not supported yet (no groups in the model; could be added later if needed) |
| Positions | `GET /locations/:id/rank-tracker` (5 tracker points), `GET /locations/:id/rank-runs` | available |
| Map rankings | `GET /locations/:id/map-ranking` (top 20 at the location per keyword, client highlighted) | available |
| Local Search Grid | `GET /locations/:id/grid` (3×3 / 5×5 / 7×7, rank per point, summary; `?runId=` for history) | available. "Search type" selector: Maps only. |
| Competitor rankings | `GET /locations/:id/rank-tracker` / `grid` (`byTarget` per tracked competitor) | available |

## GBP

| Screen | Backend | Status |
|---|---|---|
| Overview | GBP report | **planned (7c)**: performance, search keywords, health, pending Google edits |
| Audit | GBP report `gbpScore` (pillars, checks, fixes) | **planned (7c)**. **Duplicates: not supported.** "Website signals" beyond "website set": not supported. |
| Audit competitor analysis | GBP report `competitors` (Places Details + ranks, Public Score, gaps) | **planned (7c)**. Competitor citations, links, authority and photos: **not supported.** |
| Reviews | GBP report `reviews` (v4) | **planned (7b/7c), needs Google v4 access**. Until then `{ available: false, reason: "v4_access_pending" }`. |
| Review reply | – | **planned (Phase 9+)**, needs v4. AI reply drafting: not planned yet. |
| Posts | legacy `/gbp/post/*` | **partial / legacy**: rebuilt in **Phase 9** (needs v4) |
| Post editor / calendar | legacy `/gbp/post/add` | planned (Phase 9) |

## Citations

| Screen | Backend | Status |
|---|---|---|
| Citation overview / table / details | legacy `/citation/*` (tracker via SerpAPI, broken, AUDIT C13) | **not supported for now**: legacy and out of scope. Citation intelligence (health, NAP consistency, authority) is to be decided after Phase 8. |
| Campaign UI | legacy `/citation/campaign/*` | legacy, out of scope; not planned |

## Competitors

| Screen | Backend | Status |
|---|---|---|
| Competitor overview | `GET /locations/:id/competitor-suggestions`, tracking competitors, GBP report `competitors` | **partial**: suggestions and selection are available; comparison is **planned (7c)** (rating, reviews, rank, categories, hours, website, phone, Public Score). **Photos: not supported.** |
| Comparison | GBP report `competitors.table` | planned (7c) |
| Competitive gaps | GBP report `competitors.insights` (rule-based: review gap, rating gap, rank gap, profile gaps) | planned (7c). **Citation gap: not supported.** |

## Reports

| Screen | Backend | Status |
|---|---|---|
| Report library / viewer / create / scheduled | – | **not planned yet** (to decide after Phase 8). The underlying data (rankings, GBP report, competitors) will exist; PDF rendering, email, scheduling and white-label rendering don't. |

## Agency

| Screen | Backend | Status |
|---|---|---|
| Clients / client detail | legacy `/user/clients` CRUD | **partial**: legacy CRUD exists; organization-scoped clients with location assignment are **planned (Phase 8)** |
| Client locations | – | planned (Phase 8) |
| Client users | – | not planned yet |
| Agency team | legacy `/user/auth/employee/*` | legacy; organization team is **planned (Phase 8)** at the earliest |

## Automations

| Screen | Backend | Status |
|---|---|---|
| Automation list / create / detail | – | **not planned yet**. The only scheduled work is the monthly refresh (7b) and GBP post scheduling (Phase 9). |

## Settings

| Screen | Backend | Status |
|---|---|---|
| Organization | – | planned (Phase 8) |
| Profile | legacy `GET/PUT /user/profile` | available (legacy) |
| Team / permissions | legacy employees | planned (Phase 8+) |
| Integrations | GBP connections (above) | **partial**: GBP only. **Google Analytics / Search Console: not supported** (removed; organic scope). |
| Notifications | legacy `POST /user/notifications` (toggle) | legacy toggle only; event notifications not planned yet |
| Billing | legacy `/subscription/*`, `/payments/*` | legacy (Square / PayPal); plan limits are read in Phase 8; the payment logic is not changed |
| White label | legacy `/white-label-profiles` (brand fields) | **partial**: profile CRUD exists; public report links were removed (see [LEGACY_FEATURES.md](LEGACY_FEATURES.md)) |
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
