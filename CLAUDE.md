# CLAUDE.md — MyPageSEO backend (mps-backend-merged)

**Session start: read `docs/STATUS.md` first (current state + next step), then this file. Update `STATUS.md` at the end of every phase.**

Read this whole file at the start of every session. It defines what the product is, what you may and may not touch, and the exact order of work. Work **bottom to top**: foundations first, features after. Never skip a phase gate.

---

## 0. Product intent (what we are building)

MyPageSEO is a **Local SEO management platform** for US and Canadian **businesses and agencies** (Organization → Clients (agency) → Locations → modules). It is about **Google Maps / Google Business Profile visibility only**. Website (organic) SEO is permanently out of scope.

- **Target product:** `docs/product/frontend-roadmap.pdf` (screens and flows). Backend summary: `docs/PRODUCT.md`. Screen-by-screen backend status: `docs/FRONTEND_BACKEND_MAP.md`. Line up with the roadmap, but **never invent data the backend can't provide**. The "not supported" list is in both docs.
- **A location is one business on Google Maps (usually a GBP), and every location has a Google `place_id`.**
  - It can be added only via **(a) Connect GBP → pick a profile** or **(b) Places search → pick a result** (one Place Details call, minimal fields). **No manual entry.**
  - `source: "gbp" | "places_search"`, `gbp_connected: boolean`.
  - A (b) location may bind its GBP later, matched by `place_id`; a differing `place_id` is refused.
  - Without GBP: rankings and the public competitor comparison work, and private GBP sections return `{ available: false, reason: "gbp_not_connected" }`.
  - The same `place_id` can't be added twice in one organization.
- **Data cadence:** a monthly automatic refresh per location (rank run → GBP sync if bound → GBP report), staggered on the day of the month the location finished setup (clamped to 28) at about 03:00 local time. A manual refresh (`POST /locations/:id/refresh`) is allowed once per 24 h per type. `tracking.frequency` is `auto_monthly | manual_only`.

Deliverables of this rebuild:

1. **Rank Tracker page**: average Maps rank per keyword and overall, from a small set of points around the business.
2. **Local Search Grid page**: rank heatmap per keyword over a 3×3 / 5×5 / 7×7 grid.
3. **Local Map Ranking page**: "who ranks at your location", the top 20 businesses per keyword at the business location, with the client highlighted.
4. **GBP Report page**: the client's Google Business Profile performance, profile health, reviews, search keywords, and a competitor comparison.
5. **Auth, Organization, Onboarding & Locations** (Phase 8): Business vs Agency signup, organization, plan limits, clients, the unified "add location" flow, the locations list and the location overview.
6. **GBP Posting** (Phase 9): create, schedule and manage posts (existing feature, to be rebuilt; needs GBP v4 access).

All three ranking pages are powered by **one ranking engine** and **one fixed keyword set per location**. Ranking uses **Google Places API (New) Text Search**, not SerpAPI.

---

## 1. Scope

### IN scope (you may modify)
- Ranking: rank tracker, local search grid, local map ranking (models, routes, middlewares, controllers, services, helpers).
- GBP: OAuth connection, GBP data sync, GBP audit/report, GBP posting, related jobs.
- Location model: only the additions defined in this file.
- Shared infrastructure these features need: config, Google API clients, agenda jobs, logging, tests.
- Security fixes, **only in Phase 10 and only after explicit approval** (see §13a). Exception: Phase 6 builds the signed OAuth state and encrypted token storage as part of GBP.

### OUT of scope (do not modify, do not refactor, do not reformat)
- Citations (all `citation*` files and models), blog, blog categories, FAQ, support, contact-us, white-label, countries/states/cities, languages, timezones, roles, business categories.
- Payments and subscriptions (Square, PayPal, Razorpay, coupons, plans, credits), **except** the security items listed in Phase 10 if approved.
- Admin panel features, except the Phase 10 security items if approved.

If an in-scope change *requires* touching an out-of-scope file (e.g. a shared util or `src/models/index.ts` export), make the smallest possible change and call it out explicitly in the phase summary.

### Permanently removed from product
- Organic/website ranking (desktop/mobile organic), DataForSEO search volume, Moz, SerpAPI-based ranking, Search Console "average position" helpers.
- Google Q&A (the Q&A API was discontinued on 2025-11-03; do not implement anything Q&A).

---

## 2. Working rules (apply to every phase)

### Git
- Base branch for all work: `claude/rebuild`. One sub-branch per phase: `claude/phase-<n>-<slug>`, created from `claude/rebuild`.
- Commit freely on `claude/phase-*` branches. Never commit to or push `main`.
- At the end of each phase, ask Mohit to approve the local merge into `claude/rebuild` (`git merge --no-ff`), giving him the exact command. Mohit runs it or grants permission. Do not push.
- Push only at milestones, and only when Mohit says so:
  - **M1:** after Phase 3 (Foundations).
  - **M2:** after Phase 5 (Ranking reports: all three pages working).
  - **M3:** after Phase 7c (GBP sync + report).
  - **M4:** to be agreed with Mohit (previously "after cleanup"; the phase order changed on 2026-09-26).
- At a milestone, give Mohit one push command covering `claude/rebuild` and every phase branch since the last milestone, plus a short summary for his developers.
- Small commits, one concern each. Message format: `<phase>: <area>: <what>` e.g. `p4: ranking: add IDs-only text search client`.
- Never rewrite history on shared branches. Never force-push `claude/rebuild`.
- The old code is backed up separately by Mohit. Deleting old in-scope code is allowed **only in the phase that explicitly says so**.

### Environment & safety
- Work only against a **local MongoDB** and a local `.env`. Never use production credentials, never connect to production DB, never SSH anywhere.
- Never print, log, or commit secrets. Never hardcode credentials (the old code has a hardcoded DataForSEO login; that pattern is banned).
- API keys used during development must be **test keys with low quotas/budget caps**. If a required key is missing, stop and ask; do not stub a real-looking key.
- **Real Google calls only when Mohit says so, within the budget he gives.**
  - Mohit's local `.env` has a Places API (New) key (since Phase 5.5) and the GBP OAuth client. Never print, log or commit them.
  - The only live runs so far are the Phase 5.5 Fredericton validation (106 IDs-only, 7 Pro, 3 Details calls). Report call counts after every live step.
  - All unit and integration tests use mocked clients and fixtures and must pass with no key.
  - GBP live steps (connect, `gbp:preflight`, select-profile, sync) are triggered by Mohit.
- When calling real Google APIs during development: max **2 keywords**, **3×3 grid**, **1 location** per test run. Log how many API calls each test run made.

### Quality gates (every commit)
- `npm run build` passes with zero TypeScript errors in files you touched.
- `npm run lint` passes for files you touched (don't mass-fix out-of-scope files).
- `npm test` passes with no `GOOGLE_PLACE_API_KEY` set.
- New pure logic (ranking math, matching, change calculation, health score, grid generation) has unit tests.
- External API calls are wrapped in a client module that can be mocked; unit tests never hit the network.

### Endpoint docs never go stale (Mohit, 2026-09-26)
- `docs/ENDPOINTS.md` is the single source of truth for every **current** endpoint: method, path, auth, purpose, phase added, status (`live | behind flag | deprecated | dev only`).
- `docs/API.md` keeps the request/response examples for the new endpoints.
- `docs/ROUTES.md` is a frozen Phase 1 snapshot. Don't update it.
- **Every commit that adds, changes or removes an endpoint updates ENDPOINTS.md in the same commit**, and API.md too when a request or response shape changes.
- `npm run check:endpoints` (`tests/docs/endpoints.test.ts`, part of `npm test`) loads the Express app, lists every registered route and compares it with the ENDPOINTS.md catalogue. It fails on a route missing from the doc, a doc row with no route, or a detail row (`#`) missing from the catalogue. Dev-only routes are mounted only when `NODE_ENV=development`.

### Phase gates
Phase order (revised by Mohit, 2026-09-26): 1 → 1.5 → 1.6 → 3 Foundations → 4 Ranking engine → 5 Ranking reports → 6 GBP connection → 7a Connect + onboarding → 9a Legacy cleanup (done early) → **7b GBP sync (monthly)** → live test with MyPageSEO → **7c Scoring + report + competitors (M3)** → **8 Auth, Organization, Onboarding & Locations** → 9 GBP posting (needs v4) → 9b Remaining cleanup → 10 Security (gated). After Phase 8 the next feature is chosen with Mohit; don't plan beyond Phase 8. There is no Phase 2: security was deferred and moved to Phase 10 (decision by Mohit, 2026-09-25).

At the end of every phase:
1. Stop.
2. Write/update `docs/PROGRESS.md` with: what changed, files touched, decisions made, open questions, API calls consumed.
3. Check that `docs/ENDPOINTS.md` (and `docs/API.md`) match every endpoint added, changed or removed in the phase, and that `npm run check:endpoints` passes.
4. Summarise to Mohit and **wait for approval** before starting the next phase.

Use plan mode before each phase: show the plan and the list of files to create/modify/delete, and wait for approval.

### Code conventions (match the existing repo)
- Layering: `routes → middlewares → controllers → services → helpers/clients → models`.
- Controllers use `catchAsync`, `pick`, `responseWrapper`. Errors use `ApiError` with `http-status` codes.
- TypeScript strictness: new code must be fully typed. No `any` in new code except at raw API-response boundaries, which must be immediately mapped to typed interfaces.
- Line endings: LF everywhere (enforced by .gitattributes, .editorconfig, Prettier). Never commit CRLF.
- Log with the existing winston `logger`, never `console.log`. Never log tokens, API keys, or full third-party payloads.

---

## 3. Repository map (facts, verified)

- Entry: `index.ts` → `src/server.ts` → `src/app.ts`. Routes mounted at `/api/v1` from `src/routes/v1/index.ts` (common, admin, user route groups).
- Mongo + agenda: agenda lives in `src/configs/agenda.ts` (own MongoDB connection, processEvery 1 minute) and is re-exported by `src/configs/mongoConnection.ts`. Jobs are registered in `src/jobs/index.ts` (`defineAllJobs`) and agenda is started from `src/server.ts` after `listen`. New jobs use `src/jobs/defineJob.ts` (`defineJob` / `scheduleJob`, IDs-only data). The only job before Phase 5 is `post-to-gbp` (`src/jobs/postToGbp.ts`). Local database: `mps_rebuild` (see `docs/OPERATIONS.md`).
- Ranking API (Phase 5): `/api/v1/locations/:locationId/{tracking,rank-runs,rank-tracker,grid,map-ranking}` (see `docs/ENDPOINTS.md`, examples in `docs/API.md`). Jobs `rank-run`, `gbp-sync`, `gbp-report` (7c) and `monthly-refresh` (7b; `rank-scheduler` removed). Model `RankRun` (`rank_runs`) and `Location.tracking`.
- **Clients:**
  - `src/clients/http.ts`: transport, 15 s timeout, 1 retry, safe errors with ErrorInfo `reason` and `quota_limit_value`.
  - `src/clients/placesClient.ts`: Places API (New). Each search has a guarded field mask: IDs-only for ranking, Pro names for Map Ranking, Enterprise for competitor suggestions, Pro names and addresses for manual search. Plus Place Details. `createPlacesClient()` is for tests; `placesClient` is the default instance.
  - `src/clients/gbpClient.ts`: GBP and OAuth; ≤ `GBP_MAX_RPS`; refresh and rotation persisted; quota-0 and disabled-API errors.
- **GBP (Phases 6–7a):** `src/services/gbp/` (`tokenStore`, `oauth.service` with popup and redirect, `idToken`, `discovery.service`, `binding.service`, `errors`).
- **Onboarding (7a):** `src/services/onboarding/` (state, select-profile, suggestions, manual search, daily Places cap, steps). Routes: `/onboarding/*`, `/places/search`, `/locations/:id/competitor-suggestions`.
- **Scripts:** `seed:rank-demo`, `smoke:places`, `smoke:agenda`, `find:place`, `setup:live-test [--token-only]`, `calibrate`, `calibrate:score`, `gbp:preflight`, `gbp:encrypt-tokens` (see `docs/OPERATIONS.md`, `docs/LIVE_TEST.md`, `docs/GBP_CONNECT.md`).
- **Live-test data** (local `mps_rebuild`): user `live-test@mypageseo.test` (id `6ab76e2c99cf66c2cc414a13`); location MyPageSEO Fredericton (id `6ab76e2c99cf66c2cc414a18`, place `ChIJneho2koPp0wRIbUtaCCIReA`).
- Tests: `tests/` mirrors `src/`; fixtures in `tests/fixtures/`; helpers `tests/helpers/fakeTransport.ts` and `memoryMongo.ts`.
- Production runs via pm2 with `instances: "max"` (cluster mode). Anything using in-memory state (node-cache, rate-limit memory store, node-cron) runs once **per instance**. Jobs must use agenda (Mongo-locked), never node-cron.
- Config: `src/configs/config.ts` (Joi-validated env, loaded from `ENV_FILE` if set, else `./.env` in the working directory; see `docs/OPERATIONS.md`). Places key is `GOOGLE_PLACE_API_KEY` → `config.googleApis.placeApi.keySecret`.
- OAuth (Phases 6–7a): GBP connect is `src/services/gbp/oauth.service.ts`. It has a GIS popup flow plus a redirect fallback, a one-time hashed state in `OAuthState` (`flow` popup/redirect), scopes `openid email business.manage`, and a verified id_token whose `google_email` is stored. All GBP calls go through `src/clients/gbpClient.ts` (≤ `GBP_MAX_RPS`, refresh + rotation persisted). Tokens live in `UserAuth`, one active row per `(user_id, token_type)`, via `src/services/gbp/tokenStore.ts`: **GBP tokens are AES-256-GCM encrypted** (`TOKEN_ENCRYPTION_KEY`), Search Console tokens are still plaintext. `src/configs/oAuth2Client.ts` is used only by the Search Console flow; `configs/gbpOauthClinet.ts` is unused (Phase 9). GBP binding in `UserGBP` (`gbpAccountId`, `gbpLocationId`, `place_id`), via `src/services/gbp/binding.service.ts`.
- Location model (`src/models/location.model.ts`): `name, address, city, state, country, zip_code, lat, lng, mobile, place_id, website_URL, business_category, client_id, created_by, is_active`.
- Old ranking, GBP audit, Reputation Manager, white-label report links and the Search Console connect were **removed** in the legacy cleanup (branch `claude/phase-9a-legacy-cleanup`); see `docs/LEGACY_FEATURES.md` (last commit with that code: `1695187`) and `docs/MIGRATION.md` (unused collections, removed env vars).
- GBP posting (legacy, kept until Phase 8): `services/common/gbpPostSchedular.service.ts` + `jobs/postToGbp.ts` (v4 localPosts + agenda). Its token comes from `gbpClient` through the binding's connection.

---

## 4. Domain definitions (single source of truth)

### Ranking
- **Search surface**: Places API (New) Text Search. Treated as the proxy for Google Maps local ranking.
- **Rank**: 1-based index of the target `place_id` in the result list (honour `movedPlaceId`). Max measurable rank = **60**.
- **RankCell**: `{ rank: number | null, status: 'ok' | 'not_found' | 'error' }`.
  - `ok`: found, rank 1–60.
  - `not_found`: search succeeded, target not in top 60. Displayed as **"60+"**.
  - `error`: search failed after 1 retry. Excluded from all averages. Never displayed as 60+.
- **avgRank** (per keyword): mean over non-error cells, `not_found` counted as **61**. 1 decimal.
- **foundRate**: share of non-error cells with status `ok`. 2 decimals.
- **top3Rate**: share of non-error cells with rank ≤ 3. 2 decimals.
- **overallAvgRank**: mean of keyword avgRanks (unweighted). 1 decimal.
- **Change vs previous run**: only computed when both runs have the **identical keyword set** (same `keywords_version`). Otherwise every change is `null`.
  - **Per cell** (one target at one point, `cellChange`):
    - Both `ok`: `change = previous - current` (positive = improved), labelled `improved`, `declined` or `unchanged`.
    - `not_found → ok`: label `entered_top_60`, no numeric change.
    - `ok → not_found`: label `dropped_out_of_top_60`, no numeric change.
    - Either side `error`, or both `not_found`: `change = null`, no label.
  - **Per keyword** (one target's keyword summary, `keywordChange`; accepted by Mohit 2026-09-26):
    - `foundRate` went from 0 (not found at any point) to > 0: label `entered_top_60`, no numeric change.
    - `foundRate` went from > 0 to 0: label `dropped_out_of_top_60`, no numeric change.
    - Otherwise `change = previous avgRank - current avgRank` (1 decimal), labelled `improved`, `declined` or `unchanged`.
    - Either summary all-`error` (`avgRank` null), or no comparable previous run: `change = null`, no label.
  - **Overall**: `change = previous overallAvgRank - current overallAvgRank` (1 decimal), or `null`.
- **Rank buckets (for UI)**: 1–3 `pack`, 4–10 `visible`, 11–20 `low`, 21–60 `invisible`, 60+ `not_found`, `error`.

### Sample points
- **Rank Tracker points**: center + 4 compass points at `offsetKm = 1.5` (N, S, E, W). 5 points total.
- **Grid points**: `generateGrid(center, size ∈ {3,5,7}, spacingKm)`. Center point is always included.
- **Center**: location `lat/lng`. If missing, resolve once from `place_id` via Place Details (field `location`) and save to the Location.
- Every Text Search uses `locationBias.circle` centered on the sample point, radius **5000 m** (configurable), `regionCode` from the location country (`US → us`, `Canada → ca`).

### Keywords
- Fixed per location: `location.tracking.keywords` (max **20**, trimmed, lowercased for comparison, de-duplicated, original casing kept for display).
- Editing keywords increments `keywords_version` and sets `keywords_updated_at`. Change calculations never compare across versions.

### Refresh cadence (Mohit, 2026-09-26)
- `location.tracking.frequency`: **`auto_monthly`** (default) | **`manual_only`**. This replaces `weekly | monthly | manual`; existing values are migrated (`weekly`/`monthly` → `auto_monthly`, `manual` → `manual_only`).
- **Monthly refresh:** one cluster-safe `monthly-refresh` scheduler enqueues, per due location, a `rank-run` and (if GBP-bound) a `gbp-sync`. The GBP report is generated after the sync.
  - The due date is the day of the month setup completed (clamped to 28), at about 03:00 in the location's timezone (UTC fallback).
- **Manual refresh:** `POST /locations/:id/refresh { types?: ["rankings","gbp"] }` reuses the one-active-run guards.
  - Limited to once per `REFRESH_MIN_INTERVAL_HOURS` (default 24) per location per type.
  - It returns ids, estimated calls and `next_allowed_at`.

### Competitors
- `location.tracking.competitors`: array of `place_id` (max 5), plus, for the GBP report, the top 3 non-client results from the latest `mapList` center search.
- Competitor ranks come from the **same** result lists as the client (no extra API calls).

---

## 5. PHASE 1 — Full codebase audit (read-only)

**Goal:** understand the entire codebase and record every finding before anything is changed. **No code modifications in this phase** (only create `docs/`).

### Steps
1. Run `npm install`, `npm run build`, `npm run lint`. Record baseline errors/warnings counts (don't fix).
2. Read **every** file under `src/`, plus `package.json`, `ecosystem.config.json`, `nodemon.json`, `.gitignore`, `swagger.json`.
3. Produce `docs/AUDIT.md` with these sections:
   1. **Architecture map**: every route (method + full path), its middlewares (in order), controller, service, models used, and whether it requires user auth, admin auth, or none. Output as a table.
   2. **Data model inventory**: every model, fields, indexes, and which features use it.
   3. **External integrations**: every outbound HTTP call (URL/host, which file, which key/credential, paid or free, called on request path or in a job).
   4. **Jobs & scheduling**: every agenda job, cron, setInterval; behaviour under pm2 cluster mode.
   5. **Security findings**: severity-ranked. Verify each of the known issues below and add any others you find.
   6. **Correctness findings (in-scope features)**: ranking and GBP logic bugs. Verify each known issue below.
   7. **Dead code & duplication**: unused exports, unused files, duplicate helpers.
   8. **Dependency review**: `npm audit` summary, unused dependencies, packages needing major upgrades.
   9. **Out-of-scope observations**: note problems in out-of-scope modules without proposing changes.
4. Produce `docs/ROUTES.md`: a clean route inventory (method, path, auth, purpose) for Mohit to review.

### Known issues to verify (confirm or refute each, with file:line)

**Security**
- S1. Unauthenticated admin routes: `/admin/auth/register|getAllAdmins|getAdminById|updateAdmin|deleteAdmin`, entire `/admin/operations/*`.
- S2. Unauthenticated: `/roles` CRUD, `/business-categories` POST/PUT, `/subscription` plan CRUD, coupon generate/list, payments/all, payment-status, send-subscription-welcome-mail, `/payments/getAllPayments`, support admin routes, `/citation/getAllCitatioList`, `/system/*`.
- S3. `GET` and `DELETE /api/v1/logs` unauthenticated (in `app.ts`).
- S4. PayPal webhook has no signature verification.
- S5. Auth rate limiter mounted on `/v1/auth` (non-existent path); no `trust proxy` behind nginx.
- S6. No `sanitizeFilter`; raw body values used in Mongo filters (OTP flows, admin login).
- S7. Multer applied globally to `/api/v1` before auth, no file size/count limits.
- S8. Wildcard `Access-Control-Allow-Origin: *` middleware before the cors allowlist.
- S9. Only `helmet.contentSecurityPolicy` used; `*.polyfill.io` in script-src; malformed `img-src` entry.
- S10. Body parser limit 100mb.
- S11. GBP OAuth `state` is unsigned JSON containing `user_id` (account-binding attack).
- S12. OAuth refresh/access tokens stored in plaintext (`UserAuth`).
- S13. Hardcoded DataForSEO credentials in `helpers/rankTrackerReport.ts`; hardcoded AES key in `utils/fileEncryption.ts`.
- S14. Admin temporary password generated with `Math.random()`.
- S15. Report fetch middlewares (`validFetch*`) don't check location ownership (IDOR).

**Ranking / GBP correctness**
- C1. `getSerpRanking` destructures a possibly-null result → one failed call fails the whole report.
- C2. "Local pack" is actually `tbm=lcl` (Local Finder page 1); duplicated cost.
- C3. Per-keyword `change` hardcoded to 0; movement only from local_finder.
- C4. `generateGrid()` never called; grid report is a single center search.
- C5. UULE construction malformed (missing length key; uses a street address).
- C6. Grid and map reports never compute the client's own rank; `keywords_up/down/all_keywords_avg` never set; previous report deleted each run (no history).
- C7. Scheduling fields stored but never executed (`configs/agenda.ts` empty).
- C8. GBP audit recomputes (paid API calls) on every GET; "verified" is guessed; citations/links/photos hardcoded to 0.
- C9. `helpers/gbpPs.ts`: only first account used; `locations.list` called without required `readMask`.
- C10. Square payment URL hardcoded to sandbox (out of scope: record only).
- C11. `getKeywordMovmentData` calls `.setCredentials` on the `oAuth2Client` function (would throw); `getDatesArr` ordering makes "current" the oldest month (dead code, record only).

**Deliverable:** `docs/AUDIT.md`, `docs/ROUTES.md`, updated `docs/PROGRESS.md`. **Gate: wait for approval.**

---

## 5a. PHASE 1.5 — Repo hygiene (approved)

Branch `claude/phase-1.5-hygiene`, one commit per step. No behaviour changes. Commit hashes are in `docs/PROGRESS.md`.

1. **Line endings → LF.** `.gitattributes` is `* text=auto eol=lf`, with binaries marked. `.editorconfig` added. Prettier already had `endOfLine: lf`. Ran `git add --renormalize .` (the index was already LF, so no content changed). The commit hash is listed in `.git-blame-ignore-revs`.
2. **`.gitignore`.** `package-lock.json` and `.env.example` are now tracked. `.env.example` lists every variable read in `src/configs/config.ts` and elsewhere via `process.env`, with placeholder values only.
3. **`tsconfig.json`.** Removed the stale include `src/utils/fetchCountryStateCityDataFromRemoteApi.ts`.
4. **Dead code deleted**, each after a zero-reference check:
   - `services/common/serp.ts`
   - `utils/fileEncryption.ts`
   - `lib/crypto.ts`
   - `helpers/gbpPs.ts` and its barrel export
   - `keywordPositionSearch`
   - the Moz helpers
   - `models/citationPayment.model.ts`

   `unbindGoogleBusinessProfileWithUser` is kept on purpose: it is a bug, recorded as C12.
5. **Unused dependencies removed:** `http-proxy-middleware`, `http-status-codes`, `fs-extra`, `razorpay`. `@paypal/checkout-server-sdk` was removed after Mohit approved it; `configs/paypal.ts` now exports only `BASE_URL`. `project-tree.txt` was deleted.

The pre-existing build errors (46 TypeScript errors, see AUDIT §0) were fixed in Phase 1.6.

## 5b. PHASE 1.6 — Build green (approved)

Branch `claude/phase-1.6-build-green`. Type-level fixes only; nothing that changes behaviour.

- All 46 TypeScript errors fixed. `mongoFunctions` is now generic over the model type, and `getKeywordMovmentData` (never called) uses the `oAuth2Client()` factory.
- `.env` is loaded from `ENV_FILE`, else `./.env` in the working directory. The build no longer copies `.env`. pm2 must start from the repo root (`docs/OPERATIONS.md`).
- DataForSEO credentials moved to the optional `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` env vars.
- Local MongoDB: Homebrew `mongodb-community@7.0`, separate database `mps_rebuild`; `MONGODB_AUTH_SOURCE` is required and `mps_db` is gone.

---

## 6. (moved) Security hardening

Security work is deferred until the rebuild features are done. It is now **Phase 10**, see §13a. Do not start it before Phases 3–9 are done and Mohit explicitly approves it.

---

## 7. PHASE 3 — Foundations

**Done** (ranking-focused): merged into `claude/rebuild` as `53986e0` and pushed at milestone M1 on 2026-09-26. 3.3 and `gbpClient` were deferred to Phase 6. Details are in `docs/PROGRESS.md`.

### 3.1 Config (`src/configs/config.ts`)
Add (Joi-validated, all optional in dev unless marked required):
```
GOOGLE_PLACE_API_KEY          optional until live testing (the client throws "GOOGLE_PLACE_API_KEY not set" if empty)
PLACES_SEARCH_RADIUS_M        default 5000
RANK_MAX_KEYWORDS             default 20
RANK_TRACKER_OFFSET_KM        default 1.5
RANK_DEV_MAX_KEYWORDS         default 2      (enforced when NODE_ENV=development)
```
`OAUTH_STATE_SECRET`, `TOKEN_ENCRYPTION_KEY` and `GBP_SYNC_ENABLED` moved to Phase 6 (decision by Mohit, 2026-09-26: ranking first).
Update `.env.example` (create if missing) with every variable and a comment. Never commit `.env`.

### 3.2 Google API clients (`src/clients/`)
Create typed, mockable clients. Each client: axios instance, timeout 15s, 1 retry on 5xx/429 with backoff, typed request/response interfaces, logs call count + latency (no payloads, no keys).

- `src/clients/placesClient.ts`
  - `searchTextIds(params)` → POST `https://places.googleapis.com/v1/places:searchText`
    - Headers: `X-Goog-Api-Key`, `X-Goog-FieldMask: places.id,places.movedPlaceId,nextPageToken`.
    - **Hard guard:** throw if the field mask for this function contains anything else (this keeps it on the free "Text Search Essentials (IDs Only)" SKU).
    - Body: `textQuery, regionCode, pageSize: 20, locationBias.circle{center{latitude,longitude},radius}, pageToken?`.
    - Paginates up to 3 pages (60 results). Accepts `stopWhenFound: string[]`: stop paging once all given place IDs are found.
  - `searchTextWithNames(params)`: same endpoint, field mask `places.id,places.movedPlaceId,places.displayName,nextPageToken` (Pro SKU). Max 1 page (20 results). Used only for Map Ranking.
  - `getPlaceDetails(placeId, fields[])` → GET `https://places.googleapis.com/v1/places/{placeId}` with `X-Goog-FieldMask` (no `places.` prefix). Used for center resolution and competitor comparison.
- `src/clients/gbpClient.ts`: **deferred to Phase 6** (see §10).

### 3.3 Token security
**Deferred to Phase 6** (see §10). Phase 3 is ranking-focused.

### 3.4 Jobs infrastructure
- `src/configs/agenda.ts` owns the agenda instance and its lifecycle (`startAgenda`, `stopAgenda`). The single job registry is `src/jobs/index.ts` (`defineAllJobs(agenda)`); it lives there rather than in `configs/agenda.ts` to avoid a circular import through `gbpPostSchedular.service`. Keep existing `post-to-gbp` behaviour identical.
- **C25 fix:** agenda gets its own MongoDB connection (`db.address` built from the existing `MONGODB_*` values), because `agenda@5` needs its own driver 4.17 and never becomes ready on Mongoose's driver-6 connection. Agenda is started from `src/server.ts` after `listen`, so seed scripts never process jobs.
- Job conventions: idempotent, job data contains IDs only, per-job `lockLifetime`, concurrency limits, failures recorded on the related document (`last_error`, `last_run_at`).
- No node-cron for business logic. (Leave the existing heartbeat cron in `app.ts` untouched; out of scope.)

### 3.5 Test harness
- Dev dependencies `jest`, `ts-jest`, `@types/jest`, `mongodb-memory-server` (test binary pinned to MongoDB 7.0.14 in `package.json`). Tests live in `tests/` mirroring `src/`.
- `npm test` = `tsc -p tests/tsconfig.json && jest`: src and tests are type-checked once up front, and jest workers only transpile (`tests/tsconfig.jest.json`, `isolatedModules`). Type-checking inside every worker made parallel workers fail to exit.
- `tests/setupEnv.ts` makes tests load `.env.example` (never `.env`) and unsets `GOOGLE_PLACE_API_KEY`. Winston is silent in tests (`TEST_LOGS=1` to show it). External APIs are replayed through `tests/helpers/fakeTransport.ts`.
- Fixtures: `tests/fixtures/places/*.json` now; `tests/fixtures/gbp/*.json` in Phase 6 (hand-written, realistic, no real personal data).
- Smoke scripts: `npm run smoke:places -- "<keyword>" <lat> <lng> [place_id]` makes one IDs-only call, page 1. **Only Mohit runs it**, once the key exists. `npm run smoke:agenda` is a job self-test with no external calls.

**Gate.**

---

## 8. PHASE 4 — Ranking engine (pure logic + Places client usage)

**Built** on `claude/phase-4-ranking-engine` (awaiting merge). Public API: `src/ranking/index.ts`. As built:
- `engine.ts`: `createRankingEngine({ places, region, targets, radiusM?, concurrency ≤ 4, jitterMs, sleep?, random? })`. Create **one engine per run** (the cache and stats are per run). `searchPoint(keyword, point)` → `PlaceIdEntry[] | null`; `rankKeywordAtPoints(keyword, points)` → `{ point, byTarget }[]`; `getStats()` → `{ searches, cacheHits, errors, apiCalls.ids_only }`. A `PlacesApiError` becomes an `error` cell; a `PlacesConfigError` (no key) fails the run.
- `metrics.ts`: `cellChange(prevCell, currCell)` implements the §4 cell rules. `keywordChange(prevSummary, currSummary)` works at summary level: `entered_top_60` when the previous `foundRate` was 0 and is now > 0, `dropped_out_of_top_60` for the reverse, otherwise the `avgRank` delta. Phase 5 passes `null` when `keywords_version` differs.
- Also: `estimate.ts` (`estimateCalls(keywords, gridSize, opts)`), `region.ts` (`regionFromCountry`), and `limits.ts` (`applyDevKeywordCap`, `RANK_DEV_MAX_KEYWORDS` in development).
- The Map Ranking names search (`searchTextWithNames`, 1 page at the center) is called by the Phase 5 `rank-run` job, not by the engine.

Original spec:

Files: `src/ranking/` (new folder).

- `points.ts`
  - `trackerPoints(center, offsetKm)` → 5 points (center, N, S, E, W).
  - `gridPoints(center, size, spacingKm)` → port the existing `generateGrid()` math (km-based). Return points with `{ row, col, lat, lng }`, center at `(half, half)`.
- `rankCell.ts`: `toCell(ids | null, placeId): RankCell`, `bucket(cell)`.
- `metrics.ts`: `avgRank(cells)`, `foundRate(cells)`, `top3Rate(cells)`, `overallAvgRank(rows)`, `keywordChange(prevCell|prevAvg, curr)` exactly per §4.
- `engine.ts`
  - `searchPoint(keyword, point, region, targetIds)` → `string[] | null` (null on error after retry). Uses `searchTextIds` with `stopWhenFound = targetIds`.
  - `rankKeywordAtPoints(keyword, points, targets: {key, placeId}[], region)` → for each point: one search, then a `RankCell` per target from the same list.
  - Concurrency: max 4 in-flight searches per job (simple pool). Small jitter delay 100–300 ms between calls.
- **Cache within a run:** key `(keyword, lat.toFixed(5), lng.toFixed(5))` → ID list, so the center point is searched once and reused by tracker, grid and map sections.

Unit tests: points geometry (distances within 1%), metrics edge cases (all not_found, all error, mixed), change labels, pool concurrency, stopWhenFound paging.

**Gate.**

---

## 9. PHASE 5 — Ranking reports (three pages, one run)

**Built** on `claude/phase-5-ranking-reports` (milestone M2). As built, where it differs from or adds to the spec below:
- **Code map:**
  - `src/services/ranking/`: `trackingSettings`, `runPlan`, `tracking.service`, `rankRun.service` (enqueue), `rankRunExecutor` (the job body), `scheduler.service`, `rankReports.service`, `resolveNames`
  - `src/jobs/rankRun.job.ts`, `rankScheduler.job.ts`
  - `src/routes/v1/common/ranking.route.ts` (mounted at `/locations`)
  - `src/middlewares/ranking`, `src/controllers/ranking`
- **RankRun:**
  - The §9.2 field `errors` is named **`run_errors`**, because `errors` is reserved on Mongoose documents.
  - Added fields: `trigger`, `active` (a unique partial index enforces one queued or running run per location), `started_at`, `finished_at`, `duration_ms`, `failure_reason`, `center_source`, a `config` snapshot, `estimate`, `dev_capped`.
- **Enqueue:**
  - 400 without `place_id`, keywords, or a US/CA country.
  - In development: `RANK_DEV_MAX_KEYWORDS` and a forced 3×3 grid.
  - **422** when `estimateCalls().idsOnly.max` exceeds `RANK_MAX_CALLS_PER_RUN` (default 3200).
  - An active run is returned with `existing: true`.
- **Scheduling note (7b):** the 15-minute `rank-scheduler` and weekly/monthly frequencies are replaced by the location-level `monthly-refresh` scheduler (§4 "Refresh cadence").
- **Stuck guard** (in `rank-scheduler`, since 7b in `monthly-refresh`): runs `running` for more than 30 minutes, or `queued` for more than 30 minutes, are marked `failed`. Scheduler claims are a compare-and-set on `next_run_at`.
- **Extra endpoint:** `GET /api/v1/locations/:locationId/rank-runs` (paginated history). The page endpoints accept `?runId=`, return 404 before the first completed run and 409 for an unfinished run. Ownership is checked on every route; another user's location gives 404.
- **Names:** `STORE_PLACE_NAMES` (default true). When false, names are null, and `GET map-ranking?resolveNames=true` resolves them live with Place Details (see §15). This is **pending Mohit's ToS decision**.
- **Demo data:** `npm run seed:rank-demo` (development + `mps_rebuild` only, offline client). Endpoint reference: `docs/API.md`; first live run: `docs/LIVE_TEST.md`.

Original spec:

### 5.1 Location model additions
```ts
tracking: {
  keywords: [{ text: String, normalized: String }],   // max RANK_MAX_KEYWORDS
  keywords_version: Number,                             // default 1
  keywords_updated_at: Date,
  competitors: [String],                                // place_ids, max 5
  grid: { size: Number /*3|5|7*/, spacing_km: Number }, // default {5, 1}
  frequency: String,                                    // 'weekly' | 'monthly' | 'manual' (superseded in 7b: 'auto_monthly' | 'manual_only', §4)
  next_run_at: Date,
  last_run_at: Date,
  last_error: String,
}
```

### 5.2 New model `RankRun` (collection `rank_runs`)
```ts
{
  location_id, created_by, run_at, status: 'queued'|'running'|'done'|'partial'|'failed',
  keywords_version, keywords: [String], region, center: {lat, lng},
  targets: [{ key: 'self'|'competitor_n', place_id }],
  tracker: [{ keyword, cells: [{ point, byTarget: { [key]: RankCell } }],
              summary: { [key]: { avgRank, foundRate, top3Rate, change, changeLabel } } }],
  grid: [{ keyword, size, spacing_km,
           points: [{ row, col, lat, lng, byTarget: { [key]: RankCell } }],
           summary: { [key]: { avgRank, foundRate, top3Rate } } }],
  mapList: [{ keyword, results: [{ rank, place_id, name, is_self }] }],   // top 20, center only
  overall: { [key]: { overallAvgRank, change } },
  api_calls: { ids_only: Number, pro: Number, details: Number },
  errors: [{ keyword, point, message }],
}
```
Indexes: `{ location_id: 1, run_at: -1 }`. History is kept; never delete runs.

**Compliance note:** `mapList.results.name` stores Places content. Implement a `resolveNames(placeIds)` path so names can be fetched at view time instead of stored, and put a `STORE_PLACE_NAMES` flag (default true) in config. Flag this in the phase summary for Mohit's ToS decision.

### 5.3 Job `rank-run`
- Enqueued by: API "run now", and the scheduler (`rank-scheduler`, every 15 minutes: finds locations with `tracking.frequency != manual` and `next_run_at <= now`, enqueues `rank-run`, advances `next_run_at`).
- Steps: load location → resolve center → build targets → tracker points + grid points → for each keyword run `rankKeywordAtPoints` over the **union** of points (cache shared) → mapList (center, `searchTextWithNames`, 1 page) → metrics → change vs previous `done|partial` run with same `keywords_version` → save.
- Status `partial` if any error cells; `failed` only if every search failed.

### 5.4 API (all require user auth + location ownership)
```
PUT    /api/v1/locations/:locationId/tracking            set keywords/competitors/grid/frequency (validates limits; bumps keywords_version if keywords change)
GET    /api/v1/locations/:locationId/tracking
POST   /api/v1/locations/:locationId/rank-runs           run now → { run_id, status: 'queued' }
GET    /api/v1/locations/:locationId/rank-runs/:runId    status + api_calls
GET    /api/v1/locations/:locationId/rank-tracker        latest run tracker section + overall + history (last 12 runs: run_at, overallAvgRank)
GET    /api/v1/locations/:locationId/grid?keyword=       latest run grid section (one keyword or all)
GET    /api/v1/locations/:locationId/map-ranking?keyword= latest run mapList section
```
Validation: keywords 1..RANK_MAX_KEYWORDS, each 2–80 chars; grid size ∈ {3,5,7}; spacing_km 0.25–5; competitors valid place_id strings, max 5; frequency enum.

Responses use the existing `responseWrapper` envelope. Document every endpoint in `docs/API.md` with example responses.

### 5.5 Legacy
Old routes `/rank-tracker`, `/local-search-grid`, `/local-map-ranking` stay mounted and untouched in this phase (frontend may still use them). Deletion happens in Phase 9.

Integration tests (mongodb-memory-server + mocked placesClient): full run for 2 keywords × 3×3 grid, change calculation across two runs, keyword edit resets comparison, partial run on injected errors.

**Gate.**

---

## 10. PHASE 6 — GBP connection fixes

**Built** on `claude/phase-6-gbp-connection`. As built, where it differs from or adds to the spec below:
- **No `OAUTH_STATE_SECRET`.** The state is 32 random bytes stored as a SHA-256 hash (`OAuthState`, TTL index), consumed atomically once, so no HMAC is needed.
- **Tokens:** `TOKEN_ENCRYPTION_KEY` is required only in production. Legacy plaintext GBP rows are re-encrypted on first read; `npm run gbp:encrypt-tokens` does all of them. Search Console tokens stay plaintext (Phase 10).
- **`gbpClient`:**
  - Retries: 429 up to 3 times with backoff; 5xx and timeouts once.
  - A quota-0 429 throws `GbpAccessNotApprovedError` immediately; a 403 `SERVICE_DISABLED` throws `GbpApiDisabledError`.
  - `invalid_grant` marks the token row `revoked` and clears `is_gbp_connected`.
  - API responses use 400 for "reconnect", not 401 (401 means the MyPageSEO session expired).
- **Discovery:** `GET /gbp` returns `{ accounts, locations, errors }`. That is a frontend change: it used to be a bare array.
- **Bind:** takes `{ location_id, gbpAccountId, gbpLocationId }` and reads the profile from Google. It also fills `Location.lat/lng` from GBP `latlng` when both are empty.
- **Unbind** (`POST /gbp/unbind`, new):
  - Cancels the location's `gbp-sync` jobs and its pending scheduled posts (marked `REJECTED`, `last_error`).
  - Deletes the GBP tokens **only when it was the user's last binding**, because tokens belong to the Google account, not to a binding.
- **Disconnect:** `POST /user/auth/google/gbp/revoke` revokes at Google, then removes everything.
- **Preflight:** `npm run gbp:preflight -- <userId>` (read-only, Mohit runs it). Setup and connection steps: `docs/GBP_CONNECT.md`.

Original spec:

Prerequisite: Mohit confirms GBP API access is approved for the Cloud project (quota > 0). If calls return 429 with quota 0, stop and report; that is an access gate, not a rate limit.

Carried over from Phase 3 (deferred 2026-09-26):
- Config: `OAUTH_STATE_SECRET` (required, HMAC for OAuth state), `TOKEN_ENCRYPTION_KEY` (required, 32-byte hex, AES-256-GCM), `GBP_SYNC_ENABLED` (default true).
- `src/utils/tokenCrypto.ts`: AES-256-GCM `encrypt/decrypt` using `TOKEN_ENCRYPTION_KEY`. Migration script `src/scripts/encryptExistingTokens.ts` (idempotent; detects already-encrypted values). **Do not run it**; document how to run it in `docs/PROGRESS.md`.
- `src/clients/gbpClient.ts`: all GBP calls; takes a location binding; handles access-token refresh via the stored refresh token (decrypt → refresh → re-encrypt on rotation). Built on the shared `src/clients/http.ts` helper from Phase 3.

The signed OAuth state and encrypted token storage below stay in this phase even though security work is deferred to Phase 10: they are part of building the GBP connection correctly, not a security project.

- **OAuth state**: generate a random 32-byte token, store `{ token_hash, user_id, expires_at (10 min) }` in a new `OAuthState` model; `state` param = token. Callback validates, consumes (one-time), and resolves `user_id` server-side. Remove the JSON state.
- **Scopes**: `https://www.googleapis.com/auth/business.manage` only.
- **Token storage**: encrypted via `tokenCrypto` (Phase 3.3). Refresh handled in `gbpClient`.
- **Account & location discovery** (`gbpClient`):
  - `listAccounts()` → GET `https://mybusinessaccountmanagement.googleapis.com/v1/accounts` (paginate `pageToken`).
  - `listLocations(accountName)` → GET `https://mybusinessbusinessinformation.googleapis.com/v1/{accountName}/locations?readMask=name,title,storefrontAddress,phoneNumbers,websiteUri,categories,latlng,metadata&pageSize=100` (paginate).
  - Return all accounts' locations to the UI for binding.
- **Binding**: `UserGBP` stores `gbpAccountId` (`accounts/…`), `gbpLocationId` (`locations/…`), `place_id` (from `metadata.placeId`), and links to our `Location`. Set `Location.place_id` from `metadata.placeId` if empty (never overwrite a different existing value; report conflicts).

- C12: rewrite unbindGoogleBusinessProfileWithUser to actually unbind (remove UserGBP binding, delete stored GBP tokens for that binding, cancel gbp-sync jobs for the location). Test: bind → unbind → no binding, no tokens, no scheduled jobs.

Tests: state creation/validation/expiry/replay, pagination with fixtures.

**Gate.**

---

## 11. PHASE 7 — GBP data sync + GBP Report

**Split into three sub-phases** (Mohit, 2026-09-26). Each has its own branch from `claude/rebuild`, plan mode, approval and merge. M3 comes after 7c.
- **7a: connect + onboarding.** **Built** on `claude/phase-7a-connect-onboarding`:
  - Google Identity Services popup (`GET /user/auth/google/gbp/popup`, `POST /user/auth/google/gbp/code` with `redirect_uri=postmessage`); any Google account.
  - Scopes `openid email business.manage`; the id_token is verified and `google_email` stored. Popup settings: `select_account: true` only (GIS has no `prompt`). The redirect fallback sends `prompt=select_account consent`.
  - **Several Google accounts per user** (agencies): one *connection* per Google account, keyed by the id_token `sub`. Token rows are keyed by `user_id + token_type + google_sub`; each `UserGBP` binding stores the `google_sub` it was made with, and `gbpClient` acts through a `ConnectionRef { userId, googleSub }`. Discovery is grouped per account. Bind and disconnect take `google_sub` (required with several). Disconnect and unbind are per account.
  - Onboarding: `/onboarding/{state,gbp-profiles,select-profile,complete}`, `GET /locations/:id/competitor-suggestions` (Text Search **Enterprise** mask, 24 h cache, top 10) and `GET /places/search?q=&locationId=` (Pro, 10 results).
  - `PLACES_USER_DAILY_LIMIT` (default 50) caps user-triggered Places calls per user per day.
  - `Location.onboarding` holds the step: `profile_selected` → (`center_needed` → `center_set`) → `keywords_set` → `competitors_set` → `completed`. A service-area profile without coordinates adds the center step: `PUT /locations/:id/center { query }` (1 IDs-only search + 1 Details `location`; `center_source: 'manual'`). `/complete` requires a center, queues the first rank run and sets `gbp_sync.requested_at` for 7b.
  - Frontend flow: `docs/GBP_CONNECT.md`, `docs/API.md`.
- **7b: the `gbp-sync` job** (7.1 below) on the **monthly cadence** (§4 "Refresh cadence"). Global switch **`GBP_V4_ENABLED`** (default false). **Built** on `claude/phase-7b-gbp-sync`:
  - **Code:** `src/gbp/{sync.executor, windows, mappers, hooks}`, `src/services/gbp/sync.service.ts` (enqueue, one active sync per location, estimate), `src/services/refresh/{cadence, scheduler.service, refresh.service, migrate}`.
  - **Models:** `GbpSync`, `GbpMetricDaily`, `GbpKeywordMonthly`, `GbpProfileSnapshot`, `GbpReview`. Location gets `refresh`, `timezone` and the `gbp_sync` fields.
  - **Jobs:** `gbp-sync` and `monthly-refresh`. The latter replaced `rank-scheduler`, whose old agenda document is cancelled at startup.
  - **API:** `POST/GET /locations/:id/refresh` (24 h per type; "run now" shares the rankings limit) and `GET /locations/:id/gbp/sync`.
  - **About 03:00 local:** `Location.timezone` if set, otherwise an offset estimated from longitude, otherwise UTC.
  - **Migration:** `npm run migrate:refresh`.
  - **7c hook:** `onGbpSyncFinished` (it only logs until 7c).
  - When false, no v4 calls are made: reviews, media and posts are marked `not_available` (not an error).
  - All v4 code is still built and tested on fixtures, so going live means setting `GBP_V4_ENABLED=true` with no code changes.
  - Sample data only in `seed:gbp-demo` and tests, never in live responses.
- **7c: scoring + report + competitors.** **Built** on `claude/phase-7c-scoring-report` (milestone **M3**):
  - **Code:** `src/gbp/scoring.config.ts` (every weight and threshold), `src/gbp/score/{gbpScore,publicScore,holidays}`, `src/gbp/report/{performance,keywords,reviews,competitors,insights,generate}`, `src/services/gbp/report.service.ts`, job `gbp-report`, model `GbpReport` (**one per location, overwritten**; only own scores kept in `score_history`), `Location.gbp_report`.
  - **GBP Score** (private): 5 pillars (completeness 25, activity 20 v4, reviews 25 v4, visibility 20, engagement 10). A check without data is `not_available`; a pillar with none is excluded and the rest rescaled (`partial`, `excluded_pillars`). Grades A ≥ 85 … F. Top 5 fixes. It **supersedes 7.2's health score** below.
  - **Public Score**: one formula for client and competitors, from Place Details + center ranks from the latest `mapList`. `editorialSummary` (Atmosphere tier) only with `COMPETITOR_DETAILS_ATMOSPHERE=true`.
  - **Competitors:** client + `tracking.competitors` + top 3 of the first keyword's map list (max 5). Place Details at most once per monthly cycle per business, or on a manual refresh when older than 24 h; failures keep old facts (`stale`).
  - **Generation:** after each gbp-sync and each done/partial rank run, a tracked-competitor change and an unbind; debounced (`REPORT_DEBOUNCE_SECONDS`, compare-and-set on `gbp_report.scheduled_for`) and skipped while a run or sync is active, so a monthly refresh gives one report.
  - **API:** `GET /locations/:id/gbp/report?range=28d|90d|12m` (#28). §7.4's `POST …/gbp/sync` is `POST /refresh {types:["gbp"]}` (7b), and `…/competitors/refresh` is `POST /refresh` (it sets the competitor refetch flag). Without a GBP binding the private sections return `{ available: false, reason: "gbp_not_connected" }`; v4 sections `v4_access_pending`.
  - **Demo:** `npm run seed:gbp-demo [-- --v4-off]`. Calibration against real data once GBP access is approved: PROGRESS.md "Scoring calibration".

### 7.1 Sync job `gbp-sync` (per bound location; **monthly** via the `monthly-refresh` scheduler, plus manual refresh)
Never fetch GBP data on a page view. Store everything; pages read from DB.

| Data | Endpoint | Store in |
|---|---|---|
| Daily metrics | `GET https://businessprofileperformance.googleapis.com/v1/{locations/ID}:fetchMultiDailyMetricsTimeSeries` with `dailyMetrics` = `BUSINESS_IMPRESSIONS_DESKTOP_MAPS, BUSINESS_IMPRESSIONS_DESKTOP_SEARCH, BUSINESS_IMPRESSIONS_MOBILE_MAPS, BUSINESS_IMPRESSIONS_MOBILE_SEARCH, CALL_CLICKS, WEBSITE_CLICKS, BUSINESS_DIRECTION_REQUESTS, BUSINESS_CONVERSATIONS, BUSINESS_BOOKINGS, BUSINESS_FOOD_ORDERS, BUSINESS_FOOD_MENU_CLICKS` and `dailyRange` | `GbpMetricDaily` `{ location_id, date, metric, value }` unique index on (location_id, date, metric). First sync backfills 18 months; later (monthly) syncs fetch a **rolling 40-day window** (data lags; upsert). |
| Search keywords | `GET https://businessprofileperformance.googleapis.com/v1/{locations/ID}/searchkeywords/impressions/monthly` with `monthlyRange` | `GbpKeywordMonthly` `{ location_id, month, keyword, value \| threshold }`. Backfill 6 months; later syncs fetch the **last 2 months**. Preserve "threshold" values as thresholds (don't coerce to numbers). |
| Profile | `GET https://mybusinessbusinessinformation.googleapis.com/v1/{locations/ID}?readMask=name,title,storefrontAddress,phoneNumbers,websiteUri,regularHours,specialHours,moreHours,serviceArea,categories,profile,openInfo,metadata,labels,serviceItems,latlng` + `GET .../v1/{locations/ID}/attributes` | `GbpProfileSnapshot` (latest + dated history) |
| Verification | `GET https://mybusinessverifications.googleapis.com/v1/{locations/ID}/VoiceOfMerchantState` | on snapshot |
| Reviews | `GET https://mybusiness.googleapis.com/v4/{accounts/A}/{locations/L}/reviews` (paginate; includes averageRating, totalReviewCount) | `GbpReview` upsert by review name (rating, comment, createTime, updateTime, reply, reply state, media) |
| Media | `GET https://mybusiness.googleapis.com/v4/{accounts/A}/{locations/L}/media` and `/media/customers` | counts + latest upload dates on snapshot |
| Posts | `GET https://mybusiness.googleapis.com/v4/{accounts/A}/{locations/L}/localPosts` | last post date, posts in last 30/90 days on snapshot |

Respect quotas: ≤ 5 requests/second per job, exponential backoff on 429. Record `last_synced_at` and errors per data type; a failure in one data type must not abort the others.

### 7.2 Profile health score (superseded in 7c by the 5-pillar GBP Score, see above)
Each check returns `{ id, label, passed, weight, detail }`; score = weighted % (0–100).
- verified (20), description present ≥ 250 chars (8), ≥ 1 additional category (8), regular hours set (8), special hours set for upcoming holidays in next 60 days (4), website set (6), phone set (6), photo uploaded by owner in last 30 days (8), post in last 7 days (10), review reply rate last 90 days ≥ 80% (10), median reply time ≤ 48h (6), attributes set ≥ 5 (6).
- NAP check (informational, not scored): compare `Location.name/mobile` with profile title/primary phone (normalized) and show mismatches.

### 7.3 Competitor comparison
- Competitors: `tracking.competitors` + top 3 non-client place IDs from the latest `RankRun.mapList` (center, first keyword by default; de-duplicate; max 5 total).
- For client and each competitor: `getPlaceDetails` with fields `displayName,rating,userRatingCount,primaryType,primaryTypeDisplayName,types,regularOpeningHours,websiteUri,nationalPhoneNumber,businessStatus,editorialSummary`. (Do **not** request `reviews` or `photos` by default; they move billing to the most expensive tier. Put them behind config flags, default off.)
- Join with the latest RankRun: per target `overallAvgRank` and `top3Rate`.
- Fetched during report generation (job), not on page view. Store in the report document with `generated_at`. Places content is not kept historically (only the latest report's comparison; overwrite each generation). Flag this for Mohit's ToS confirmation.
- **Gap insights** (`src/gbp/insights.ts`, pure): rule-based sentences, e.g. review count gap ratio vs best competitor, rating gap, missing hours/website/description vs competitors, rank gap. Max 5, ordered by impact.

### 7.4 GBP Report API (user auth + ownership)
```
POST /api/v1/locations/:locationId/gbp/sync           → queue gbp-sync
GET  /api/v1/locations/:locationId/gbp/report?range=28d|90d|12m
     → { performance: { totals, previousPeriod, sameperiodLastYear, byDay, bySurface: {maps, search}, byDevice: {mobile, desktop}, actionsPer1000Impressions },
         keywords: { months, top: [{ keyword, value|threshold, change }], notTracked: [keywords present here but not in tracking.keywords] },
         health: { score, checks, nap },
         reviews: { averageRating, total, perMonth, replyRate90d, medianReplyHours, unreplied: [...], distribution },
         competitors: { generated_at, rows, insights },
         sync: { last_synced_at, errors } }
POST /api/v1/locations/:locationId/gbp/report/competitors/refresh → queue competitor refresh
```
Old `/gbp-audit` routes stay mounted until Phase 9.

Tests: aggregation math (period comparisons with gaps in daily data), threshold keyword handling, health score, insights rules, sync upsert idempotency with fixtures.

**Gate.**

---

## 12. PHASE 8 — Auth, Organization, Onboarding & Locations

Scope from Mohit (2026-09-26), aligned with the roadmap PDF §2, §5, §6 and §14. **Plan mode first, with a data-model diagram.**

- **Signup as Business or Agency.** An organization (name, country, type) and an account context (which organization the user acts in).
- **Plan / location limits enforced.** Business is plan-limited (e.g. 3); Agency is plan-based. Read limits from the existing subscription / plan data where it exists. **Don't change payment logic.**
- **Agency:** clients CRUD, and assigning locations to clients. Reuse or repair the existing client code only where needed.
- **Unified "add location"** (§0: (a) GBP profile or (b) Places search) → keywords → competitors → setup complete → first refresh queued.
- **Onboarding state machine** per the PDF's Business and Agency flows, resumable anywhere.
- **Locations list** for the PDF's `/locations` table: name, city, client, rank summary, GBP score, rating/reviews, status `active | setup_required | gbp_not_connected | reconnect_required`.
- **Location overview endpoint:** header data + latest summaries.
- `source` / `gbp_connected` on locations; the per-organization `place_id` duplicate guard.

**Gate.**

---

## 12a. PHASE 9 — GBP Posting (moved from Phase 8; needs GBP v4 access)

Keep the existing flow (`gbpPostSchedular.service.ts`, `jobs/postToGbp.ts`, v4 `localPosts`). Improve without breaking existing endpoints:
- Use `gbpClient` (token refresh + encrypted tokens) instead of ad-hoc axios calls.
- Validate by `topicType`: `STANDARD`, `EVENT` (requires event title + schedule), `OFFER` (requires event schedule; optional couponCode, redeemOnlineUrl, termsConditions). Summary ≤ 1500 chars. CTA types: `BOOK, ORDER, SHOP, LEARN_MORE, SIGN_UP, CALL` (`CALL` has no URL).
- Media: `sourceUrl` must be a publicly reachable HTTPS URL; verify with a HEAD request before scheduling; reject otherwise.
- Support recurring posts via `recurrenceInfo` (added to the API in April 2026). Model the recurrence on `GBPPost`.
- On publish failure store Google's error message on the post (`last_error`) and keep status `rejected`; allow retry endpoint.
- Sync post state back from `localPosts.list` during `gbp-sync` (state LIVE/REJECTED/PROCESSING, searchUrl).
- Scheduling stays on agenda; ensure jobs are idempotent (don't double-publish if a job is retried after a successful API call; check stored `gbpPostId` first).

Tests: validation per topic type, idempotent publish, recurrence mapping.

**Gate.**

---

## 13. PHASE 9b — Remaining cleanup & documentation (was Phase 9)

**Partly done early (9a, Mohit, 2026-09-26)** on `claude/phase-9a-legacy-cleanup`, because the frontend moves to the new endpoints:
- Deleted: old ranking code, the GBP audit, the Reputation Manager, the white-label report links, the Search Console connect, SerpAPI / Moz / DataForSEO config and helpers, unused config and env vars (Stripe, Razorpay, …), and the `googleapis` package.
- Written: `docs/LEGACY_FEATURES.md` (how to rebuild Reputation Manager and white-label links properly) and `docs/MIGRATION.md`.
- **Left for Phase 9b:** swagger.json, ARCHITECTURE.md, the final OPERATIONS/API pass, `serpapi` (still imported by citations, out of scope).

Original spec (the deletions below were done in 9a):
- Delete old ranking code: `helpers/rankTrackerReport.ts`, `helpers/localSearchGridReport.ts` (after `generateGrid` is ported), `helpers/localMapRankingReport.ts`, `helpers/getSerpCountryCode.ts` (unused since Phase 1.5), old ranking services/controllers/middlewares/routes/models, `configs/serpConfig.ts`, `constants/serpCountryCode.ts` if unused.
- Delete old GBP audit code: `helpers/gbpAudit.ts`, `services/common/gbpAudit.service.ts` and its route/controller/middleware/model.
- Remove unused dependencies (`serpapi` and any others made unused). Remove SerpAPI/DataForSEO/Moz env vars from config and `.env.example`.
- Do **not** drop MongoDB collections; write `docs/MIGRATION.md` listing collections that are now unused so Mohit can archive them.
- Update `swagger.json` for all new endpoints. Finalise `docs/API.md`, `docs/ARCHITECTURE.md` (diagram of jobs, clients, models), `docs/OPERATIONS.md` (env vars, running jobs, backfills, quotas, costs per run).

**Gate: final review.**

---

## 13a. PHASE 10 — Security hardening (gated)

Runs after Phase 9. (This was Phase 2 before the 2026-09-25 re-prioritisation.)

Do not start this phase unless Mohit says so in the session. If approved, Mohit will specify which items (S1–S30, see `docs/AUDIT.md`). Apply minimal, targeted fixes:

- Auth guards: add `adminAuthMiddleware.validateAdminJWTToken` (router-level `router.use(...)` where a whole router is admin-only; per-route otherwise). Admin creation additionally requires super-admin role.
- `/api/v1/logs`: admin-only or removed. `/system/*`: admin-only.
- Rate limiter mounted on `/api/v1/user/auth` and `/api/v1/admin/auth`; `app.set('trust proxy', 1)`.
- `mongoose.set('sanitizeFilter', true)` before connect.
- Multer: remove global mount; apply per route after auth; limits `{ fileSize: 10MB, files: 10 }`.
- Remove wildcard CORS middleware; full `helmet()`; drop polyfill.io; JSON/urlencoded limit `1mb`.
- PayPal webhook: verify via `POST {BASE_URL}/v1/notifications/verify-webhook-signature` with `PAYPAL_WEBHOOK_ID`.
- IDOR: fetch middlewares filter by `created_by: user._id`.
- Hardcoded credentials: already done (`utils/fileEncryption.ts` deleted in Phase 1.5; DataForSEO moved to env in Phase 1.6). The old DataForSEO credential must still be rotated.
- S19 admin JWT key: one key-derivation helper for every sign/verify, a startup assertion on secret format/length, algorithms pinned to HS256.

Each fix = its own commit. Add a regression test per auth fix (request without token → 401). **Gate.**

---

## 14. Cost & quota reference (for estimates in PROGRESS.md)

- Text Search IDs-only (`places.id`, `places.movedPlaceId`, `nextPageToken` only): free SKU. Up to 3 calls per point per keyword (usually fewer with `stopWhenFound`).
  - Unique points per keyword = tracker (5) ∪ grid (size²), with the center shared: 13 / 29 / 53 for 3×3 / 5×5 / 7×7 at 1 km spacing (fewer if tracker points land on grid points). Use `estimateCalls()` from `src/ranking/estimate.ts`.
  - 2 keywords × 3×3 ≈ 26–78 calls; 20 keywords × 7×7 ≈ **1,060–3,180** calls per run (the one retry can at most double this).
- Text Search with `displayName` (Pro SKU): 1 call per keyword per run (Map Ranking only).
- Place Details for competitor comparison: ~(1 + competitors) calls per report generation; Enterprise-tier fields. No reviews/photos by default.
- GBP APIs: no per-call charge; quota-limited. Keep ≤ 5 req/s per job.

Log `api_calls` on every run/report so real costs can be measured.

---

## 15. Things you must never do

- Touch out-of-scope modules (except Phase 10 items if approved, and minimal shared-file edits called out explicitly).
- Call paid APIs in unit tests, or run full-size grids during development.
- Add any field to the IDs-only Text Search field mask.
- Fetch third-party data on a GET page view (all heavy work happens in jobs). The only exception is `GET map-ranking?resolveNames=true`, which works only when `STORE_PLACE_NAMES=false` and the caller explicitly asks for it (pending a ToS decision).
- Store secrets in code, logs, fixtures, or docs.
- Implement Q&A, organic ranking, DataForSEO, Moz, or SerpAPI.
- Start the next phase without approval.
