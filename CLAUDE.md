# CLAUDE.md — MyPageSEO backend (mps-backend-merged)

Read this whole file at the start of every session. It defines what the product is, what you may and may not touch, and the exact order of work. Work **bottom to top**: foundations first, features after. Never skip a phase gate.

---

## 0. Product intent (what we are building)

MyPageSEO is a **local SEO reporting platform** for US and Canadian businesses. It is about **Google Maps / Google Places visibility only**. Website (organic) SEO is permanently out of scope.

Deliverables of this rebuild:

1. **Rank Tracker page**: average Maps rank per keyword and overall, from a small set of points around the business.
2. **Local Search Grid page**: rank heatmap per keyword over a 3×3 / 5×5 / 7×7 grid.
3. **Local Map Ranking page**: "who ranks at your location", the top 20 businesses per keyword at the business location, with the client highlighted.
4. **GBP Report page**: the client's Google Business Profile performance, profile health, reviews, search keywords, and a competitor comparison.
5. **GBP Posting**: create, schedule and manage posts on the client's profile (existing feature, to be kept and improved).

All three ranking pages are powered by **one ranking engine** and **one fixed keyword set per location**. Ranking uses **Google Places API (New) Text Search**, not SerpAPI.

---

## 1. Scope

### IN scope (you may modify)
- Ranking: rank tracker, local search grid, local map ranking (models, routes, middlewares, controllers, services, helpers).
- GBP: OAuth connection, GBP data sync, GBP audit/report, GBP posting, related jobs.
- Location model: only the additions defined in this file.
- Shared infrastructure these features need: config, Google API clients, agenda jobs, logging, tests.
- Security fixes, **only in Phase 2 and only after explicit approval** (see §6).

### OUT of scope (do not modify, do not refactor, do not reformat)
- Citations (all `citation*` files and models), blog, blog categories, FAQ, support, contact-us, white-label, countries/states/cities, languages, timezones, roles, business categories.
- Payments and subscriptions (Square, PayPal, Razorpay, coupons, plans, credits), **except** the security items listed in Phase 2 if approved.
- Admin panel features, except the Phase 2 security items if approved.

If an in-scope change *requires* touching an out-of-scope file (e.g. a shared util or `src/models/index.ts` export), make the smallest possible change and call it out explicitly in the phase summary.

### Permanently removed from product
- Organic/website ranking (desktop/mobile organic), DataForSEO search volume, Moz, SerpAPI-based ranking, Search Console "average position" helpers.
- Google Q&A (the Q&A API was discontinued on 2025-11-03; do not implement anything Q&A).

---

## 2. Working rules (apply to every phase)

### Git
- Never commit to `main`. Base branch for all work: `claude/rebuild`. One sub-branch per phase: `claude/phase-<n>-<slug>`, merged into `claude/rebuild` only after Mohit approves.
- Small commits, one concern each. Message format: `<phase>: <area>: <what>` e.g. `p4: ranking: add IDs-only text search client`.
- Never rewrite history on shared branches. Never force-push `claude/rebuild`.
- The old code is backed up separately by Mohit. Deleting old in-scope code is allowed **only in the phase that explicitly says so**.

### Environment & safety
- Work only against a **local MongoDB** and a local `.env`. Never use production credentials, never connect to production DB, never SSH anywhere.
- Never print, log, or commit secrets. Never hardcode credentials (the old code has a hardcoded DataForSEO login; that pattern is banned).
- API keys used during development must be **test keys with low quotas/budget caps**. If a required key is missing, stop and ask; do not stub a real-looking key.
- When calling real Google APIs during development: max **2 keywords**, **3×3 grid**, **1 location** per test run. Log how many API calls each test run made.

### Quality gates (every commit)
- `npm run build` passes with zero TypeScript errors in files you touched.
- `npm run lint` passes for files you touched (don't mass-fix out-of-scope files).
- New pure logic (ranking math, matching, change calculation, health score, grid generation) has unit tests.
- External API calls are wrapped in a client module that can be mocked; unit tests never hit the network.

### Phase gates
At the end of every phase:
1. Stop.
2. Write/update `docs/PROGRESS.md` with: what changed, files touched, decisions made, open questions, API calls consumed.
3. Summarise to Mohit and **wait for approval** before starting the next phase.

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
- Mongo + agenda: `src/configs/mongoConnection.ts` exports `agenda` (processEvery 1 minute). `src/configs/agenda.ts` is **empty**. The only agenda job today is `post-to-gbp` in `src/jobs/postToGbp.ts`.
- Production runs via pm2 with `instances: "max"` (cluster mode). Anything using in-memory state (node-cache, rate-limit memory store, node-cron) runs once **per instance**. Jobs must use agenda (Mongo-locked), never node-cron.
- Config: `src/configs/config.ts` (Joi-validated env). Places key is `GOOGLE_PLACE_API_KEY` → `config.googleApis.placeApi.keySecret`.
- OAuth: `src/configs/oAuth2Client.ts` exports a **function** `oAuth2Client(type)`; GBP and Analytics clients differ. Tokens stored in `UserAuth` model (`access_token`, `refresh_token`, plaintext). GBP binding in `UserGBP` (`gbpAccountId`, `gbpLocationId`).
- Location model (`src/models/location.model.ts`): `name, city, state, country, lat, lng, mobile, place_id, website_URL, created_by, is_active`.
- Old ranking: `helpers/rankTrackerReport.ts`, `helpers/localSearchGridReport.ts` (`generateGrid()` math is correct and reusable), `helpers/localMapRankingReport.ts`, `services/common/{rankTracker,localSearchGrid,localMapRankingReport}.service.ts`, `services/common/serp.ts` (dead), matching middlewares/models/routes.
- Old GBP: `helpers/gbpAudit.ts` (legacy Places API, organic rank, Moz placeholders), `services/common/gbpAudit.service.ts` (recomputes on every GET), `helpers/gbpPs.ts` (first account only, no readMask), `services/common/gbpPostSchedular.service.ts` + `jobs/postToGbp.ts` (v4 localPosts + agenda, keep).

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
- **Change vs previous run**: only computed when both runs have the **identical keyword set** (same `keywords_version`).
  - Both `ok`: `change = previous - current` (positive = improved).
  - `not_found → ok`: label `entered_top_60`, no numeric change.
  - `ok → not_found`: label `dropped_out_of_top_60`, no numeric change.
  - Either side `error`: `change = null`.
- **Rank buckets (for UI)**: 1–3 `pack`, 4–10 `visible`, 11–20 `low`, 21–60 `invisible`, 60+ `not_found`, `error`.

### Sample points
- **Rank Tracker points**: center + 4 compass points at `offsetKm = 1.5` (N, S, E, W). 5 points total.
- **Grid points**: `generateGrid(center, size ∈ {3,5,7}, spacingKm)`. Center point is always included.
- **Center**: location `lat/lng`. If missing, resolve once from `place_id` via Place Details (field `location`) and save to the Location.
- Every Text Search uses `locationBias.circle` centered on the sample point, radius **5000 m** (configurable), `regionCode` from the location country (`US → us`, `Canada → ca`).

### Keywords
- Fixed per location: `location.tracking.keywords` (max **20**, trimmed, lowercased for comparison, de-duplicated, original casing kept for display).
- Editing keywords increments `keywords_version` and sets `keywords_updated_at`. Change calculations never compare across versions.

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
5. **Unused dependencies removed:** `http-proxy-middleware`, `http-status-codes`, `fs-extra`, `razorpay`. `@paypal/checkout-server-sdk` is **on hold**: `configs/paypal.ts` imports it, and Mohit decides whether to remove it.

The pre-existing build errors (46 TypeScript errors, see AUDIT §0) are not fixed in this phase.

---

## 6. PHASE 2 — Security hardening (GATED: only if Mohit explicitly approves)

Do not start this phase unless Mohit says so in the session. If approved, Mohit will specify which items (S1–S15). Apply minimal, targeted fixes:

- Auth guards: add `adminAuthMiddleware.validateAdminJWTToken` (router-level `router.use(...)` where a whole router is admin-only; per-route otherwise). Admin creation additionally requires super-admin role.
- `/api/v1/logs`: admin-only or removed. `/system/*`: admin-only.
- Rate limiter mounted on `/api/v1/user/auth` and `/api/v1/admin/auth`; `app.set('trust proxy', 1)`.
- `mongoose.set('sanitizeFilter', true)` before connect.
- Multer: remove global mount; apply per route after auth; limits `{ fileSize: 10MB, files: 10 }`.
- Remove wildcard CORS middleware; full `helmet()`; drop polyfill.io; JSON/urlencoded limit `1mb`.
- PayPal webhook: verify via `POST {BASE_URL}/v1/notifications/verify-webhook-signature` with `PAYPAL_WEBHOOK_ID`.
- IDOR: fetch middlewares filter by `created_by: user._id`.
- Delete `utils/fileEncryption.ts`; remove hardcoded credentials.

Each fix = its own commit. Add a regression test per auth fix (request without token → 401). **Gate.**

---

## 7. PHASE 3 — Foundations

### 3.1 Config (`src/configs/config.ts`)
Add (Joi-validated, all optional in dev unless marked required):
```
GOOGLE_PLACE_API_KEY          (existing, required)
PLACES_SEARCH_RADIUS_M        default 5000
RANK_MAX_KEYWORDS             default 20
RANK_TRACKER_OFFSET_KM        default 1.5
RANK_DEV_MAX_KEYWORDS         default 2      (enforced when NODE_ENV=development)
OAUTH_STATE_SECRET            required       (HMAC for OAuth state)
TOKEN_ENCRYPTION_KEY          required       (32-byte hex, AES-256-GCM for stored OAuth tokens)
GBP_SYNC_ENABLED              default true
```
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
- `src/clients/gbpClient.ts`: all GBP calls, takes a location binding, handles access-token refresh via the stored refresh token (decrypt → refresh → re-encrypt on rotation). Methods are defined in Phase 6/7.

### 3.3 Token security
- `src/utils/tokenCrypto.ts`: AES-256-GCM `encrypt/decrypt` using `TOKEN_ENCRYPTION_KEY`.
- Migration script `src/scripts/encryptExistingTokens.ts` (idempotent; detects already-encrypted values). **Do not run it**; document how to run it in `docs/PROGRESS.md`.

### 3.4 Jobs infrastructure
- Implement `src/configs/agenda.ts` as the single job registry: `defineAllJobs()` registers jobs from `src/jobs/*`. Keep existing `post-to-gbp` behaviour identical (move its registration here if needed).
- Job conventions: idempotent, job data contains IDs only, per-job `lockLifetime`, concurrency limits, failures recorded on the related document (`last_error`, `last_run_at`).
- No node-cron for business logic. (Leave the existing heartbeat cron in `app.ts` untouched; out of scope.)

### 3.5 Test harness
- Add dev dependencies `jest`, `ts-jest`, `@types/jest`, `mongodb-memory-server`. Add `npm test`. Tests live in `tests/` mirroring `src/`.
- Fixtures: `tests/fixtures/places/*.json` and `tests/fixtures/gbp/*.json` (hand-written, realistic, no real personal data).

**Gate.**

---

## 8. PHASE 4 — Ranking engine (pure logic + Places client usage)

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

### 5.1 Location model additions
```ts
tracking: {
  keywords: [{ text: String, normalized: String }],   // max RANK_MAX_KEYWORDS
  keywords_version: Number,                             // default 1
  keywords_updated_at: Date,
  competitors: [String],                                // place_ids, max 5
  grid: { size: Number /*3|5|7*/, spacing_km: Number }, // default {5, 1}
  frequency: String,                                    // 'weekly' | 'monthly' | 'manual'
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

Prerequisite: Mohit confirms GBP API access is approved for the Cloud project (quota > 0). If calls return 429 with quota 0, stop and report; that is an access gate, not a rate limit.

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

### 7.1 Sync job `gbp-sync` (per bound location; daily at 03:00 location timezone; also "sync now")
Never fetch GBP data on a page view. Store everything; pages read from DB.

| Data | Endpoint | Store in |
|---|---|---|
| Daily metrics | `GET https://businessprofileperformance.googleapis.com/v1/{locations/ID}:fetchMultiDailyMetricsTimeSeries` with `dailyMetrics` = `BUSINESS_IMPRESSIONS_DESKTOP_MAPS, BUSINESS_IMPRESSIONS_DESKTOP_SEARCH, BUSINESS_IMPRESSIONS_MOBILE_MAPS, BUSINESS_IMPRESSIONS_MOBILE_SEARCH, CALL_CLICKS, WEBSITE_CLICKS, BUSINESS_DIRECTION_REQUESTS, BUSINESS_CONVERSATIONS, BUSINESS_BOOKINGS, BUSINESS_FOOD_ORDERS, BUSINESS_FOOD_MENU_CLICKS` and `dailyRange` | `GbpMetricDaily` `{ location_id, date, metric, value }` unique index on (location_id, date, metric). First sync backfills 18 months; later syncs fetch the last 10 days (data lags; upsert). |
| Search keywords | `GET https://businessprofileperformance.googleapis.com/v1/{locations/ID}/searchkeywords/impressions/monthly` with `monthlyRange` | `GbpKeywordMonthly` `{ location_id, month, keyword, value \| threshold }`. Backfill 6 months; later monthly. Preserve "threshold" values as thresholds (don't coerce to numbers). |
| Profile | `GET https://mybusinessbusinessinformation.googleapis.com/v1/{locations/ID}?readMask=name,title,storefrontAddress,phoneNumbers,websiteUri,regularHours,specialHours,moreHours,serviceArea,categories,profile,openInfo,metadata,labels,serviceItems,latlng` + `GET .../v1/{locations/ID}/attributes` | `GbpProfileSnapshot` (latest + dated history) |
| Verification | `GET https://mybusinessverifications.googleapis.com/v1/{locations/ID}/VoiceOfMerchantState` | on snapshot |
| Reviews | `GET https://mybusiness.googleapis.com/v4/{accounts/A}/{locations/L}/reviews` (paginate; includes averageRating, totalReviewCount) | `GbpReview` upsert by review name (rating, comment, createTime, updateTime, reply, reply state, media) |
| Media | `GET https://mybusiness.googleapis.com/v4/{accounts/A}/{locations/L}/media` and `/media/customers` | counts + latest upload dates on snapshot |
| Posts | `GET https://mybusiness.googleapis.com/v4/{accounts/A}/{locations/L}/localPosts` | last post date, posts in last 30/90 days on snapshot |

Respect quotas: ≤ 5 requests/second per job, exponential backoff on 429. Record `last_synced_at` and errors per data type; a failure in one data type must not abort the others.

### 7.2 Profile health score (`src/gbp/healthScore.ts`, pure, unit-tested)
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

## 12. PHASE 8 — GBP Posting (keep, harden, extend)

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

## 13. PHASE 9 — Cleanup & documentation

Only after Mohit confirms the frontend has switched to the new endpoints:
- Delete old ranking code: `helpers/rankTrackerReport.ts`, `helpers/localSearchGridReport.ts` (after `generateGrid` is ported), `helpers/localMapRankingReport.ts`, `helpers/getSerpCountryCode.ts` if unused, `services/common/serp.ts`, old ranking services/controllers/middlewares/routes/models, `configs/serpConfig.ts`, `constants/serpCountryCode.ts` if unused.
- Delete old GBP audit code: `helpers/gbpAudit.ts`, `services/common/gbpAudit.service.ts` and its route/controller/middleware/model.
- Remove unused dependencies (`serpapi` and any others made unused). Remove SerpAPI/DataForSEO/Moz env vars from config and `.env.example`.
- Do **not** drop MongoDB collections; write `docs/MIGRATION.md` listing collections that are now unused so Mohit can archive them.
- Update `swagger.json` for all new endpoints. Finalise `docs/API.md`, `docs/ARCHITECTURE.md` (diagram of jobs, clients, models), `docs/OPERATIONS.md` (env vars, running jobs, backfills, quotas, costs per run).

**Gate: final review.**

---

## 14. Cost & quota reference (for estimates in PROGRESS.md)

- Text Search IDs-only (`places.id`, `places.movedPlaceId`, `nextPageToken` only): free SKU. Up to 3 calls per point per keyword (usually fewer with `stopWhenFound`).
  - Rank tracker: 5 points × K keywords. Grid: size² points × K (center shared). 7×7 × 20 keywords ≈ 980–2,940 calls per run.
- Text Search with `displayName` (Pro SKU): 1 call per keyword per run (Map Ranking only).
- Place Details for competitor comparison: ~(1 + competitors) calls per report generation; Enterprise-tier fields. No reviews/photos by default.
- GBP APIs: no per-call charge; quota-limited. Keep ≤ 5 req/s per job.

Log `api_calls` on every run/report so real costs can be measured.

---

## 15. Things you must never do

- Touch out-of-scope modules (except Phase 2 items if approved, and minimal shared-file edits called out explicitly).
- Call paid APIs in unit tests, or run full-size grids during development.
- Add any field to the IDs-only Text Search field mask.
- Fetch third-party data on a GET page view (all heavy work happens in jobs).
- Store secrets in code, logs, fixtures, or docs.
- Implement Q&A, organic ranking, DataForSEO, Moz, or SerpAPI.
- Start the next phase without approval.
