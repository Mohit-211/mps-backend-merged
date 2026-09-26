# Status: where we are

_Rewritten at the end of every phase. History is in [PROGRESS.md](PROGRESS.md); findings are in [AUDIT.md](AUDIT.md). Last updated: 2026-09-26, end of Phase 5.5 (live validation)._

## Product goal

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
| **6 GBP connection** | **Planning** | `claude/phase-6-gbp-connection` | — | M3 |
| 7 GBP sync + report | Not started | — | — | M3 |
| 8 GBP posting | Not started | — | — | M4 |
| 9 Cleanup | Not started | — | — | M4 |
| 10 Security (gated) | Deferred | — | — | — |

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
- **Tests:** 273 pass with no API key and no network.

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
| 2026-09-26 | Phases 6–7 live GBP calls: free but quota-limited, max 5 requests/second, only against the account Mohit connects, and nothing live until Mohit says so (first step: `gbp:preflight`, triggered by Mohit). |

## Open items (owner: Mohit)

1. **ToS decision on business names before production launch:** `STORE_PLACE_NAMES` (store them, the current default, or resolve them live with `?resolveNames=true`). The same question applies to competitor Place Details in Phase 7.
2. **Rotate the DataForSEO credential** (it is in git history on GitHub, AUDIT S13).
3. **GBP API access approval** (quota > 0), and the GBP OAuth client in Google Cloud, before Phase 6 live steps.
4. **Security Phase 10:** deferred. The new ranking endpoints already check ownership; the legacy ones do not (S15).

## Backlog (not now)

- **Big-market test (Dallas):** Workman Plumbing (`ChIJjcMu_6CZToYRXut5OjLd6V4`, 2310 N Henderson Ave #522, 32.814438, -96.777703; the "#522" may be a mailbox suite, so confirm the storefront first). Keywords "plumber", "emergency plumber", "plumber dallas", 3×3 at 1.5 km (9 unique points per keyword; about 27–81 IDs-only + 3 Pro).
- **Variance test:** repeat identical searches at the same point and measure the rank spread. Round 1 vs Round 2 showed 5 → 1 at one grid point and a competitor moving #8 → #2 in the Pro list.
- **Formal `calibrate:score`:** fill in the manual columns (tracker rows are enough: `--tracker-only`) and record the verdict.
- **Overall-average UX:** when one keyword is 60+ everywhere it counts as 61 and dominates `overallAvgRank` (Round 1: 31.2 from 1.4 and 61). Decide how the page explains or presents it.

## Next up

**Phase 6, GBP connection** (CLAUDE.md §10), in plan mode first. Then **Phase 7, GBP sync + report** (§11), also in plan mode.
- Token encryption (`tokenCrypto`, AES-256-GCM) and `gbpClient` (refresh, re-encrypt on rotation, timeout, retry, 429 backoff), deferred from Phase 3.
- Random one-time OAuth state (`OAuthState`, 10 minutes); the `business.manage` scope only.
- C17: tokens keyed by user and token type; correct `expiry_date`; refreshed tokens persisted.
- Discovery of **all** accounts and their locations (paginated, with `readMask`). C22: no Places calls on `GET /gbp`.
- Binding to our Location, including `place_id` from `metadata.placeId` (set if empty, never overwrite).
- C12: a real unbind. `npm run gbp:preflight -- <userId>` (read-only, reports "quota 0").

**Frontend (can start now):** build the three ranking pages against `docs/API.md`, using `npm run seed:rank-demo`.

## How to run

See [OPERATIONS.md](OPERATIONS.md) for:
- setup and local MongoDB (`mps_rebuild`)
- `npm run dev`, `npm test` and `npm run build`
- `npm run seed:rank-demo` (demo data, no key)
- the ranking jobs
- the smoke scripts: `smoke:agenda` (free), and `smoke:places` (1 Places call; Mohit only)
- live validation: [LIVE_TEST.md](LIVE_TEST.md) (`find:place`, `setup:live-test`, `calibrate`, `calibrate:score`)
