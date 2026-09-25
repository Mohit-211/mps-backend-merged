# Status: where we are

_Rewritten at the end of every phase. History is in [PROGRESS.md](PROGRESS.md); findings are in [AUDIT.md](AUDIT.md). Last updated: 2026-09-26, end of Phase 4._

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
| **4 Ranking engine** | **Done, awaiting approval** | `claude/phase-4-ranking-engine` | not yet | M2 |
| 5 Ranking reports | Next | — | — | M2 |
| 6 GBP connection | Not started | — | — | M3 |
| 7 GBP sync + report | Not started | — | — | M3 |
| 8 GBP posting | Not started | — | — | M4 |
| 9 Cleanup | Not started | — | — | M4 |
| 10 Security (gated) | Deferred | — | — | — |

`main` is untouched (`62240ac`). There is no Phase 2; security moved to Phase 10.

## Done so far

- **Phase 1 audit:** 29 security findings (S1–S29) and 25 correctness findings (C1–C25) recorded with status in AUDIT.md, and all 155 routes listed in ROUTES.md.
- **Repo hygiene and build green:** LF everywhere, a tracked lockfile, `.env.example`, dead code and unused dependencies removed, 0 TypeScript errors, `.env` loaded from `ENV_FILE` or `./.env`.
- **Separate local database** `mps_rebuild` (Homebrew MongoDB 7.0). `MONGODB_AUTH_SOURCE` is required.
- **Background jobs (C25 fixed):** agenda has its own connection and starts from `src/server.ts`. The registry is `src/jobs/index.ts`, and new jobs use `defineJob` (IDs-only data).
- **Places API (New) client** `src/clients/placesClient.ts`: IDs-only search with a field-mask guard, up to 3 pages, `stopWhenFound`, `movedPlaceId`, a names search, Place Details, timeout and one retry, and call counts.
- **Ranking engine** `src/ranking/` (Phase 4):
  - tracker and grid points (the legacy grid math, ported)
  - rank cells and buckets
  - metrics and change labels, exactly as in CLAUDE.md §4
  - an engine with a run cache (center searched once per keyword), at most 4 searches at once with 100–300 ms jitter, and competitors ranked from the same lists
  - `estimateCalls()`, `regionFromCountry()` and the dev keyword cap
- **Tests:** 175 pass with no API key and no network.
- **Smoke scripts:** `smoke:agenda` (verified) and `smoke:places` (written, not run; needs the key).

## Key decisions

| Date | Decision |
|---|---|
| 2026-09-25 | Functionality first; security deferred to Phase 10 (gated). Phase 6 still builds the signed OAuth state and encrypted tokens. |
| 2026-09-25 | LF line endings everywhere. Local development uses its own `mps_rebuild` database; the server gets a fresh database after the rebuild. |
| 2026-09-26 | Ranking uses **Places API (New) Text Search, IDs-only** (free Essentials SKU). Names (Pro SKU) are used only for the Map Ranking list, 1 page at the center. |
| 2026-09-26 | Maximum depth is 60; a place not found is shown as **"60+"**. Averages count `not_found` as **61**; `error` cells are **excluded**. |
| 2026-09-26 | One **fixed keyword set per location** (max 20), versioned; changes are only compared within the same `keywords_version`. |
| 2026-09-26 | Keyword-level change labels: `entered_top_60` / `dropped_out_of_top_60` come from `foundRate` going 0 → >0 or >0 → 0; otherwise the change is the `avgRank` delta. Cell-level change follows §4. |
| 2026-09-26 | **Push only at milestones** M1–M4. Each phase ends with a local merge that Mohit approves. |
| 2026-09-26 | **No real Google API calls until Mohit says so.** All tests use mocks and fixtures. |

## Open items (owner: Mohit)

1. **Approve Phase 4 and merge it** (the command is in PROGRESS.md).
2. **Add `GOOGLE_PLACE_API_KEY`** (Places API New, restricted to that API, with a budget cap) before the live test. Then run `npm run smoke:places` yourself.
3. **Rotate the DataForSEO credential** (it is in git history on GitHub, AUDIT S13).
4. **GBP API access approval** (quota > 0) before Phase 6.
5. **ToS decision on storing place names** (`STORE_PLACE_NAMES`, Phase 5) and on competitor Place Details (Phase 7).
6. **Security Phase 10:** deferred; needs explicit approval and an item list.

## Next up

**Phase 5, ranking reports** (CLAUDE.md §9). It starts in plan mode.
- **Location** gets `tracking` settings: keywords (versioned), competitors, grid size and spacing, frequency, and next/last run.
- **`RankRun` model** (`rank_runs`), with history kept.
- **`rank-run` job:** resolves the center, builds targets, runs tracker and grid points through the engine, builds the map list (names search, 1 page), computes metrics and change against the previous comparable run, and records `api_calls`.
- **`rank-scheduler` job**, every 15 minutes.
- **Endpoints:** `PUT/GET tracking`, `POST/GET rank-runs`, `GET rank-tracker`, `GET grid`, `GET map-ranking`. All require user auth and ownership.
- **M2 deliverables:** `docs/API.md` (example responses built from fixtures) and a live-test checklist (the smoke script first, then 1 location × 2 keywords × a 3×3 grid, which is 26–78 IDs-only calls plus 2 Pro). Then the push.

## How to run

See [OPERATIONS.md](OPERATIONS.md) for:
- setup and `.env`
- local MongoDB (`mps_rebuild`)
- `npm run dev`, `npm test` and `npm run build`
- the smoke scripts: `smoke:agenda` (free), and `smoke:places` (1 Places call; Mohit only)
