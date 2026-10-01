# Phase 17 (pulled forward): ranking extras for the real ranking pages

## Context

Mohit reviewed the real ranking pages, and the frontend Claude sent a list of backend needs (2026-10-01):
- larger grids that reach ~5 miles
- map pins for Map Ranking
- keyword changes that survive edits
- keyword groups
- history for charts
- wording for "Google Maps vs Local Finder"
- report rows with the run date
- competitor names, at most 5 competitors

This is the roadmap's Phase 17 ("keyword groups, larger grids"), pulled forward. Branch `claude/phase-17-ranking-extras` from `master` (85ef65d). Its spec goes into CLAUDE.md first.

**Decisions (Mohit, 2026-10-01):**
- Grid sizes **3, 5, 7, 9, 11, 13**, settable by **radius up to 15 km** (or spacing); default **7×7 at 8 km** (~5 mi); run cap raised to **40,000 calls**.
- **Flat token cost** per manual refresh, whatever the grid.
- **Per-keyword change across keyword edits**, with the overall change on the shared keywords.
- Competitors: the best practice for now; **max 5 per location** (already enforced); show competitor rankings.

**Facts this rests on:**
- Grid searches use the free IDs-only Text Search SKU, so bigger grids cost run time and quota, not money. At 20 keywords × 3 samples × 3 pages, a run is about 15.3k calls (9×9, ~32 min), 22.5k (11×11, ~47 min) or 31k (13×13, ~65 min) at `PLACES_MAX_QPS` 8.
- The run cap is `RANK_MAX_CALLS_PER_RUN` (16k now). Duration is already estimated (`estimateDuration`), and the stuck guard scales with it.

## Plan

### A. Grid size and coverage
- **Sizes:** `GRID_SIZES` = 3–13 odd (`src/ranking/points.ts`, `isGridSize`).
- **`PUT /tracking` `grid`:** `{ size, radius_km }` or `{ size, spacing_km }`; radius 0.5–15 km, spacing derived as radius ÷ ((size − 1) / 2), allowed 0.1–15 km. Both are stored and returned in `tracking.grid` and `run.config` (`radius_km` added).
- **Default for new locations:** `{ size: 7, radius_km: 8 }` (`trackingSettings.ts` `withDefaults`; fresh database, so no migration).
- **Tracker / Map Ranking offset:** derived per location as `max(0.5, radius_km / 2)`. The global `RANK_TRACKER_OFFSET_KM` is removed; `run.config.tracker_offset_km` stays.
- **Search bias radius stays a global 5 km.** It models a searcher at each point; the grid itself spreads the points. Documented as confirmed.
- **Run cap:** `RANK_MAX_CALLS_PER_RUN` default 40,000 (`config.ts`, `.env.example`, OPERATIONS).
- **New `GET /locations/:id/tracking/estimate?size=&radius_km=|spacing_km=&keywords=`** (keywords = a count, default the current set). It returns:
  - `{ points, calls: { ids_only, pro, details, total } (min / max ranges), expected_duration_ms, token_cost (rankings), over_cap }`
  - It reuses `estimateCalls` / `estimateDuration` (`src/ranking/estimate.ts`); there are no Google calls. `PUT /tracking` also returns `estimate` for the saved settings.

### B. Map pins for Map Ranking
- The Pro field mask `WITH_NAMES_FIELD_MASK` adds `places.location,places.formattedAddress`. Both are Text Search Pro fields; I'll confirm against Google's SKU table before adding them. The field-mask guard and tests are updated; the IDs-only mask is untouched.
- **Stored:** `mapList[].results[]` gains `lat`, `lng`, `address`. **Returned:** `GET map-ranking` adds them; older runs answer `null`.

### C. Keyword change across edits (methodology change)
- **Previous run:** the latest done or partial run of the location, any `keywords_version` (`rankRunExecutor.ts`).
- **Per keyword:** compared when the keyword (normalised) is in both runs (`keywordChange`, cell changes as today); new keywords get `null`.
- **Overall:** `change` compares both runs' averages over the **shared keywords only**, plus `comparable_keywords` and `keywords_total` on `overall[target]`.
- **Docs:** CLAUDE.md §4 rewritten; CHANGELOG entry (charts mark the change); API.md.
- **When edits take effect:** new keywords count from the next run (scheduled or manual), and from the reports generated from it. Documented.

### D. Keyword groups
- **Data:** `Location.tracking.keyword_groups: [{ _id, name (1–60), keywords: [normalised] }]`, at most 20 groups. A keyword can be in many groups or none. Groups don't bump `keywords_version`. Removing a keyword from tracking removes it from its groups.
- **Endpoints:** `GET /locations/:id/keyword-groups`, `POST` (`{ name, keywords }`), `PATCH /:groupId`, `DELETE /:groupId` (owner/member write; client_user read). `GET /tracking` returns `keyword_groups`.
  - **400** `unknown_keyword` (not tracked), `too_many_groups`; **409** `group_name_taken`.
- **`?group=<groupId>`** on `rank-tracker` and `grid` filters the keywords. `rank-tracker` always adds `groups: [{ group_id, name, keywords, summary: { [target]: { avgRank, foundRate, top3Rate, change, comparable_keywords } } }]` (means of the keyword summaries; change on shared keywords). 404 `group_not_found`.
- **Rank Tracker report:** an optional section `keyword_groups`.

### E. History for charts
- **New `GET /locations/:id/keyword-history?keyword=&limit=`** (limit 1–24, default 12): `{ keyword, runs: [{ run_id, run_at, status, summary: { [target]: { avgRank, foundRate, top3Rate } } }] }`, oldest first. Runs without the keyword are skipped. **404** `keyword_not_tracked` for a keyword that isn't tracked now.
- **Competitor overall history** comes from `GET /rank-runs` (`overall` per target, already there). Confirmed and documented.

### F. Competitors (max 5) with names, best practice for now
- **Max 5:** stays (`validateCompetitors`, `MAX_COMPETITORS = 5`); the error gets `reason: too_many_competitors`.
- **Names on save:** when `PUT /tracking` adds competitors, each new one gets a name, address and lat/lng. Sources, in order:
  1. the competitor-suggestion cache and the location's latest Map Ranking results (free)
  2. otherwise one Place Details call (`displayName,formattedAddress,location`), counted in the usage ledger and the daily Places cap

  Stored in `tracking.competitor_info: [{ place_id, name, address, lat, lng }]`.
- **Where names appear:** `GET /tracking` returns `competitors: [{ place_id, name, address, lat, lng }]`; run `targets` snapshot `{ key, place_id, name }` at run time, so every ranking page names its competitors. Competitor rankings are already in every summary, cell and overall (per target key).
- **Maps ToS:** names are Places content (accepted risk, attribution shown, as today).

### G. Reports and wording
- `GET /reports` rows for `rank_tracker` add `run_at` (from the frozen snapshot / the run). `POST /reports { run_id }` for an older run is confirmed and documented in API.md.
- **Wording to show:** "Rankings are Google Maps results, measured with the Google Places API from each point around your business." Local Finder and organic results are not supported; the frontend removes the switch. Recorded in FRONTEND_BACKEND_MAP.
- **API.md fix:** the stale "password-reset codes 6 digits" text in the auth section.

### Files (representative)
- **Pure:** `src/ranking/{points,estimate,metrics}.ts`
- **Services:**
  - `src/services/ranking/{trackingSettings,tracking.service,rankRunExecutor,rankReports.service,runPlan}.ts`
  - new `src/services/ranking/{keywordGroups,keywordHistory,competitorInfo}.ts`
  - `src/services/reports/{report.service,sections/rankTracker}.ts`
- **Clients and models:** `src/clients/placesClient.ts` (Pro mask, mapping), `src/models/{location,rankRun}.model.ts`
- **HTTP layer:** `src/middlewares/ranking/ranking.middleware.ts` (validators), `src/controllers/ranking/*`, `src/routes/v1/common/ranking.route.ts`
- **Config:** `src/configs/config.ts`, `.env.example`
- **Tests:**
  - points/estimate for 9–13
  - radius ↔ spacing
  - the change across versions (unit + route)
  - keyword groups CRUD + filters
  - keyword history
  - competitor names (cache, map list, Details fallback with a fake client)
  - map-ranking pins
  - the estimate endpoint
  - the report `run_at`
- **Docs:** CLAUDE.md (Phase 17 spec + §4 + roadmap), ENDPOINTS, API, FRONTEND_BACKEND_MAP, OPERATIONS (run cap, durations), CHANGELOG, STATUS, PROGRESS; Postman regenerated.

## Verification
- Build 0 errors, both tsc configs 0, lint stays 40 (0 in new code), full suite green, `check:endpoints` passes.
- A local dry run on the seeded demo (`seed:demo-orgs`, scripted Places client):
  - a 9×9 at 8 km run completes
  - grid / rank-tracker / map-ranking show the new fields
  - an estimate matches the run's call count
- No live Google calls. The first real large-grid run on the server is Mohit's (cost: ~100 Pro calls per 20-keyword run ≈ $3.20 at list price, the same as today).
