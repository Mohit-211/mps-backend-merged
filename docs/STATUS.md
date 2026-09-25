# Status: where we are

_Rewritten at the end of every phase. History is in [PROGRESS.md](PROGRESS.md); findings are in [AUDIT.md](AUDIT.md). Last updated: 2026-09-26, end of Phase 5 (milestone M2)._

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
| 4 Ranking engine | Done | `claude/phase-4-ranking-engine` | yes (`3da12ed`) | M2 (pending) |
| **5 Ranking reports** | **Done, awaiting approval** | `claude/phase-5-ranking-reports` | not yet | **M2 (pending)** |
| 6 GBP connection | Next | — | — | M3 |
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
- **Tests:** 239 pass with no API key and no network.

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

## Open items (owner: Mohit)

1. **Approve Phase 5, merge, and push M2.** The commands are in PROGRESS.md.
2. **Add `GOOGLE_PLACE_API_KEY`** (Places API New, restricted, with a budget cap), then follow [LIVE_TEST.md](LIVE_TEST.md): step 1 is `smoke:places` (1 call); step 2 is 1 location × 2 keywords × 3×3 (26–78 IDs-only, 2 Pro, 0–1 Details calls).
3. **ToS decision on business names:** `STORE_PLACE_NAMES` (store them, the current default, or resolve them live with `?resolveNames=true`). The same question applies to competitor Place Details in Phase 7.
4. **Rotate the DataForSEO credential** (it is in git history on GitHub, AUDIT S13).
5. **GBP API access approval** (quota > 0) before Phase 6.
6. **Security Phase 10:** deferred. The new ranking endpoints already check ownership; the legacy ones do not (S15).

## Next up

**Phase 6, GBP connection** (CLAUDE.md §10). It starts in plan mode and needs GBP API access approval first.
- Signed, one-time OAuth `state` in an `OAuthState` model; the `business.manage` scope only.
- `tokenCrypto` (AES-256-GCM) and encrypted token storage, moved here from Phase 3.
- `gbpClient` on `src/clients/http.ts`, with token refresh.
- Account and location discovery across **all** accounts, with pagination.
- Binding to our Location, including `place_id` from `metadata.placeId`.
- C12: a real unbind.

**Frontend (can start now):** build the three ranking pages against `docs/API.md`, using `npm run seed:rank-demo`.

## How to run

See [OPERATIONS.md](OPERATIONS.md) for:
- setup and local MongoDB (`mps_rebuild`)
- `npm run dev`, `npm test` and `npm run build`
- `npm run seed:rank-demo` (demo data, no key)
- the ranking jobs
- the smoke scripts: `smoke:agenda` (free), and `smoke:places` (1 Places call; Mohit only)
