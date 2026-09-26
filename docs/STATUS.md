# Status: where we are

_Rewritten at the end of every phase. History is in [PROGRESS.md](PROGRESS.md); findings are in [AUDIT.md](AUDIT.md). Last updated: 2026-09-26, end of Phase 7a (connect + onboarding)._

## Product goal

**Target product:** [product/frontend-roadmap.pdf](product/frontend-roadmap.pdf). Backend summary: [PRODUCT.md](PRODUCT.md). Screen → endpoint → status for the frontend team: [FRONTEND_BACKEND_MAP.md](FRONTEND_BACKEND_MAP.md).

MyPageSEO is a local SEO reporting platform for US and Canadian businesses, focused only on **Google Maps / Places visibility**. There are three ranking pages, **Rank Tracker**, **Local Search Grid** and **Local Map Ranking**, all powered by one ranking engine and one fixed keyword set per location. There is also a GBP report and GBP posting.

**Out of scope:** organic/website ranking, SerpAPI, DataForSEO, Moz, and Google Q&A.

## Phases

| Phase | State | Branch | Merged into `claude/rebuild` | Pushed |
|---|---|---|---|---|
| 1 Audit | Done | `claude/phase-1.5-hygiene` | yes (`e4a7419`) | yes, before M1 |
| 1.5 Repo hygiene | Done | `claude/phase-1.5-hygiene` | yes (`e4a7419`) | yes, before M1 |
| 1.6 Build green | Done | `claude/phase-1.6-build-green` | yes, via `53986e0` | M1 |
| 3 Foundations | Done | `claude/phase-3-foundations` | yes (`53986e0`) | M1 (2026-09-26) |
| 4 Ranking engine | Done | `claude/phase-4-ranking-engine` | yes (`3da12ed`) | M2 (2026-09-26) |
| 5 Ranking reports | Done | `claude/phase-5-ranking-reports` | yes (`2bb4cf8`) | M2 (2026-09-26) |
| 5.5 Live validation | Done: **informal pass, one market, formal scoring pending** | `claude/phase-5.5-live-validation` | yes (`5735bad`) | M3 |
| 6 GBP connection | Done | `claude/phase-6-gbp-connection` | yes (`4e4d556`) | M3 |
| **7a Connect + onboarding** | **Done (review fixes in), awaiting merge** | `claude/phase-7a-connect-onboarding` | not yet | M3 |
| **9a Legacy cleanup** (early Phase 9) | **Done, awaiting merge after 7a** | `claude/phase-9a-legacy-cleanup` | not yet | M3 |
| **7b GBP sync (monthly cadence)** | **Done, awaiting merge (after 7a, 9a)** | `claude/phase-7b-gbp-sync` (from 9a) | not yet | M3 |
| Live test with MyPageSEO | After 7b | — | — | — |
| 7c Scoring + report + competitors | Not started | — | — | **M3** |
| 8 Auth, Organization, Onboarding & Locations | Not started (plan mode + data-model diagram first) | — | — | M4 (to be agreed) |
| 9 GBP posting (was 8; needs v4) | Not started | — | — | — |
| 9b Remaining cleanup (was 9) | Not started | — | — | — |
| 10 Security (gated) | Deferred | — | — | — |

`main` is untouched (`62240ac`). There is no Phase 2; security moved to Phase 10. **Merge order:** 7a → 9a → 7b. After Phase 8 the next feature is chosen with Mohit (likely reports center, dashboards or citations).

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
- **Tests:** 453 pass with no API key and no network. Lint baseline is 32.

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

## Open items (owner: Mohit)

1. **Merge 7a, then 9a** (commands in the summary). No push: M3 comes after 7c.
2. **Google Cloud:**
   - Add the frontend's **Authorised JavaScript origin** to the OAuth client (needed for the popup).
   - `.env`: `TOKEN_ENCRYPTION_KEY` and the redirect URI on port 5055 (Phase 6).
3. **Live steps, when you say so** (PROGRESS.md, Phase 7a): popup connect → `gbp:preflight` → select-profile → competitor suggestions. Then the 7b first sync and the 7c report.
4. **Google My Business API (v4)** access is pending. Until then `GBP_V4_ENABLED=false` (7b).
5. **Frontend:** follow [FRONTEND_BACKEND_MAP.md](FRONTEND_BACKEND_MAP.md). The onboarding screens are in API.md "Onboarding", plus the grouped `GET /gbp` and `google_sub` on bind and disconnect.
6. **Maps ToS decisions before launch:** see "Decide before launch (Maps ToS)" below.
7. **Rotate the DataForSEO credential** (AUDIT S13).
8. **Security Phase 10:** deferred (includes S30 and the Search Console parts of S11, S12 and S29).

## Decide before launch (Maps ToS)

All three store or show Google Maps content. Confirm each against the Google Maps Platform terms before production:

1. **`STORE_PLACE_NAMES`** (default true in development): business names stored in `RankRun.mapList`. The alternative is to resolve them live with `?resolveNames=true`.
2. **The 24 h competitor-suggestion cache** (`Location.competitor_suggestions`): names, addresses, ratings and review counts from Text Search, kept for 24 hours per keyword set.
3. **Competitor Place Details** in the GBP report (7c): the latest comparison only, overwritten on each generation.

## Backlog (not now)

- **Big-market test (Dallas):** Workman Plumbing (`ChIJjcMu_6CZToYRXut5OjLd6V4`, 2310 N Henderson Ave #522, 32.814438, -96.777703; the "#522" may be a mailbox suite, so confirm the storefront first). Keywords "plumber", "emergency plumber", "plumber dallas", 3×3 at 1.5 km (9 unique points per keyword; about 27–81 IDs-only + 3 Pro).
- **Variance test:** repeat identical searches at the same point and measure the rank spread. Round 1 vs Round 2 showed 5 → 1 at one grid point and a competitor moving #8 → #2 in the Pro list.
- **Formal `calibrate:score`:** fill in the manual columns (tracker rows are enough: `--tracker-only`) and record the verdict.
- **Overall-average UX:** when one keyword is 60+ everywhere it counts as 61 and dominates `overallAvgRank` (Round 1: 31.2 from 1.4 and 61). Decide how the page explains or presents it.

## Next up

1. **Merge 7a → 9a → 7b** (commands in PROGRESS.md), then run `npm run migrate:refresh` on any database with existing locations.
2. **Live test with MyPageSEO** (you trigger it; order in [GBP_CONNECT.md](GBP_CONNECT.md)):
   1. popup connect
   2. `gbp:preflight`
   3. select-profile (links the existing MyPageSEO location by `place_id`)
   4. competitor suggestions (2 Enterprise Places calls)
   5. first GBP sync with `POST /locations/:id/refresh {"types":["gbp"]}` (about 11 free GBP calls)
   6. read `GET /locations/:id/gbp/sync`
3. **7c** (scoring, GBP report, competitors, `seed:gbp-demo`) in plan mode → **M3 push**.
4. **Phase 8: Auth, Organization, Onboarding & Locations**, in plan mode with a data-model diagram.

**Frontend:** build against [FRONTEND_BACKEND_MAP.md](FRONTEND_BACKEND_MAP.md). Screens marked "not supported" must not be built.

## How to run

See [OPERATIONS.md](OPERATIONS.md) for:
- setup and local MongoDB (`mps_rebuild`)
- `npm run dev`, `npm test` and `npm run build`
- `npm run seed:rank-demo` (demo data, no key)
- the ranking jobs
- the smoke scripts: `smoke:agenda` (free), and `smoke:places` (1 Places call; Mohit only)
- removed legacy features and data: [LEGACY_FEATURES.md](LEGACY_FEATURES.md), [MIGRATION.md](MIGRATION.md)
- live validation: [LIVE_TEST.md](LIVE_TEST.md) (`find:place`, `setup:live-test`, `calibrate`, `calibrate:score`)
- GBP: [GBP_CONNECT.md](GBP_CONNECT.md) (Google Cloud setup, popup and redirect connect, `gbp:preflight`, `gbp:encrypt-tokens`, `setup:live-test --token-only`)
- API reference: [ENDPOINTS.md](ENDPOINTS.md) (one-page list of every rebuilt endpoint) and [API.md](API.md) (full examples)

**Where each fact lives:**

| Topic | File |
|---|---|
| Current state and next step | this file |
| History and commit hashes | [PROGRESS.md](PROGRESS.md) |
| Findings and their status | [AUDIT.md](AUDIT.md) |
| Routes | [ROUTES.md](ROUTES.md) |
| Rules and phase specs ("as built" notes) | [CLAUDE.md](../CLAUDE.md) |
