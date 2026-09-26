# Removed legacy features: reference for rebuilding

Written for Mohit and his developers. These features were removed in the legacy cleanup (branch `claude/phase-9a-legacy-cleanup`) because they were broken, depended on removed services (SerpAPI, Moz, DataForSEO), or were replaced by the rebuilt ranking and GBP code.

**Where the code is.** The last commit that still has all of it is **`1695187`**:

```sh
git show 1695187:src/services/common/reputationManagerReport.service.ts   # print one old file
git ls-tree -r --name-only 1695187 | grep -iE "reputation|rankTracker|gbpAudit|whitelabel|localSearchGrid|localMapRanking"
git checkout 1695187 -- <path>                                              # bring a file back
```

**Where the data is.** MongoDB collections were **not** dropped; see [MIGRATION.md](MIGRATION.md).

## Features to rebuild later

### 1. Reputation Manager (review monitoring)

**Old endpoint:**

| Method | Path | Auth |
|---|---|---|
| GET | `/api/v1/reputation-manager/monitor-reviews/:locationId` | user |

**What it did** (`helpers/reputationManagerReport.ts`, `services/common/reputationManagerReport.service.ts`):
- For the location's `place_id`, it paged through **all** Google reviews with SerpAPI's `google_maps_reviews` engine (newest first).
- It returned `{ placeInfo: { title, address, rating, reviews, type }, reviews: [{ rating, date, iso_date, snippet, user: { name, thumbnail, … }, likes, formatted_date, … }] }`.
- It ran on the request path and stored nothing.

**Why it was removed:**
- SerpAPI is permanently out of the product (CLAUDE.md §1), and the key was never configured, so every call failed (AUDIT C13).
- It fetched third-party data on page view (§15).
- It scraped Google through a third party instead of using the business owner's own data.

**How to rebuild it properly:**
- Use the **GBP API reviews** the owner is authorised for: `GET https://mybusiness.googleapis.com/v4/{accounts/A}/{locations/L}/reviews`.
  - This is already planned in Phase 7b: stored in `GbpReview`, full history, reply state, media.
  - It sits behind `GBP_V4_ENABLED` until Google approves v4 access.
- The page reads from the database. Add:
  - replying: `PUT …/reviews/{id}/reply`
  - alerts on new low ratings (a job)
  - the Phase 7c review stats: average rating, reply rate, median reply time, unreplied list
- **Competitors' reviews:** Places Details `reviews` returns only 5 and moves the call to the most expensive SKU (CLAUDE.md §7.3), so show only rating and count for competitors.

### 2. White-label report links (public report pages)

**Old endpoints** (all **unauthenticated**, AUDIT S17):

| Method | Path |
|---|---|
| GET | `/api/v1/white-label-profiles/rank-tracker-report/:whiteLevelProfileId` |
| GET | `/api/v1/white-label-profiles/gbp-audit-report/:whiteLevelProfileId` |
| GET | `/api/v1/white-label-profiles/reputation-manager-report/:whiteLevelProfileId` |

**What they did:**
- They loaded the `WhitelabelProfile` by id, then its `location_id`, and returned that location's legacy report (`validateWLPReportParams` in `middlewares/common/whiteLabelProfile.middleware.ts` → the old report services).
- Anyone with the profile id could read the report.
- The white-label profile itself stays: create, update and get, with `name`, `header`, `footer`, `color`, a file, `location_id` and a `reports` list (`rank_tracker`, `local_search_grid`, `citation_tracker`, `citation_builder`, `reputation_manager`, `gbp_audit`).

**Why they were removed:** they served the deleted legacy reports.

**How to rebuild them properly:**
- **Public share links with an unguessable token**, not the profile's database id: for example `WhiteLabelShare { token_hash, whitelabel_profile_id, location_id, reports: [...], expires_at, revoked_at }`, with the raw token only in the URL.
- **Read-only report views** from the rebuilt data:
  - Rank Tracker, Local Search Grid and Map Ranking from `RankRun` (reuse `rankTrackerView`, `gridView`, `mapRankingView` in `services/ranking/rankReports.service.ts`)
  - the GBP report from the Phase 7c report document
  - reviews from `GbpReview`
- **Never call Google on the public route** (§15). Apply the profile's branding (header, footer, colour) in the frontend.
- **Rate-limit** the public route and log access. This relates to the Phase 10 security work (S17).

### 3. Search Console connection ("analytics")

**Old endpoints:**

| Method | Path | Auth |
|---|---|---|
| GET | `/api/v1/user/auth/google/analytics` | user |
| GET | `/api/v1/user/auth/google/analytics/callback` | none |
| POST | `/api/v1/user/auth/google/analytics/revoke` | user |

**What it did:**
- An OAuth connect for Google **Search Console** (`webmasters.readonly`), despite the "analytics" name.
- Tokens were stored in `user_auths` with `token_type: 'ANALYTICS'` (plaintext) and `users.is_analytics_connected` was set.
- The only reader was the legacy rank tracker's "average position" helper, which was never called (AUDIT C11).

**Why it was removed:** organic / website SEO is permanently out of scope (§1). Its env vars (`GOOGLE_ANALYTICS_*`) and `configs/oAuth2Client.ts` went with it.

**If it's ever needed again:** build it like the GBP connection (`services/gbp/oauth.service.ts`): one-time hashed state, a verified id_token, encrypted tokens and one connection per Google account.

## Replaced (nothing to rebuild)

| Removed | Old endpoints | Replaced by |
|---|---|---|
| Rank Tracker (SerpAPI + DataForSEO + Search Console) | `POST /rank-tracker`, `GET /rank-tracker/:locationId` | `/locations/:id/rank-runs` + `GET /locations/:id/rank-tracker` (Phase 5; ENDPOINTS.md #3–6) |
| Local Search Grid (single SerpAPI search) | `POST /local-search-grid`, `GET /local-search-grid/:locationId` | `GET /locations/:id/grid` (#7) |
| Local Map Ranking (SerpAPI) | `POST /local-map-ranking`, `GET /local-map-ranking/:locationId` | `GET /locations/:id/map-ranking` (#8) |
| GBP Audit (legacy Places, recomputed on every GET) | `POST /gbp-audit`, `GET /gbp-audit/:locationId` | The GBP report (Phase 7c): health score, competitors, insights |

Also removed:
- **Helpers:** `helpers/{rankTrackerReport, localSearchGridReport, localMapRankingReport, gbpAudit, reputationManagerReport, getSerpCountryCode}.ts`. The `generateGrid()` math lives on in `src/ranking/points.ts`; its old output is kept as a test fixture.
- **Config:** `configs/{serpConfig, google-countries, google-domains, razorpay, gbpOauthClinet, oAuth2Client}.ts`, `constants/serpCountryCode.ts`.
- **Models:** the four legacy report models.
- **Dependency:** the `googleapis` package.
- **Legacy location create:** it now uses the Places (New) client with the `location` field only, instead of the legacy all-fields Place Details call (AUDIT C23).
