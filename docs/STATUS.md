# Status: where we are

_Rewritten at the end of every phase. History is in [PROGRESS.md](PROGRESS.md); findings are in [AUDIT.md](AUDIT.md). Last updated: 2026-09-27, Phase 12 merged and pushed; Phase 12.5 (Ranking & data quality) in planning._

## Product goal

**Target product:** [product/frontend-roadmap.pdf](product/frontend-roadmap.pdf). Backend summary: [PRODUCT.md](PRODUCT.md). Screen → endpoint → status for the frontend team: [FRONTEND_BACKEND_MAP.md](FRONTEND_BACKEND_MAP.md).

MyPageSEO is a local SEO reporting platform for US and Canadian businesses, focused only on **Google Maps / Places visibility**. There are three ranking pages, **Rank Tracker**, **Local Search Grid** and **Local Map Ranking**, all powered by one ranking engine and one fixed keyword set per location. There is also a GBP report and GBP posting.

**Out of scope:** organic/website ranking, SerpAPI, DataForSEO, Moz, and Google Q&A.

## Phases

This table matches the **Phase roadmap** in [CLAUDE.md](../CLAUDE.md) (same phases, order and status; the two must never disagree).

| # | Phase | Status | Branch | Merged into `claude/rebuild` | Milestone |
|---|---|---|---|---|---|
| 1 | Codebase audit | done | `claude/phase-1.5-hygiene` | yes (`e4a7419`) | – |
| 1.5 | Repo hygiene | done | `claude/phase-1.5-hygiene` | yes (`e4a7419`) | – |
| 1.6 | Build green | done | `claude/phase-1.6-build-green` | yes, via `53986e0` | M1 |
| 3 | Foundations | done | `claude/phase-3-foundations` | yes (`53986e0`) | M1 (pushed 2026-09-26) |
| 4 | Ranking engine | done | `claude/phase-4-ranking-engine` | yes (`3da12ed`) | M2 (pushed 2026-09-26) |
| 5 | Ranking reports | done | `claude/phase-5-ranking-reports` | yes (`2bb4cf8`) | M2 (pushed 2026-09-26) |
| 5.5 | Live validation (Fredericton) | done (informal pass, one market; formal scoring in Phase 17) | `claude/phase-5.5-live-validation` | yes (`5735bad`) | M3 |
| 6 | GBP connection | done | `claude/phase-6-gbp-connection` | yes (`4e4d556`) | M3 |
| 7a | Google connect (popup) + onboarding | done | `claude/phase-7a-connect-onboarding` | yes (`1273e2b`) | M3 |
| 9a | Legacy cleanup (early part of 9b) | done | `claude/phase-9a-legacy-cleanup` | yes (`73e4fe9`) | M3 |
| 7b | GBP sync on the monthly cadence | done | `claude/phase-7b-gbp-sync` | yes (`e74b079`) | M3 |
| 7c | GBP Score, report, competitors | done | `claude/phase-7c-scoring-report` | yes (`fb5af9f`) | M3 (pushed 2026-09-26) |
| 8 | Auth, Organization, Onboarding & Locations | done | `claude/phase-8-org-onboarding` | yes (`819dfd8`) | M4 |
| 11 | Dashboards + team | done | `claude/phase-11-dashboards-team` | yes (`0786801`) | M4 (pushed 2026-09-27) |
| 12 | Reports center | done | `claude/phase-12-reports` | yes (`3f1e192`) | M5 (pushed 2026-09-27) |
| **12.5** | **Ranking & data quality** (full depth, repeated sampling, richer competitor data, Map Ranking at 5 points, cost visibility, Google attribution) | **in progress (planning)** | `claude/phase-12.5-quality` | – | M5 |
| 10 | Security hardening (all Deferred-P10 items incl. S19, S30) | planned (after 12.5) | – | – | M5 |
| 13 | Billing & plans | planned | – | – | M5 |
| 14 | Production readiness | planned | – | – | M5 |
| – | **M5 Launch-ready** (12 + 12.5 + 10 + 13 + 14 + pre-launch live validation + Google approvals) | – | – | – | M5 |
| 9 | GBP reviews & posting (incl. AI review replies) | blocked (v4 access) | – | – | – |
| 15 | Notifications & automations | planned | – | – | – |
| 16 | Citations (data-source decision first) | planned | – | – | – |
| 17 | Ranking extras (keyword groups, Dallas + variance validation, larger grids) | planned | – | – | – |
| 9b | Cleanup | ongoing | – | – | – |

**Live test with MyPageSEO:** paused. The connect passed; the rest is blocked on Google (GBP API access), see "Blocked on Google".

`main` is untouched (`62240ac`). There is no Phase 2; security moved to Phase 10.

## Done so far

- **Audit and hygiene:** 29 security and 25 correctness findings with status (AUDIT.md), all routes listed (ROUTES.md), LF everywhere, 0 TypeScript errors, `.env` loaded from `ENV_FILE` or `./.env`.
- **Local setup:** a separate local database, `mps_rebuild` (Homebrew MongoDB 7.0). Background jobs work (C25): agenda has its own connection, the registry is `src/jobs/index.ts`, and new jobs use `defineJob` (IDs-only data).
- **Places API (New) client:** IDs-only search with a field-mask guard, `stopWhenFound`, `movedPlaceId`, a names search, Place Details, timeout and retry, and call counts.
- **Ranking engine** (`src/ranking`): sample points, rank cells, metrics and change rules (CLAUDE.md §4), a run cache, a 4-slot pool, and `estimateCalls()`.
- **Ranking reports (Phase 5):**
  - `Location.tracking` (versioned keywords, competitors, grid, frequency) and the `RankRun` model with history
  - the `rank-run` job: center resolution, tracker, grid, map list, change against the previous run, `api_calls`
  - the `rank-scheduler` job every 15 minutes, with the stuck-run guard
  - one active run per location, dev limits, and a 422 when a run would exceed `RANK_MAX_CALLS_PER_RUN`
  - **8 endpoints** (tracking, runs, rank-tracker, grid, map-ranking), all with auth and an ownership check
- **Demo data:** `npm run seed:rank-demo` gives the frontend real endpoints with no key. The data covers improved and declined ranks, `entered_top_60` / `dropped_out_of_top_60`, 60+ cells and an error cell.
- **Docs:** [API.md](API.md) (every ranking endpoint with real example responses) and [LIVE_TEST.md](LIVE_TEST.md) (the first real run, step by step).
- **Live validation (Phase 5.5):** the first real Places runs, on MyPageSEO in Fredericton (2 runs, 106 IDs-only + 7 Pro + 3 Details calls in total, no errors or retries, both runs within their estimates). **Informal pass, one market, formal scoring pending:** Mohit's manual Maps checks are close to the API ranks (e.g. "digital marketing agency fredericton": Maps #9 vs API #7–9). Calibration tooling: `find:place`, `setup:live-test`, `calibrate`, `calibrate:score` (see [LIVE_TEST.md](LIVE_TEST.md)); sheets in `docs/calibration/`.
- **GBP connection (Phase 6), offline so far:**
  - one-time hashed OAuth state and the `business.manage` scope only
  - GBP tokens encrypted (AES-256-GCM) and stored per token type (C17)
  - `gbpClient`: ≤ 5 requests/second, 429 backoff, and clear "quota 0" / "API disabled" / "reconnect" errors
  - discovery across **all** accounts with no Places calls (C22)
  - bind with `place_id` rules (set if empty, never overwrite)
  - a real unbind (C12) and disconnect
  - `npm run gbp:preflight`
  - Setup and connection: [GBP_CONNECT.md](GBP_CONNECT.md).
- **Connect + onboarding (Phase 7a), offline so far:**
  - Google account-chooser **popup** (any account, verified email shown as "Connected as …"), with the redirect flow as a fallback
  - **several Google accounts per user** (agencies): each is its own connection; profiles grouped per account; per-account bind, unbind and disconnect
  - **service-area businesses**: a center step (city or ZIP resolved once) before keywords
  - onboarding screens: pick a profile (creates or links our Location and binds it), keywords, **competitor suggestions** (top 10 across keywords, 24 h cache) or manual search, complete (first rank run + GBP sync request)
  - a daily cap on user-triggered Places calls
- **Legacy cleanup (9a):** the old ranking reports, GBP audit, Reputation Manager, white-label report links, Search Console connect and every unused config and env variable are removed (about 7,300 lines). How to rebuild the Reputation Manager and white-label links properly: [LEGACY_FEATURES.md](LEGACY_FEATURES.md). Unused collections and env vars: [MIGRATION.md](MIGRATION.md).
- **GBP sync + monthly cadence (7b), offline so far:**
  - **Sync:** the `gbp-sync` job stores performance (18-month backfill, then 40 days rolling), search keywords (6 months, then 2), the full profile, attributes, pending Google edits and verification, each type with its own status. Reviews, media and posts are built but behind `GBP_V4_ENABLED`.
  - **Refresh:** one `monthly-refresh` scheduler (per location, on its setup day at about 03:00 local) replaced the 15-minute rank scheduler. `POST/GET /locations/:id/refresh` (manual, 24 h per type). `GET /locations/:id/gbp/sync`.
  - **Settings:** `tracking.frequency` is `auto_monthly | manual_only`, with `npm run migrate:refresh`.
- **Endpoint docs rule (2026-09-26):** [ENDPOINTS.md](ENDPOINTS.md) lists every current endpoint (161 + 1 dev-only) and `npm run check:endpoints` (part of `npm test`) fails when it drifts from the code. ROUTES.md is a frozen Phase 1 snapshot. A dev-only popup-connect page `GET /dev/gbp-connect` for the live test.
- **GBP Score + report (7c), offline so far:**
  - **GBP Score** (private): 5 pillars, 26 checks, rescaled when data is missing (`partial`); today (v4 off) it runs on completeness, visibility and engagement. **Public Score** for the client and competitors alike.
  - **Competitor comparison** (client + tracked + top 3 of the map list) with gap insights; Place Details at most once per monthly cycle per business.
  - `GET /locations/:id/gbp/report?range=28d|90d|12m`, generated by the `gbp-report` job after each sync and rank run (one report per monthly refresh). Locations without GBP get the public parts.
  - `npm run seed:gbp-demo` gives the frontend a full report with no key.
  - **Scoring calibration** against real MyPageSEO data is waiting for GBP access (PROGRESS.md, 7c).
- **Organizations, auth and locations (Phase 8), offline:**
  - **Organizations** (Business / Agency) own locations and clients; roles `owner`, `member`, `client_user` (read-only, assigned clients only). Access moved from `created_by` to membership everywhere in the rebuilt code.
  - **Auth** for the new app: signup (creates the organization), email verification, login, forgot/reset. Codes stored hashed, 15 minutes, 5 attempts; rate-limited; no sensitive values in logs.
  - **Plan limits** from the plan data (`location_limit`, `keyword_limit`), default 1 location; `GET /organization/usage`.
  - **Add location** by GBP profile or Places search only; one place per organization; optional client (agency). The **locations table**, **location overview**, soft delete, and **agency clients** with assignment.
  - **Onboarding** resumable per organization (Business and Agency steps) and per location.
  - `npm run migrate:organizations` (run once on deploy) and `npm run seed:demo-orgs` (demo Business + Agency).
- **Dashboards + team (Phase 11), offline:**
  - `GET /dashboard`: Business (visibility, GBP Score + trend, reviews, keyword movement, key competitor, recommended actions) and Agency (portfolio averages, statuses, declines, GBP issues, portfolio table). It reads stored per-location summaries only.
  - Team invitations by email (member or client user), accept, revoke, role change, removal (owner-managed).
  - `db:sync-indexes` and `summaries:rebuild` added to the deploy checklist.
- **Reports center (Phase 12), offline:**
  - Rank Tracker, GBP Audit, Competitor Analysis and Full reports, frozen in a snapshot and rendered once to PDF with **PDFKit** (no browser, no system packages; about 50 ms CPU and 40 MB per 8-page report). The in-app viewer gets the same blocks.
  - Library, download, archive, email (attachment or 30-day link), revocable share links (`/r/<token>`, noindex, no ids, rate-limited), monthly schedules after each location's automatic refresh, retention (24 months).
  - Agency white-label branding (logo, colours, footer, hide MyPageSEO, email sender and reply-to); the legacy white-label routes are deprecated and `npm run migrate:branding` carries them over.
- **Tests:** 619 pass with no API key and no network. Lint baseline is 32.

## Key decisions

| Date | Decision |
|---|---|
| 2026-09-25 | Functionality first; security deferred to Phase 10 (gated). Phase 6 still builds the signed OAuth state and encrypted tokens. |
| 2026-09-25 | LF line endings. Local development uses its own `mps_rebuild` database; the server gets a fresh database after the rebuild. |
| 2026-09-26 | Ranking uses **Places API (New) Text Search, IDs-only** (free SKU). Names (Pro SKU) are used only for the Map Ranking list, 1 call per keyword. |
| 2026-09-26 | Maximum depth is 60 (**"60+"**). Averages count `not_found` as **61** and **exclude errors**. |
| 2026-09-26 | One **fixed keyword set per location** (max 20), versioned; no change is shown across keyword versions. Keyword-level entered/dropped labels come from `foundRate` 0 ↔ >0 (CLAUDE.md §4). |
| 2026-09-26 | One active run per location. In development: 2 keywords and 3×3. Runs above `RANK_MAX_CALLS_PER_RUN` (3200 IDs-only calls) are rejected. |
| 2026-09-26 | **Push only at milestones** M1–M4. **No real Google API calls until Mohit says so.** |
| 2026-09-26 | `STORE_PLACE_NAMES=true` for development. **Must decide before production launch (Maps ToS).** |
| 2026-09-26 | Phase 5.5 calibration: **informal pass** on one small market; formal scoring and a big-market test are in the backlog. |
| 2026-09-26 | Phase 6: tokens belong to the user's Google account. Unbind deletes them only with the last binding; disconnect removes everything. Search Console tokens stay plaintext until Phase 10. `GET /gbp` returns `{accounts, locations, errors}`. |
| 2026-09-26 | Phase 7 split into 7a (connect + onboarding), 7b (sync) and 7c (scoring + report, M3). `GBP_V4_ENABLED` (default false) switches reviews, media and posts; the v4 API access is pending. |
| 2026-09-26 | 7a: any Google account, **several per user** (one connection per Google account; the earlier 409 rule was dropped after review); competitor suggestions on the Enterprise SKU (cached 24 h); `PLACES_USER_DAILY_LIMIT` 50; US/CA only; service-area center from a city or ZIP (Places IDs-only search + Details `location`). |
| 2026-09-26 | Legacy cleanup brought forward (9a): old report endpoints deleted (the frontend moves to the new ones); the Reputation Manager and white-label report links are removed, with a rebuild reference in LEGACY_FEATURES.md; unused env vars removed; no collections dropped. |
| 2026-09-26 | **Monthly cadence + manual refresh:**<br>• Each location refreshes monthly: rank run → GBP sync (if bound) → GBP report.<br>• Staggered on the setup day of the month (clamped to 28) at about 03:00 local time.<br>• `POST /locations/:id/refresh` at most once per 24 h per type, returning `next_allowed_at`.<br>• `tracking.frequency` becomes `auto_monthly \| manual_only`.<br>• One `monthly-refresh` scheduler replaces the rank-scheduler logic.<br>• GBP performance: rolling 40 days per sync; search keywords: the last 2 months. |
| 2026-09-26 | **Two ways to add a location, no manual entry:**<br>• (a) GBP profile or (b) Places search.<br>• Every location has a `place_id`; `source` and `gbp_connected` are recorded.<br>• A GBP can be bound later, matched by `place_id` (a differing one is refused).<br>• Without GBP, private sections return `gbp_not_connected`.<br>• No duplicate `place_id` per organization. |
| 2026-09-26 | **New phase order:** 7b → live test → 7c (M3) → **8 Auth, Organization, Onboarding & Locations** → 9 GBP posting → 9b cleanup → 10 security. The roadmap PDF added as the target product. |
| 2026-09-26 | Phases 6–7 live GBP calls: free but quota-limited, max 5 requests/second, only against the account Mohit connects, and nothing live until Mohit says so (first step: `gbp:preflight`, triggered by Mohit). |
| 2026-09-26 | **7c:** GBP Score 5 pillars (completeness 25, activity 20, reviews 25, visibility 20, engagement 10) with rescaling; Public Score from Place Details + map-list center ranks for everyone; `editorialSummary` off (Atmosphere tier); one report per location (no Places history); report after each sync and rank run, debounced 120 s; competitor Place Details once per monthly cycle, or on a manual refresh after 24 h. Thresholds are starting values until calibrated on real data. |
| 2026-09-27 | **Phase 8:** organizations own locations and clients (roles owner / member / client_user); plan limits from optional `location_limit` / `keyword_limit` on the subscription plan (default 1 location); the legacy location routes replaced at the same paths and the unauthenticated `google-locations` proxies deleted; new `/auth` endpoints beside the deprecated `/user/auth` ones; a bind to a location with a different place is refused. |
| 2026-09-27 | **Push after every merged phase** (GitHub is the only off-machine backup). **Maps ToS: accepted risk for now** (stores listed below; Google attribution added in 12.5). **Quality over cost:** about $1 per refresh is acceptable; cost-saving behaviour that lowers data quality is removed in 12.5 (full depth, samples, Map Ranking at 5 points, competitor reviews and photos); no monthly manual-refresh cap (the 24 h guard stays). |
| 2026-09-27 | **Phase 12:** PDFKit (pure Node) over headless Chrome: small RAM, no Chromium per pm2 instance, no system packages. Reports are frozen snapshots (branding and logo included). White-label is agency-only. Schedules fire once per monthly auto-refresh cycle per location (not on manual refreshes). Share tokens are hashed, shown once and redacted from logs. Legacy white-label routes deprecated, not deleted. |
| 2026-09-27 | **Phase 11 / M4:** dashboards read stored per-location summaries only (`Location.summary`, written after runs and reports); team management is owner-only; accepting an invitation as an existing account doesn't log in; invitation tokens travel in the body and are stored hashed; in development the invitation link is logged with the email masked. |

## Open items (owner: Mohit)

1. **Push policy:** since Phase 12, every merged phase is pushed (Mohit runs the merge and push commands given at the end of each phase).
2. **Share links:** `SHARE_BASE_URL` is set locally (2026-09-27). In production set it to the public API origin and let nginx forward `/r/` to the app.
3. **Google Cloud:**
   - Add the **Authorised JavaScript origins** to the OAuth client: the frontend's, and `http://localhost:5055` for the dev test page.
   - `.env`: `TOKEN_ENCRYPTION_KEY` (currently empty, so connecting would fail) and, for the redirect fallback only, `GOOGLE_GBP_REDIRECT_URI` on port 5055 (currently 5000).
4. **Live test, when you say so:** see "Next up".
5. **Google approvals:** see "Blocked on Google" below.
6. **Frontend:** follow [FRONTEND_BACKEND_MAP.md](FRONTEND_BACKEND_MAP.md). The onboarding screens are in API.md "Onboarding", plus the grouped `GET /gbp` and `google_sub` on bind and disconnect.
7. **Maps ToS: accepted risk for now**, revisit before launch: see "Maps ToS: accepted risk" below.
8. **Rotate the DataForSEO credential** (AUDIT S13).
9. **Security Phase 10:** planned after Phase 12.5, required before launch (all Deferred-P10 items, including S19, S30 and the Search Console parts of S11, S12 and S29).

## Blocked on Google

| Item | State | What unblocks it | Then |
|---|---|---|---|
| **Business Profile API access** (Account Management, Business Information, Performance, Verifications) for Cloud project `1010247538246` | Not approved: quota 0 (live test attempt 1, 2026-09-26). Mohit is submitting the access request. | Mohit says **"GBP access approved"** (the Account Management "Requests per minute" quota is above 0). | Resume the live test at `npm run gbp:preflight -- 6ab76e2c99cf66c2cc414a13`, then bind (`POST /gbp/bind-with-user`), first sync (`POST /locations/6ab76e2c99cf66c2cc414a18/refresh {"types":["gbp"]}`), `GET …/gbp/sync`, then the 7c scoring calibration. The Google connection (`mohit@mypageseo.com`) is saved; no reconnect is needed. |
| **Google My Business API v4** (reviews, media, posts) | Pending | Access approved | Set `GBP_V4_ENABLED=true` (no code change); Phase 9 posting becomes possible. |
| **OAuth app verification** (the "Google hasn't verified this app" screen, and the test-user limit while in testing mode) | Not started | Google verifies the OAuth consent screen (`business.manage` is a sensitive scope) | Needed before real customers connect. |

## Maps ToS: accepted risk

**Accepted risk (Mohit, 2026-09-27), revisit before launch.** Places content is stored and shown as below. Mitigation (Phase 12.5): Google attribution wherever it appears. Switching to IDs-only storage later is a known task: each store below would keep only `place_id`s and resolve names at view time (the Phase 5 `resolveNames` path shows how).

| # | Store | Places content | Kept for |
|---|---|---|---|
| 1 | `RankRun.mapList[].results[].name` (`STORE_PLACE_NAMES=true`; 12.5 adds the 4 compass points) | business names from the Pro Text Search | run history (forever) |
| 2 | `Location.competitor_suggestions` | names, addresses, ratings, review counts (Enterprise Text Search) | 24 h per keyword set |
| 3 | `GbpReport.competitors.rows` | Place Details: name, rating, review count, type, hours/website/phone flags, status; 12.5 adds up to 5 reviews (with author attribution) and a photo count | latest report only (overwritten) |
| 4 | `Location.summary` (`key_competitor.name`, `rating`, `review_count`) | names and the client's public rating | until the next run or report |
| 5 | `ReportSnapshot` + report PDFs (+ share pages `/r/<token>`) | frozen copies of 1, 3 and 4 | `REPORT_RETENTION_MONTHS` (24) |
| 6 | `Location` name, address, coordinates for locations added from a Places search, and the manual center | Place Details / Text Search | the location's lifetime |

## Pre-launch live validation (Mohit triggers it)

Required for M5; not part of Phase 12.5's build:
- **Big-market test (Dallas):** Workman Plumbing (`ChIJjcMu_6CZToYRXut5OjLd6V4`, 2310 N Henderson Ave #522, 32.814438, -96.777703; the "#522" may be a mailbox suite, so confirm the storefront first). Keywords "plumber", "emergency plumber", "plumber dallas", 3×3 at 1.5 km.
- **Formal `calibrate:score`:** fill in the manual columns (tracker rows are enough: `--tracker-only`) and record the verdict.
- The Phase 12.5 **variance test** (MyPageSEO, 2 keywords, 5 tracker points, 3 samples at 0 s / 60 s / 10 min, ≤ 300 IDs-only calls, 0 Pro) decides the default number of samples.

## Backlog (not now)

The ranking items below belong to **Phase 17** (Ranking extras).


- (The Dallas test, the formal `calibrate:score` and the variance test moved to "Pre-launch live validation" and Phase 12.5.)
- **Overall-average UX:** when one keyword is 60+ everywhere it counts as 61 and dominates `overallAvgRank` (Round 1: 31.2 from 1.4 and 61). Decide how the page explains or presents it.

## Next up

1. **Phase 12.5 (Ranking & data quality)**, in plan mode (spec in CLAUDE.md §12d); the variance test when Mohit says so.
2. **Then Phase 10 (security)**, in plan mode (all Deferred-P10 items incl. S19, S30; the unauthenticated legacy `GET /white-label-profiles/:id` too), then 13 (billing & plans) and 14 (production readiness) toward M5 launch-ready.
3. **When Mohit says "GBP access approved":** resume the live test at `npm run gbp:preflight -- 6ab76e2c99cf66c2cc414a13`, then bind (`POST /gbp/bind-with-user`), first sync (`POST /locations/6ab76e2c99cf66c2cc414a18/refresh {"types":["gbp"]}`), `GET …/gbp/sync`, the report (GBP_CONNECT.md §6) and the **scoring calibration** (PROGRESS.md, 7c). The connection is saved; no reconnect needed.

**Frontend:** build against [FRONTEND_BACKEND_MAP.md](FRONTEND_BACKEND_MAP.md). Screens marked "not supported" must not be built.

## How to run

See [OPERATIONS.md](OPERATIONS.md) for:
- setup and local MongoDB (`mps_rebuild`)
- `npm run dev`, `npm test` and `npm run build`
- `npm run seed:rank-demo` and `npm run seed:demo-orgs` (demo data incl. reports, no key)
- reports storage, retention and share links (Reports center section)
- the ranking jobs
- the smoke scripts: `smoke:agenda` (free), and `smoke:places` (1 Places call; Mohit only)
- removed legacy features and data: [LEGACY_FEATURES.md](LEGACY_FEATURES.md), [MIGRATION.md](MIGRATION.md)
- live validation: [LIVE_TEST.md](LIVE_TEST.md) (`find:place`, `setup:live-test`, `calibrate`, `calibrate:score`)
- GBP: [GBP_CONNECT.md](GBP_CONNECT.md) (Google Cloud setup, popup and redirect connect, `gbp:preflight`, `gbp:encrypt-tokens`, `setup:live-test --token-only`)
- API reference: [ENDPOINTS.md](ENDPOINTS.md) (every current endpoint; checked by `npm run check:endpoints`) and [API.md](API.md) (full examples)

**Where each fact lives:**

| Topic | File |
|---|---|
| Current state and next step | this file |
| History and commit hashes | [PROGRESS.md](PROGRESS.md) |
| Findings and their status | [AUDIT.md](AUDIT.md) |
| Endpoints (current) | [ENDPOINTS.md](ENDPOINTS.md); [ROUTES.md](ROUTES.md) is the frozen Phase 1 snapshot |
| Rules and phase specs ("as built" notes) | [CLAUDE.md](../CLAUDE.md) |
