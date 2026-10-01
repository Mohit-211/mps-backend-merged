# Status: where we are

_Rewritten at the end of every phase. History is in [PROGRESS.md](PROGRESS.md); findings are in [AUDIT.md](AUDIT.md). Last updated: 2026-10-01. Phase 13 is done (13a `2c77a8a`, 13b `411b7c2`, 13c `093b127`), as are the GBP connect → pick → bind change (`d8eb400`) and the error reasons (`85ef65d`); all on `master`. **Phase 17 (ranking extras)**, pulled forward for the real ranking pages, is built on `claude/phase-17-ranking-extras`, awaiting merge. Next: **Phase 14 (production readiness)** in plan mode._

## Product goal

**Target product:** [product/frontend-roadmap.pdf](product/frontend-roadmap.pdf). Backend summary: [PRODUCT.md](PRODUCT.md). Screen → endpoint → status for the frontend team: [FRONTEND_BACKEND_MAP.md](FRONTEND_BACKEND_MAP.md).

MyPageSEO is a local SEO reporting platform for US and Canadian businesses, focused only on **Google Maps / Places visibility**. There are three ranking pages, **Rank Tracker**, **Local Search Grid** and **Local Map Ranking**, all powered by one ranking engine and one fixed keyword set per location. There is also a GBP report and GBP posting.

**Out of scope:** organic/website ranking, SerpAPI, third-party keyword search volume (vendor removed 2026-09-27), Moz, and Google Q&A.

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
| 12.5 | Ranking & data quality (full depth, 3 samples 60 s apart, richer competitor data, Map Ranking at 5 points, cost visibility, Google attribution) | done | `claude/phase-12.5-quality` | yes (`c5aee43`) | M5 (pushed 2026-09-27) |
| 10 | Security hardening (all Deferred-P10 items incl. S19, S30, plus the admin auth and roles Phase 16 needs) | done | `claude/phase-10-security` | yes (`3c776fd`) | M5 (pushed 2026-09-27) |
| 8.1 | Email verification by link (CLAUDE.md §12g) | done | `claude/phase-8.1-email-verify` | yes (`604f8d6`) | M5 (pushed 2026-09-27) |
| 16 | Citations: manual, admin-managed tracking, Citation Health, Citation Report (CLAUDE.md §12f; plan: [plans/phase-16-citations.md](plans/phase-16-citations.md)) | done | `claude/phase-16-citations` | yes (`daff461`) | M5 (pushed 2026-09-28) |
| **13** | **Billing & plans** (13a billing, then 13b legacy removal, `/auth` account endpoints, provider interface, admin panel + support; CLAUDE.md §12h; plan: [plans/phase-13-billing-admin.md](plans/phase-13-billing-admin.md)) | done (13a, 13b, 13c) | `claude/phase-13a-billing`, `claude/phase-13b-admin`, `claude/phase-13c-followups` | 13a `2c77a8a`, 13b `411b7c2`, 13c `093b127` | M5 (pushed) |
| 14 | Production readiness | planned | – | – | M5 |
| – | **M5 Launch-ready** (12 + 12.5 + 10 + 8.1 + 16 + 13 + 14 + pre-launch live validation + Google approvals). Phase 16 joined M5 on 2026-09-27: the Citation Report is one of the four mandatory reports, and the admin team needs time to build the directory list. | – | – | – | M5 |
| 9 | GBP reviews & posting (incl. AI review replies) | planned (v4 access granted 2026-10-02) | – | – | – |
| 15 | Notifications & automations | planned | – | – | – |
| 17 | Ranking extras (pulled forward 2026-10-01): grids 3–13 by radius, map pins, change across keyword edits, keyword groups, keyword history, competitor names (max 5), report run dates. CLAUDE.md §12i; plan [plans/phase-17-ranking-extras.md](plans/phase-17-ranking-extras.md) | **built, awaiting merge** | `claude/phase-17-ranking-extras` | – | – |
| – | AI GBP posts (needs GBP v4) · AI visibility · Review management (needs GBP v4) · White-label hosting: groundwork in [plans/upcoming-features.md](plans/upcoming-features.md) | planned, spec pending | – | – | – |
| 9b | Cleanup | ongoing | – | – | – |

**Live test with MyPageSEO:** paused. The connect passed; the rest is blocked on Google (GBP API access), see "Blocked on Google".

`main` is untouched (`62240ac`). There is no Phase 2; security moved to Phase 10.

## Done so far

- **Phase 17 (2026-10-01, awaiting merge):** grids 3×3 to 13×13 set by radius (0.5–15 km; default 7×7 at 8 km), Rank Tracker / Map Ranking points at radius ÷ 2, `RANK_MAX_CALLS_PER_RUN` 40,000 and `GET /tracking/estimate`; Map Ranking pins (`address`, `lat`, `lng`; same Pro price); changes kept across keyword edits on the shared keywords (`comparable_keywords`; CHANGELOG `change_across_keyword_edits`); keyword groups (CRUD, `?group=`, summaries, report section); `GET /keyword-history`; competitor names / addresses / positions (max 5) and names on run targets; `run_at` on report rows. Endpoints 226 → 232. Details: PROGRESS.md "Phase 17".
- **Phase 13b (2026-09-28/29, awaiting merge):** everything legacy the rebuilt product doesn't use is deleted (endpoints 250 → 225: 65 removed, 40 added; no deprecated routes; no data migrations: the launch uses a fresh database with `npm run setup:fresh`); `/auth` sessions and account (refresh rotation, logout, change password, me, deactivate); the Google connect under `/gbp/connect/*`; password reset by link for users and admins (no OTP anywhere) and new admins set their password by link; one email switch (`EMAIL_TRANSPORT`); the payment-provider interface; flaky tests fixed (4/10 failing runs → green); end-to-end flow tests + [FLOWS.md](FLOWS.md); the admin panel backend (overview, users, organizations, admin accounts) and support tickets; the upcoming-features groundwork. Lint 82 → 40 (all in legacy GBP posting). Details: PROGRESS.md "Phase 13b".
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
- **Endpoint docs rule (2026-09-26):** [ENDPOINTS.md](ENDPOINTS.md) lists every current endpoint (220 after Phase 16) and `npm run check:endpoints` (part of `npm test`) fails when it drifts from the code. ROUTES.md is a frozen Phase 1 snapshot. A dev-only popup-connect page `GET /dev/gbp-connect` for the live test.
- **GBP Score + report (7c), offline so far:**
  - **GBP Score** (private): 5 pillars, 26 checks, rescaled when data is missing (`partial`); since 2026-10-02 (version 2) the pillars are completeness, activity, reviews and performance, all four live with v4 on. **Public Score** for the client and competitors alike.
  - **Competitor comparison** (client + tracked + top 3 of the map list) with gap insights; Place Details at most once per monthly cycle per business.
  - `GET /locations/:id/gbp/report?range=28d|90d|12m`, generated by the `gbp-report` job after each sync and rank run (one report per monthly refresh). Locations without GBP get the public parts.
  - `npm run seed:demo-orgs` gives the frontend a full report with no key.
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
- **Ranking & data quality (Phase 12.5), offline:**
  - Full-depth searches (up to 60 results) at every point, every point's full list stored; repeated sampling with median ranks (3 samples 60 s apart, from the variance test).
  - Map Ranking at the center and N/S/E/W; competitor reviews (with authors) and photo counts; two new insights.
  - Cluster-wide Places limit (8/s), long-run safety (expected duration, heartbeat), `RANK_MAX_CALLS_PER_RUN` 16,000.
  - Usage ledger for every Google call, `api_usage` in `/organization/usage`, `npm run cost:report`; Google attribution in responses, PDFs and share pages.
- **Security hardening (Phase 10), offline:**
  - Platform admins: separate admin token secret, roles → permissions (incl. `citations.manage` for Phase 16), every admin-only route guarded and tested from ENDPOINTS.md.
  - Transport: trust proxy, full helmet, no wildcard CORS, 1 MB bodies, uploads only on 5 routes after auth, no path traversal, operator-key sanitiser, PayPal webhook verification.
  - Tokens: revocable user and admin sessions, 1-day access tokens, hardened legacy OTP / reset flows; no secrets or payloads in logs.
- **Email verification by link (Phase 8.1):**
  - a 24 h link at signup; login is blocked (403 `email_not_verified`) until the email is verified
  - resend invalidates older links
  - an hourly job deletes unverified signups after 24 h (and their empty organization)
  - invitations and password resets verify the email
  - `migrate:email-verified` marks existing users verified; legacy register removed
- **Sanitation pass (2026-09-27):** the editor uses the workspace TypeScript 5.9 (`.vscode/settings.json`), the tsconfigs state their defaults, and the lint script covers every file. PROGRESS.md "Sanitation pass".
- **Citations (Phase 16), offline:**
  - **Admin (platform admins, `citations.view` / `citations.manage`):**
    - the directory master list (CRUD, filters) with CSV import (dry run, all-or-nothing, upsert by domain) and formula-safe export
    - directory categories mapped to the Google business categories
    - per-location lists: suggestions by country, region and category group (also at onboarding completion); checks with server-side NAP mismatch detection; bulk; remove / restore; full history
    - a work queue: unchecked, stale N days, recent
  - **Customers (read-only):** a citation dashboard + table per location (admin names and notes hidden), dashboard blocks and two recommended actions, and the **Citation Report** (+ a Citations part in the Full report; schedules work).
  - **Citation Health** from `src/citations/scoring.config.ts`; the worked example scores 50 (D), and 66 (C) after one NAP fix.
  - **Starter master list:** 50 US / CA directories in 5 category groups (`npm run seed:citation-directories`).
  - **Retired:** the legacy `/citation/*` module (13 routes) and `serpapi`.
- **Billing (Phase 13a), offline (PayPal mocked):**
  - **Model:** monthly = first-location price + (n − 1) × additional-location price, dated prices per currency (USD / CAD), 20-location cap (above: enterprise custom plan), 3 users per paid location, 7-day trial, tokens for manual refreshes.
  - **Gates:** read-only after the trial / grace (402), paid location slots (402 with a prorated quote), enterprise cap (403), user limit (403), plan features (403); the monthly refresh and scheduled reports skip read-only organizations.
  - **Billing page API** (`/billing`, 14 routes) + public `/pricing`: PayPal subscription checkout, sync, cancel, prorated location slots, token packs with coupons, order capture, ledger, billing details, invoices + PDF.
  - **PayPal:** per-subscription price override (no buyer consent needed), renewal snapshot + PATCH 11 days ahead, one-time orders for slots and packs, idempotent webhooks.
  - **Tokens:** manual refresh / run now cost tokens per type; refunded automatically when a refresh fails entirely.
  - **Invoices:** our own numbered PDFs, emailed; manual (invoice) billing with overdue → read-only after grace.
  - **Billing admin** (`/admin/billing`, 30 routes, `billing.read` / `billing.manage`): prices with dates, custom plans, manual subscriptions and comps, trials, tokens, subscriptions, invoices, packs, coupons, legacy links, audit log.
  - **Retired:** the guest checkout, legacy plans / coupons / payment lists, Square, credits (15 routes, 5 models, the `square` package). `migrate:billing` links the legacy PayPal subscriptions.
- **Tests:** 878 pass (94 suites) with no API key and no network. Lint: 82 errors, all legacy (0 in rebuilt code and tests). Build: 0 errors.
- **Endpoints:** 250 (235 live, 14 deprecated, 1 dev-only), all in [ENDPOINTS.md](ENDPOINTS.md).

## Key decisions

| Date | Decision |
|---|---|
| 2026-09-28 | **Fresh database (Mohit):** the production database has no data worth keeping; the launch uses a fresh database and nothing is ever migrated from the old system. All migration scripts and "upgrade old rows" code are removed in 13b step 1; `npm run setup:fresh -- --confirm` sets up an empty database (indexes, reference data, standard billing plan, citation directories, first super admin). 13b step 6 starts with no support tickets. |
| 2026-10-02 | **GBP v4 access granted (Mohit):** Google approved the My Business API v4 for project 1010247538246, and `GBP_V4_ENABLED=true` is set on the server. Reviews, photos and posts sync from the next GBP sync; the GBP Score then uses all four pillars. Also: attribute display names (`display_name`, `group`, `value_labels`) from Google's attribute list, one extra free call per sync. Unblocks Phase 9 (posting) and the upcoming review features. |
| 2026-10-02 | **No ranking data in the GBP report and audit (Mohit):** the GBP Score's Visibility pillar (map rank, top-3 rate) is gone; Visibility + Engagement became **Performance (30)** (impressions trend, actions per 1,000, actions trend). The Public Score is rating + reviews + profile only; `rank_gap` and the Competitor Analysis report's `ranks` section are removed. `score_history` marks the break with `version` (no recompute; fresh database at launch). Added: `profile` section, check / pillar `state` + `counts`, `why_it_matters`, full performance metrics in the GBP Audit PDF. ~~Open: v4 in production~~ **resolved 2026-10-02:** Google granted v4 access and `GBP_V4_ENABLED=true` is set on the server (Mohit). |
| 2026-10-01 | **Disconnect and unbind (Mohit):** disconnecting a Google account **deletes the locations bound through it** (soft delete, as `DELETE /locations/:id`; warning "All the data and locations related to this Google account will be removed if disconnected."; `GET /gbp/connections` names them). Unbinding one location keeps it with status `gbp_disconnected` (+ `gbp_disconnected_at`). Account deletion (`POST /auth/deactivate`) still only unbinds. |
| 2026-10-01 | **Setup-center picker (Mohit):** `GET /places/autocomplete` (Autocomplete (New), regions / postal codes, session token) + `PUT /locations/:id/center { place_id, session }`; real Google calls (no dummy data); a pick counts 1 toward the daily Places limit, keystrokes are rate-limited (120 / user / hour). Cost ≈ $0.013–0.019 per pick at list price (OPERATIONS.md). Also: `center { source, label }` on the location header and each run; `tokens.monthly_grant` / `last_grant_at` / `next_grant_at` on `GET /billing`. |
| 2026-10-01 | **Google connect = connect → pick → bind, per user (Mohit):** up to 3 Google accounts per user, listed on the locations page with Disconnect (superseded the same day: disconnect now deletes that account's locations). In the connect modal the user ticks which of the account's locations to pick; only picks appear on the locations page (`pending_gbp`). Binding happens on the Bind button and is subscription-gated. Unbind no longer removes the Google connection. Replaced: `GET /gbp`, `POST /gbp/bind`, `GET /onboarding/gbp-profiles`, `POST /onboarding/select-profile`. Agency team flows come later. |
| 2026-10-01 | **Clients are an optional grouping (Mohit):** locations and clients are independent (a location without a client, a client without locations); no feature depends on a client. The agency onboarding step `first_client` is removed. |
| 2026-09-29 | **13c (Mohit):** suspended organizations answer **403** `organization_suspended` (402 stays for payment situations); checkout takes a location `quantity` (1 to the plan's cap) so a trial user approves PayPal once. |
| 2026-09-29 | **Password reset by link, no OTP anywhere (Mohit):** users and admins reset by a link (60 min, single use, newer replaces older; `link_expired` / `link_invalid` / `passwords_do_not_match`); a reset marks the email verified and ends every session. A new admin gets a set-password link (72 h) instead of a password by email. Admin accounts moved to `/admin/admins` (deactivate, never delete). New env: `PASSWORD_RESET_TTL_MINUTES`, `ADMIN_FRONTEND_URL`, `ADMIN_SET_PASSWORD_TTL_HOURS`. |
| 2026-09-29 | **One email switch (Mohit):** every email (verification, password reset, invitations, reports, invoices/billing, admin, contact) goes through one service with `EMAIL_TRANSPORT=smtp\|log` (default log in development and test, smtp in production); no per-feature exceptions. Log mode logs the masked recipient and the link. `SUPPORT_EMAIL` replaces a hardcoded contact-form recipient. |
| 2026-09-28 | **Delete, don't deprecate (Mohit):** the frontend is rebuilt from scratch against ENDPOINTS.md, so no backward compatibility is needed for any legacy endpoint or response shape; anything the rebuilt product doesn't use is deleted. 13a approved, merged (`2c77a8a`) and pushed. **13b order:** legacy removal → `/auth` session + account endpoints (legacy `/user/auth` and `/user/profile` deleted) → payment-provider interface → flaky tests → admin panel backend. |
| 2026-09-28 | **Card payments (Mohit):** customers must be able to pay by card without a PayPal account. Sandbox check with US and CA buyers; "PayPal Account Optional" on; PayPal support asked about guest card checkout for subscriptions. Billing code goes behind one payment-provider interface in 13b's first commit (today it calls the PayPal client directly in 8 files). No second provider yet; "Decide before launch" after the sandbox result. |
| 2026-09-28 | **Phase 13a billing model (Mohit):** per location, first location priced higher (first + (n − 1) × additional), standard plan capped at 20 locations (more = enterprise custom plan); dated prices per currency from each organization's next renewal; 3 users per paid location, pooled; 7-day trial then read-only; prorated one-time payments for extra slots; no refunds on removal; tokens (one-time packs) for manual refreshes, monthly refresh free, refund on a failed refresh; custom plans with manual (invoice) billing; no tax; coupons on token packs only; Square, credits and the guest checkout retired. **PayPal (verified):** no PayPal quantity (needs buyer consent) → per-subscription price override PATCHed 11 days before renewal; prorations and packs as Orders v2. **As built:** the renewal job runs every 6 h so a failed PATCH is retried inside the 10-day window; `billing.read` / `billing.manage` for super admin + admin; trial tokens granted at organization creation (default 0). |
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
| 2026-09-27 | **After Phase 12.5 (Mohit):**<br>• **Map Ranking stays at 5 points** (`MAP_RANKING_POINTS=all`); a monthly refresh of ≈ $1.75 (10 keywords) to ≈ $3.35 (20) is accepted: quality first.<br>• **Attribution wording:** Google's policy text "Google Maps" in-app, in PDFs and on share pages.<br>• **Public Score shift** from editorial summaries: accepted; dated in [CHANGELOG.md](CHANGELOG.md) (`public_score_editorial`) for chart markers.<br>• **Sampling:** 3 samples 60 s apart (`RANK_SAMPLES_PER_POINT=3`, `RANK_SAMPLE_SPACING_SEC=60`) from the variance test; the one-time rank shift from medians is dated in CHANGELOG.md (`ranking_median_3x60`).<br>• **Places cap** stays at 8 req/s; Mohit is confirming the 600/min quota in Cloud.<br>• **Prices** in `pricing.ts`: Mohit is checking them against Google's pricing page.<br>• **Citations = Phase 16**, right after Phase 10: manual, admin-managed tracking, no external citation APIs (CLAUDE.md §12f). Phase 10 must include the admin auth and roles it needs.<br>• **Nothing lives only in chat:** every summary with numbers, decisions or setup steps is written into the matching doc in the same commit. |
| 2026-09-27 | **Push after every merged phase** (GitHub is the only off-machine backup). **Maps ToS: accepted risk for now** (stores listed below; Google attribution added in 12.5). **Quality over cost:** about $1 per refresh is acceptable; cost-saving behaviour that lowers data quality is removed in 12.5 (full depth, samples, Map Ranking at 5 points, competitor reviews and photos); no monthly manual-refresh cap (the 24 h guard stays). |
| 2026-09-27 | **Phase 12:** PDFKit (pure Node) over headless Chrome: small RAM, no Chromium per pm2 instance, no system packages. Reports are frozen snapshots (branding and logo included). White-label is agency-only. Schedules fire once per monthly auto-refresh cycle per location (not on manual refreshes). Share tokens are hashed, shown once and redacted from logs. Legacy white-label routes deprecated, not deleted. |
| 2026-09-27 | **Phase 8.1:** email verification by link (not a code), valid 24 h. Unverified accounts get no tokens and are deleted after 24 h. Only 8.1 signups carry the deadline, so older accounts can never be deleted. Legacy `/user/auth/register` removed (disabled rather than ported). |
| 2026-09-27 | **Phase 16 in M5** (the Citation Report is one of the four mandatory reports). **Plan approved, then build paused** by Mohit; resume from [plans/phase-16-citations.md](plans/phase-16-citations.md). Decisions in the plan: retire the legacy citation module and `serpapi`; `citations.view` + `citations.manage`; directory category groups; score defaults; CSV via `csv-parse` / `csv-stringify`. |
| 2026-09-27 | **Tooling:** the editor uses the workspace TypeScript (5.9.3), not VS Code's bundled 6.0. The lint baseline is corrected to 169 legacy errors (the old script skipped nested folders). The TypeScript 7 move is backlog. |
| 2026-09-27 | **Phase 16 (Mohit, on resume):** retire the whole legacy `/citation/*` module and `serpapi` (incl. its old-Places-API call); keep the old order model (`LegacyLocationCitation`) for the credit-payment code until Phase 13; a new `citations.view` permission beside `citations.manage`; the score defaults of the worked example (50 → D, 66 → C after one NAP fix), tunable in `scoring.config.ts`; `csv-parse` / `csv-stringify`. As built: `live_correct` with a NAP mismatch needs `confirm`; customers see "MyPageSEO team" and never internal notes; suggestions never remove anything. |
| 2026-09-27 | **Phase 11 / M4:** dashboards read stored per-location summaries only (`Location.summary`, written after runs and reports); team management is owner-only; accepting an invitation as an existing account doesn't log in; invitation tokens travel in the body and are stored hashed; in development the invitation link is logged with the email masked. |

## Open items (owner: Mohit)

1. **Push policy:** since Phase 12, every merged phase is pushed (Mohit runs the merge and push commands given at the end of each phase).
2. **Share links:** `SHARE_BASE_URL` is set locally (2026-09-27). In production set it to the public API origin and let nginx forward `/r/` to the app.
3. **Google Cloud:**
   - Add the **Authorised JavaScript origins** to the OAuth client: the frontend's, and `http://localhost:5055` for the dev test page.
   - `.env`: `TOKEN_ENCRYPTION_KEY` (currently empty, so connecting would fail) and, for the redirect fallback only, `GOOGLE_GBP_REDIRECT_URI` on port 5055 (currently 5000).
4. **Live steps, when you say so:** the GBP live test (see "Next up"). The variance test is done (2026-09-27); an optional rerun of the 10-minute spacing: `npm run variance:test -- --confirm-live --spacings=600` (90 calls).
   - **Price check (Mohit, pending):** `src/configs/pricing.ts` against Google's pricing page; send corrections.
   - **Quota check (Mohit, pending):** Places API (New) Text Search and Place Details at ≥ 600 requests/minute in Cloud (the 8 req/s cap assumes it).
   - **Google Cloud checklist** (OPERATIONS.md, "Ranking quality, Google API usage and cost"): budget alerts, quotas ≥ 600/min, key restrictions.
   - **Dallas test + formal `calibrate:score` (Mohit, pending):** see "Pre-launch live validation" below.
5. **Google approvals:** GBP API access (approved 2026-10-01), Google My Business API v4 (approved 2026-10-02), OAuth app verification (pending). See "Blocked on Google" below.
6. **Frontend:** follow [FRONTEND_BACKEND_MAP.md](FRONTEND_BACKEND_MAP.md) and [FLOWS.md](FLOWS.md). Google connect: the modal lists one account's locations to pick; picks show on the locations page with a Bind button (API.md "Connected accounts, the connect modal and the Bind button").
7. **Maps ToS: accepted risk for now**, revisit before launch: see "Maps ToS: accepted risk" below.
8. **DataForSEO password change by the account owner (old credential in git history)** (AUDIT S13). The vendor was removed from the code, config and docs on 2026-09-27.
9. **First deploy:** a fresh database set up with `npm run setup:fresh -- --confirm` (OPERATIONS.md "Deploy checklist"); secrets `JWT_SECRET` / `ADMIN_JWT_SECRET` (≥ 32 characters), `TOKEN_ENCRYPTION_KEY`, `ACCESSDOMAINS`, `FRONTEND_URL`, `SHARE_BASE_URL`, `SUPER_ADMIN_EMAIL`, the PayPal variables.
10. **Frontend team notes** (Phase 10): token refresh (1-day access, 30-day refresh), admin panel sign-in and permissions, CORS origins: FRONTEND_BACKEND_MAP.md "Notes for the frontend team".
11. **Prices, before launch (Mohit, 2026-09-28):** set in the billing admin (Phase 13a):
    - the first-location and additional-location prices per currency (`POST /admin/billing/plans/:planId/prices`); until then checkout answers 409 `price_not_set`
    - the token packs (`POST /admin/billing/token-packs`)
    - the token cost per manual refresh type (`PATCH /admin/billing/plans/:planId` → `tokens_per_refresh`; default 1 each) and the trial token allowance (default 0)
13. **PayPal (Phase 13a), when you say so:**
    - **Account settings first:** turn on "PayPal Account Optional", and ask PayPal support to enable guest (card) checkout for subscriptions (OPERATIONS.md "PayPal setup", step 0).
    - Give sandbox credentials, then run `npm run billing:paypal-setup -- --confirm` and set up the webhook.
    - Then run the sandbox test: subscribe, renew, add a slot, buy a pack, cancel, and the **card-without-PayPal-account check** with a US and a Canadian buyer. Record the result below in "Decide before launch".
    - Confirm that the account receives USD and CAD.
    - No live PayPal call has been made yet.
14. **Seller details on invoices:** set `BILLING_SELLER_NAME`, `BILLING_SELLER_ADDRESS` (lines separated by `|`), `BILLING_SELLER_EMAIL` and optionally `BILLING_SELLER_TAX_ID` before the first real invoice.
12. **Citation directory authority values:** the 50 seeded directories (`seed:citation-directories`) carry **placeholder** authority numbers; the admin team replaces them before launch.
15. ~~Checkout quantity~~: **done in 13c** (Mohit, 2026-09-29): `POST /billing/checkout { quantity }`.
16. **Google Cloud + `.env` after 13b:** the GBP redirect-fallback URI moved to `…/api/v1/gbp/connect/callback`: update `GOOGLE_GBP_REDIRECT_URI` in `.env` and the authorised redirect URI in Google Cloud (the popup flow is unaffected). New settings: `ADMIN_FRONTEND_URL`, `SUPPORT_EMAIL`, `EMAIL_TRANSPORT` (OPERATIONS.md).

## Blocked on Google

| Item | State | What unblocks it | Then |
|---|---|---|---|
| **Business Profile API access** (Account Management, Business Information, Performance, Verifications) for Cloud project `1010247538246` | **Approved** (Mohit, 2026-10-01: "all GBP keys are working"; the backend runs on the server, the frontend is tested from localhost:3000). | – | The GBP live test, first syncs and the 7c scoring calibration can run on real data. |
| **Google My Business API v4** (reviews, media, posts) | **Approved** (Mohit, 2026-10-02); `GBP_V4_ENABLED=true` on the server | – | Reviews, photos and posts sync; Phase 9 posting becomes possible. Set `GBP_V4_ENABLED=true` in a local `.env` too to see them locally. |
| **OAuth app verification** (the "Google hasn't verified this app" screen, and the test-user limit while in testing mode) | Not started | Google verifies the OAuth consent screen (`business.manage` is a sensitive scope) | Needed before real customers connect. |

## Maps ToS: accepted risk

**Accepted risk (Mohit, 2026-09-27), revisit before launch.** Places content is stored and shown as below. Mitigation (Phase 12.5): Google attribution, wording "Google Maps" (Mohit, 2026-09-27), wherever it appears. Switching to IDs-only storage later is a known task: each store below would keep only `place_id`s and resolve names at view time (the Phase 5 `resolveNames` path shows how).

| # | Store | Places content | Kept for |
|---|---|---|---|
| 1 | `RankRun.mapList[].results[].name` (`STORE_PLACE_NAMES=true`; 12.5 adds the 4 compass points) | business names from the Pro Text Search | run history (forever) |
| 2 | `Location.competitor_suggestions` | names, addresses, ratings, review counts (Enterprise Text Search) | 24 h per keyword set |
| 3 | `GbpReport.competitors.rows` | Place Details: name, rating, review count, type, hours/website/phone flags, status; 12.5 adds up to 5 reviews (with author attribution) and a photo count | latest report only (overwritten) |
| 4 | `Location.summary` (`key_competitor.name`, `rating`, `review_count`) | names and the client's public rating | until the next run or report |
| 5 | `ReportSnapshot` + report PDFs (+ share pages `/r/<token>`) | frozen copies of 1, 3 and 4 | `REPORT_RETENTION_MONTHS` (24) |
| 6 | `Location` name, address, coordinates for locations added from a Places search, and the manual center | Place Details / Text Search | the location's lifetime |

## Decide before launch

**Card payments without a PayPal account (Mohit, 2026-09-28).** Customers must be able to pay by card without creating a PayPal account; a PayPal sign-up at checkout is not acceptable for a normal SaaS experience.
- **Decision:** is PayPal alone enough for card payments? Decided from the sandbox result below and PayPal support's answer.
  - If a card option works as a guest for **both** the subscription and the one-time orders, in the US and Canada: PayPal alone.
  - Otherwise: add a second payment provider for cards. The billing code will talk to payments only through one provider interface (13b's first commit), so a second provider is an addition, not a rewrite. Which provider, and whether it replaces or sits beside PayPal, is decided then.
- **PayPal support ticket** (guest card checkout for subscriptions): not opened yet.
- **Sandbox result:** not run yet (no sandbox credentials).

  | Flow | US buyer, card, no login | CA buyer, card, no login |
  |---|---|---|
  | (a) subscription checkout | not tested | not tested |
  | (b) token pack | not tested | not tested |
  | (b) extra location slots | not tested | not tested |

## What remains legacy (final audit, 13b, 2026-09-29)

Every model, route, service, helper, constant, env var, package and script was checked against the rebuilt product (knip for unused files, exports and packages; a per-export reference scan; `.env.example` against the code). Everything unused was deleted (LEGACY_FEATURES.md "Removed in Phase 13b"). What is still legacy code, and why it stays:

- **Legacy GBP posting** (`/gbp/post/*`, `gbpPostSchedular.*`, `jobs/postToGbp.ts`, `GBPPost`, and the `/images` and `/videos` file routes for uploads): rebuilt in Phase 9 (needs GBP v4). All 40 remaining lint errors are here.
- **Reference data** (countries, states, cities, languages, time zones, business categories: models, read routes, admin edits of business categories): used by signup, onboarding and citations; kept by decision.
- **Blog and blog categories, FAQ, contact form** (routes, models, services in the legacy style with `mongoFunctions`): kept by decision; they work and are guarded (Phase 10).
- **`/api/healthcheck` and `/ping`:** infrastructure checks (Phase 14 decides which one the monitoring uses).
- **The PayPal webhook path `/subscription/paypal/webhook`:** new handlers (13a) on the path registered at PayPal.

Nothing else is legacy: every other route is rebuilt or new (ENDPOINTS.md "By origin").

## Pre-launch live validation (Mohit triggers it)

Required for M5; not part of Phase 12.5's build:
- **Big-market test (Dallas):** Workman Plumbing (`ChIJjcMu_6CZToYRXut5OjLd6V4`, 2310 N Henderson Ave #522, 32.814438, -96.777703; the "#522" may be a mailbox suite, so confirm the storefront first). Keywords "plumber", "emergency plumber", "plumber dallas", 3×3 at 1.5 km.
- **Formal `calibrate:score`:** fill in the manual columns (tracker rows are enough: `--tracker-only`) and record the verdict.
- ~~The Phase 12.5 variance test~~ **done 2026-09-27** (0 s: 90 % identical, max spread 2; 60 s: 80 %, max spread 5; 10 min not completed) → 3 samples 60 s apart. See `docs/calibration/variance-2026-09-27.md`.

## Backlog (not now)

- **Phase 17 leftovers:** larger grids make monthly runs longer (13×13 at 20 keywords ≈ 65 min at 8 queries/s, shared by the whole server): watch the monthly queue once real customers use big grids. Competitor details for a competitor saved without a key or over the daily limit stay empty until a later save or a Map Ranking hit.

- **TypeScript 7 readiness** (9b / 14): `moduleResolution: node` is removed in TS 7; the node16 move and the two dynamic imports are described in OPERATIONS.md "Lint and editor setup".
- **Legacy lint debt:** 40 ESLint errors, all in legacy GBP posting (169 when first measured on 2026-09-27; Phase 16 removed 32, 13a 55, 13b 42). They go when Phase 9 rebuilds posting.
- (The Dallas test, the formal `calibrate:score` and the variance test moved to "Pre-launch live validation" and Phase 12.5.)
- **Test requests use `[::1]`** (13b flaky-test fix, `tests/setupAfterEnv.ts`): revisit if tests run somewhere without IPv6 (e.g. a CI container with IPv6 disabled).
- **Overall-average UX:** when one keyword is 60+ everywhere it counts as 61 and dominates `overallAvgRank` (Round 1: 31.2 from 1.4 and 61). Decide how the page explains or presents it.

## Next up

1. **Merge and push Phase 17** (commands in PROGRESS.md "Phase 17"); the first real large-grid run (e.g. 7×7 at 8 km) is Mohit's.
2. **Phase 14 (production readiness)** in plan mode: fresh server (MongoDB, backups, nginx, pm2, log rotation, error monitoring, alerts), the deploy-checklist dry run with `setup:fresh`, Maps ToS decisions. Before launch: prices (open item 11), the PayPal sandbox test (open item 13), the redirect URI change (open item 16).
3. **Pre-launch live validation** (Mohit triggers it): the Dallas test and a formal `calibrate:score`.
4. **When Mohit says "GBP access approved":** resume the live test at `npm run gbp:preflight -- 6ab76e2c99cf66c2cc414a13`, then pick and bind (`PUT /gbp/connections/:googleSub/picks`, `POST /gbp/picks/:pickId/bind`), first sync (`POST /locations/6ab76e2c99cf66c2cc414a18/refresh {"types":["gbp"]}`), `GET …/gbp/sync`, the report (GBP_CONNECT.md §6) and the **scoring calibration** (PROGRESS.md, 7c). The connection is saved; no reconnect needed.
5. **Upcoming features** (AI GBP posts, AI visibility, review management, white-label hosting): specs pending from Mohit; groundwork in [plans/upcoming-features.md](plans/upcoming-features.md).

**Frontend:** build against [FRONTEND_BACKEND_MAP.md](FRONTEND_BACKEND_MAP.md) and [FLOWS.md](FLOWS.md). Screens marked "not supported" must not be built.

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
| Big picture: what works, what doesn't, what's left | [PROJECT_SUMMARY.md](PROJECT_SUMMARY.md) |
| Approved plans not built yet | [plans/](plans/) |
| Methodology changes (dates for chart markers) | [CHANGELOG.md](CHANGELOG.md) |
| History and commit hashes | [PROGRESS.md](PROGRESS.md) |
| Findings and their status | [AUDIT.md](AUDIT.md) |
| Endpoints (current) | [ENDPOINTS.md](ENDPOINTS.md); [ROUTES.md](ROUTES.md) is the frozen Phase 1 snapshot |
| Rules and phase specs ("as built" notes) | [CLAUDE.md](../CLAUDE.md) |
