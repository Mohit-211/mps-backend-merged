# Status: where we are

_Rewritten at the end of every phase. History is in [PROGRESS.md](PROGRESS.md); findings are in [AUDIT.md](AUDIT.md). Last updated: 2026-09-26, start of Phase 4._

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
| **4 Ranking engine** | **In progress** | `claude/phase-4-ranking-engine` | — | M2 |
| 5 Ranking reports | Not started | — | — | M2 |
| 6 GBP connection | Not started | — | — | M3 |
| 7 GBP sync + report | Not started | — | — | M3 |
| 8 GBP posting | Not started | — | — | M4 |
| 9 Cleanup | Not started | — | — | M4 |
| 10 Security (gated) | Deferred | — | — | — |

`main` is untouched (`62240ac`). There is no Phase 2; security moved to Phase 10.

## Done so far

- **Phase 1 audit:** every file read. 29 security findings (S1–S29) and 25 correctness findings (C1–C25) recorded with status in AUDIT.md, and all 155 routes listed in ROUTES.md.
- **Repo hygiene:** LF line endings everywhere (with `.git-blame-ignore-revs`), a tracked lockfile, `.env.example`, dead code and unused dependencies removed.
- **Build green:** 0 TypeScript errors (was 46). `.env` is loaded from `ENV_FILE` or `./.env`. DataForSEO credentials moved out of the code.
- **Separate local database** `mps_rebuild` (Homebrew MongoDB 7.0). `MONGODB_AUTH_SOURCE` is required, and the old `mps_db` is not referenced anywhere.
- **Background jobs work (C25):** agenda has its own DB connection and starts from `src/server.ts`. The registry is `src/jobs/index.ts`, and new jobs use `defineJob` (IDs-only data).
- **Places API (New) client** `src/clients/placesClient.ts`: IDs-only Text Search with a field-mask guard, up to 3 pages, `stopWhenFound`, `movedPlaceId`, a names search (1 page), Place Details, 15 s timeout, one retry, and per-SKU call counts.
- **Test harness:** jest, ts-jest, mongodb-memory-server and hand-written fixtures. 65 tests pass with no API key and no network.
- **Smoke scripts:** `smoke:agenda` (verified) and `smoke:places` (written, not run; needs the key).

## Key decisions

| Date | Decision |
|---|---|
| 2026-09-25 | Functionality first; security deferred to Phase 10 (gated), after Phase 9. Phase 6 still builds the signed OAuth state and encrypted token storage. |
| 2026-09-25 | LF line endings everywhere (`.gitattributes`, `.editorconfig`, Prettier). |
| 2026-09-25 | Local development uses its own `mps_rebuild` database; the server gets a fresh database after the rebuild. |
| 2026-09-26 | Ranking uses **Places API (New) Text Search, IDs-only field mask** (free Essentials SKU). Names (Pro SKU) are used only for Map Ranking, 1 page. |
| 2026-09-26 | Maximum depth is 60 results; a place not found is shown as **"60+"**. |
| 2026-09-26 | Averages count `not_found` as **61**; `error` cells are **excluded**. |
| 2026-09-26 | One **fixed keyword set per location** (max 20), versioned; changes are never compared across keyword versions. |
| 2026-09-26 | **Push only at milestones** M1 (after 3), M2 (after 5), M3 (after 7), M4 (after 9). Each phase ends with a local merge that Mohit approves. |
| 2026-09-26 | **No real Google API calls until Mohit says so.** All tests use mocks and fixtures. |

## Open items (owner: Mohit)

1. **Add `GOOGLE_PLACE_API_KEY`** (Places API New, restricted to that API, with a budget cap) before the live test. Then run `npm run smoke:places` yourself.
2. **Rotate the DataForSEO credential.** The old one is in git history on GitHub (AUDIT S13).
3. **GBP API access approval** for the Cloud project (quota > 0) before Phase 6.
4. **ToS decision on storing place names** (`STORE_PLACE_NAMES`, Phase 5) and on caching competitor Place Details (Phase 7).
5. **Security Phase 10:** deferred; needs explicit approval and an item list (AUDIT §5).

## Next up

**Phase 4, ranking engine** (`src/ranking/`, pure logic, CLAUDE.md §4 and §8):
- `points.ts`: tracker points (center plus 4 points at 1.5 km) and grid points (3/5/7, ported from `generateGrid`).
- `rankCell.ts` and `metrics.ts`: rank cells, buckets, `avgRank`, `foundRate`, `top3Rate`, overall average, and change labels.
- `engine.ts`: searches points through a run-level cache, runs at most 4 searches at once, and ranks every target (client and competitors) from the same result lists.
- `estimateCalls(keywords, gridSize)`: minimum and maximum IDs-only and Pro calls per run.
- Tests with mocks only: geometry, edge cases, change labels, cache hits, pool limit, estimator.

**Phase 5, ranking reports:** tracking settings on Location, the `RankRun` model, the `rank-run` job and `rank-scheduler`, and the endpoints `rank-tracker`, `grid` and `map-ranking`.

**M2 deliverables:** `docs/API.md` (example responses built from fixtures) and a live-test checklist with expected API calls per step. Then the push.

## How to run

See [OPERATIONS.md](OPERATIONS.md) for:
- setup and `.env`
- local MongoDB (`mps_rebuild`)
- `npm run dev`, `npm test` and `npm run build`
- the smoke scripts: `smoke:agenda` (free), and `smoke:places` (1 Places call; Mohit only)
