# Progress log

One entry per phase, newest at the bottom. Every commit is listed with its hash. The finding IDs (S*, C*) refer to [AUDIT.md](AUDIT.md), and each finding's `Status` there is the source of truth for what is done and what is pending.

## Tracker

Phase order (Mohit, 2026-09-25): functionality first, security deferred. There is no Phase 2; it moved to Phase 10.

| Phase | Branch | State |
|---|---|---|
| 1: Full codebase audit | `claude/phase-1.5-hygiene` (commit `5e8bdf2`) | Done |
| 1.5: Repo hygiene | `claude/phase-1.5-hygiene` | Done. Merged (`e4a7419`) and pushed. |
| 1.6: Build green | `claude/phase-1.6-build-green` | Done. Merged into `claude/rebuild` through the Phase 3 merge `53986e0` (no separate merge commit). Pushed at M1. |
| 3: Foundations | `claude/phase-3-foundations` | Done. Merged `53986e0`. **Pushed at M1 on 2026-09-26.** |
| 4: Ranking engine | `claude/phase-4-ranking-engine` | Done. Awaiting approval and local merge. Pushes at M2. |
| 5: Ranking reports | — | Not started |
| 6: GBP connection fixes | — | Not started (includes signed OAuth state, encrypted tokens, `gbpClient`, token crypto deferred from Phase 3, and C12) |
| 7: GBP data sync and report | — | Not started |
| 8: GBP posting | — | Not started |
| 9: Cleanup and docs | — | Not started |
| 10: Security hardening (gated) | — | Deferred; needs explicit approval |

Base branch: `claude/rebuild` (created from `main` @ `62240ac`; `main` is untouched). The current state is in [STATUS.md](STATUS.md).

---

## Phase 1: Full codebase audit (read-only)

**What changed:** no source changes. Added `docs/AUDIT.md`, `docs/ROUTES.md` and `docs/PROGRESS.md`.

**Baseline tooling** (run on a scratch copy so the repo was untouched):

| Check | Result |
|---|---|
| `npm run build` | fails, 46 TS errors (44 from `mongoFunctions` typing, 2 from C11); the script also copies missing files |
| `npm run lint` | 115 errors (unquoted glob; only one directory level is linted) |
| `npm audit` | 1 high, 5 moderate |

**Headline findings:**
- All 26 known issues are confirmed (S1–S15, C1–C11).
- 14 new security findings (S16–S29). Among them:
  - S16: path traversal and arbitrary file read (tested).
  - S17: unauthenticated exposure of location and white-label data, including `access_password`.
  - S19: the admin JWT key can be empty if `JWT_SECRET` is not hex (tested).
  - S20: cross-tenant OAuth credential race.
  - S21: tokens and API keys written to logs.
- 12 new correctness findings (C13–C24). Among them:
  - C13: SerpAPI key is never set, so Rank Tracker always fails (verified in the library source).
  - C14–C16: GBP posts are sent without CTA, status updates are lost, and delete is a no-op (C15 tested).
  - C17: OAuth token rows overwrite each other.

**API calls consumed:** 0.

**Open questions for Mohit:**
1. **S13:** the DataForSEO credential is in git history. Please rotate it.
2. **S19:** is the production `JWT_SECRET` a hex string? If not, admin tokens are forgeable today.
3. Phase 2 (security) is gated. Which S-items should be approved? The Critical ones are S1, S2, S13, S16, S17 and S19.

---

## Phase 1.5: Repo hygiene

Approved by Mohit on 2026-09-25. Branch `claude/phase-1.5-hygiene`, based on `claude/rebuild`. No behaviour changes.

### Commits

| Step | Commit | What it did |
|---|---|---|
| 1 | `770cd7fe02885a6986027bf07c1dbdc1b23213f5` | `chore: normalize line endings to LF (no code changes)`. Replaced `.gitattributes` with `* text=auto eol=lf` and binary markers, and added `.editorconfig`. `.prettierrc` already had `"endOfLine": "lf"`, so it is unchanged. The index already stored LF for all text files, so `git add --renormalize .` changed no content. `git diff HEAD~1 --ignore-cr-at-eol --ignore-all-space` shows only `.gitattributes` and `.editorconfig`. The working tree was then re-checked-out to LF (244 files are now LF, 0 CRLF). |
| 1f | `d31f0fb` | Added `.git-blame-ignore-revs` containing the step 1 hash. |
| 2 | `6bf1e05` | `.gitignore` no longer ignores `package-lock.json` or `.env.example`. Added `.env.example`: the 61 variables in `config.ts` plus the 10 read directly via `process.env`, placeholders only, one comment each. Committed `package-lock.json`. |
| 3 | `32dc38b` | Removed the stale `tsconfig.json` include (`src/utils/fetchCountryStateCityDataFromRemoteApi.ts` does not exist). |
| 4 | `481c899` | Deleted dead code after a zero-reference `git grep`: `serp.ts`, `fileEncryption.ts`, `lib/crypto.ts`, `gbpPs.ts` (plus its barrel export), `keywordPositionSearch`, the Moz helpers, and `citationPayment.model.ts`. Added C12 (unbind is a copy of bind) to AUDIT. Side effects: the S13 AES key and the S21 token log are gone. |
| 5 | `3972cc0` | Removed `http-proxy-middleware`, `http-status-codes`, `fs-extra` and `razorpay` (zero live imports). **`@paypal/checkout-server-sdk` is on hold** because `configs/paypal.ts` imports it. |
| 6 | `2a23872` | CLAUDE.md: LF rule, new §5a Phase 1.5 summary, C12 added to Phase 6. CLAUDE.md is now tracked (it was untracked before). |
| 7 | this commit | This progress entry. |

### Final checks (step 7)

| Check | Result |
|---|---|
| `npm ci` from an empty `node_modules` | Passes (558 packages). |
| `npm run build` | **Still fails with the same 46 pre-existing TypeScript errors** as the Phase 1 baseline (44 from the `mongoFunctions` typing, 2 from C11). No new errors. The script's `shx cp .env` step also fails without a local `.env`. Fixing these is code work outside this phase. |
| `npm run lint` | 103 errors vs 115 at baseline. **No new errors:** no file/rule pair increased. The 12 removed errors were all in `gbpAudit.ts` and the deleted `gbpPs.ts`. |
| `npm run dev` | Boots with the placeholder values from `.env.example` passed as environment variables (no `.env` file was created). Output: "Server is working fine", and `GET /ping` returned 200. No import or module errors. MongoDB was not connected because no local instance is installed, so DB-backed routes were not exercised. |

**API calls consumed:** 0.

### Decisions
- Phase 1 docs were committed on this branch, before step 1.
- The Step 1 commit uses Mohit's exact message. Other commits follow the `<phase>: <area>: <what>` format.
- `getSerpCountryCode.ts` became unused after step 4. It is not deleted (not in the approved list) and is recorded in AUDIT §7 for P9.
- `project-tree.txt` was deleted afterwards (`0f3c3f8`), as approved by Mohit.

### Open questions for Mohit (at the end of 1.5)
1. **`@paypal/checkout-server-sdk`:** *(Resolved: approved and removed in `086fdb3`.)* `configs/paypal.ts` imports it to build `client`, but nothing uses `client`; `paypal.service.ts` imports only `BASE_URL`. Option: reduce `configs/paypal.ts` to the `BASE_URL` export and remove the package. That touches a payments file, which is out of scope. Awaiting your answer.
2. Carried over from Phase 1: rotate the DataForSEO credential (S13), and check the production `JWT_SECRET` format (S19).

### Follow-up commits after approval

| Commit | What it did |
|---|---|
| `086fdb3` | Removed `@paypal/checkout-server-sdk`. `configs/paypal.ts` now exports only `BASE_URL`, with the same `PAYPAL_MODE` logic. Lockfile updated. |
| `0f3c3f8` | Deleted `project-tree.txt`. |
| (pending) | Merge `claude/phase-1.5-hygiene` into `claude/rebuild` (`--no-ff`, message "Phase 1.5 — repo hygiene") and push both branches. **Not done:** the session's permission policy blocked both the merge and the push. Commands are under Phase 1.6. |

### One-time setup for every developer after pulling

```sh
git config blame.ignoreRevsFile .git-blame-ignore-revs
git config core.autocrlf input
```

If your working copy still has CRLF files from before this change, refresh it once. This deletes uncommitted changes to tracked files, so commit or stash first:

```sh
git rm -rq --cached . && git reset -q --hard
```

---

## Phase 1.6: Build green

Branch `claude/phase-1.6-build-green`. The plan was to branch from `claude/rebuild` after the 1.5 merge. Because the merge was blocked, it was created from `claude/phase-1.5-hygiene` @ `0f3c3f8`. That tip has exactly the content `claude/rebuild` will have after the merge, so this branch merges cleanly afterwards.

### Commits

| Step | Commit | What it did |
|---|---|---|
| a | `9a727dc` | Fixed all 46 TypeScript errors with type-level changes. 44 came from `mongoFunctions` being typed `Model<Document>`; it is now generic, `schema: Model<T>`, with no runtime change. The other 2 are in `getKeywordMovmentData`: it now creates its client with `oAuth2Client(tokenTypes.ANALYTICS)` before `setCredentials`. |
| c | `e9cab7a` | `config.ts` loads `process.env.ENV_FILE` if set, else `path.resolve(process.cwd(), '.env')`. Removed `shx cp .env ./build/.env` from the build script. Added `docs/OPERATIONS.md` (env loading, local dev, local Mongo, build, pm2 started from the repo root). |
| d | `35af600` | Moved the DataForSEO login and password to optional `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` (`config.ts` accepts empty values; `.env.example` updated). If either is unset, `getKeywordSearchVolume` returns `null`, which is what it already returned on any failure. |
| 5 | `76c6ae1` | Security deferred. CLAUDE.md: Phase 2 moved to "Phase 10 — Security hardening (gated)" in §13a, the phase order is recorded, the Phase 6 exception is written down, and §5b was added. AUDIT: S19 confirmed Critical, with the fix plan, and security items previously `Open` are now `Deferred P10`. |
| — | `8380dcc` | Progress entry. |
| — | `1fe3278` | CLAUDE.md §2 git and milestone workflow; OPERATIONS Homebrew Mongo; decisions recorded. |
| e | `8e68c68` | **Separate local database `mps_rebuild`** (Mohit: no connection to the original database). `authSource` is now configurable (`MONGODB_AUTH_SOURCE`, default `mps_db`). `.env.example` and OPERATIONS updated. |
| — | `58318ad` | AUDIT C25, and the final Phase 1.6 results. |
| — | this commit | **`mps_db` removed entirely.** `MONGODB_AUTH_SOURCE` is now required, with no default. Without it, startup fails with `"MONGODB_AUTH_SOURCE" is required`. No code, config or docs reference `mps_db` any more (except this log). |

### Checks (step f)

| Check | Result |
|---|---|
| `npm ci` from an empty `node_modules` | Passes (556 packages). |
| `npm run build` | **Passes, 0 TypeScript errors** (was 46). No `.env` copy step. |
| `npm run lint` | 99 errors vs 103 after Phase 1.5 and 115 at baseline. **No new errors:** no file/rule pair increased. The 4 fewer are in the reduced `configs/paypal.ts`. |
| `npm run dev` reads `./.env` | Yes. It read `PORT` from the file with nothing injected. `ENV_FILE` overrides it, and `node build/index.js` started from the repo root also reads `./.env`. `/api/healthcheck` returned 200 in all three. |
| Local MongoDB | Homebrew `mongodb-community@7.0` (7.0.43) with mongosh 2.12.0, installed and started as a brew service by Claude on 2026-09-25 (Mohit approved). It listens on `127.0.0.1` and `::1` only. It was a fresh server with no data; user `mps_local` (readWrite) was created in the new `mps_rebuild` database. |
| DB connected | **Yes.** `npm run dev` logged "Mongo has connected successfully" and "Mongoose connection opened successfully", with no errors. Mongoose created all model collections and indexes in `mps_rebuild`. |
| `/api/healthcheck` | **200** (also `/ping` 200). |
| Agenda started | **No, because of a pre-existing bug (AUDIT C25).** `agenda@5.0.0` waits for a callback that MongoDB driver 6 (used by Mongoose 8) never calls, so `agenda.start()` hangs and no "Agenda …" log line appears. A probe confirmed agenda becomes ready when given its own connection. This needs a behaviour change, so it is skipped under rule 4b. |

**API calls consumed:** 0.

### Decisions
- **`getKeywordMovmentData` (step a).** The strict rule is "behaviour-changing fixes are listed and skipped", but that would have left 2 errors and conflicted with "zero errors". The function is imported but never called anywhere, so the fix (use the client factory, the same pattern as its sibling `getLastFiveMonthPosition`) has no effect on the running app. It is dead code slated for deletion in Phase 9 (C11). **If you want the strict reading instead, revert this hunk and the 2 errors return.**
- **Step b (skip list):** one item.
  - **C25**, at [mongoConnection.ts:35-50](../src/configs/mongoConnection.ts#L35-L50): agenda never becomes ready with Mongoose's driver 6 connection. Proposed fix: in Phase 3.4, when building the job registry, either give agenda its own connection (`new Agenda({ db: { address: MONGODB_URL, collection: 'agendaJobs', options: { auth, authSource } } })`, which the probe confirmed becomes ready) or upgrade agenda. Also check agenda 5's other driver calls (the `findOneAndUpdate` result shape changed in driver 6) before choosing.
- **Finding ID:** the admin-JWT issue you called "S16" is already **S19** in AUDIT.md (S16 is the path traversal). I updated S19 instead of renumbering.
- **Local `.env`:** created from `.env.example` placeholders, with `PORT=5055` (macOS AirPlay uses 5000). It is gitignored and not committed.

### Mohit's decisions (2026-09-25, after review)
- `getKeywordMovmentData` fix: accepted (the function is deleted in Phase 9 anyway).
- S19 numbering, security in §13a after Phase 9, local `PORT=5055`: accepted.
- Security deferral: acknowledged and stays deferred. Not to be raised again unless something new comes up.
- Phase 1.5 was merged into `claude/rebuild` locally by Mohit (`e4a7419`, not pushed).
- Git workflow updated in CLAUDE.md §2: merge per phase with Mohit's approval; push only at milestones M1–M4.
- Local MongoDB: Homebrew `mongodb-community@7.0` is the default and Docker is the alternative (OPERATIONS.md).
- The original `mps_db` database is dropped from the code entirely. The server will get a fresh setup with a new database after the rebuild; until then only the local `mps_rebuild` is used.

### Status of earlier blockers
1. **Docker:** superseded. Local MongoDB now runs via Homebrew with a separate `mps_rebuild` database.
2. **Phase 1.5 merge:** done by Mohit locally (`e4a7419`). Pushes happen at milestone M1.
3. **Rotate the DataForSEO credential:** still open. It is in git history, which is already on GitHub (`origin/main` = `62240ac`).

### Merge command for Phase 1.6 (run by Mohit after approval)

```sh
git switch claude/rebuild
git merge --no-ff claude/phase-1.6-build-green -m "Phase 1.6 — build green"
```

No push until milestone M1 (after Phase 3).

---

## Phase 3: Foundations (ranking-focused) — milestone M1

Scope (Mohit, 2026-09-26): ranking first.
- **Done:** 3.1 ranking config, 3.2 `placesClient`, 3.4 jobs infrastructure with the C25 fix, 3.5 test harness, and the smoke scripts.
- **Deferred to Phase 6:** 3.3 token crypto and `gbpClient`, plus `OAUTH_STATE_SECRET`, `TOKEN_ENCRYPTION_KEY` and `GBP_SYNC_ENABLED`.
- There is no Places API key yet. **No Google API calls were made.**

Branch `claude/phase-3-foundations` was created from `claude/phase-1.6-build-green` @ `e09ff59`, because 1.6 is not yet merged into local `claude/rebuild`. Its content matches what `claude/rebuild` will have after that merge, so both merges apply cleanly in order.

### Commits

| Commit | What it did |
|---|---|
| `98cbe4f` | CLAUDE.md: Phase 3 scoped to ranking; 3.3, `gbpClient` and the GBP config variables moved to Phase 6; registry location and C25 fix recorded; "no key yet, mocked tests only" rule added. |
| `4db40e2` | Test harness: jest 30, ts-jest 29.4, `@types/jest` 30, mongodb-memory-server 11 (MongoDB 7.0.14 test binary). Tests load `.env.example`, never `.env`. |
| `26c2064` | Ranking config: `PLACES_SEARCH_RADIUS_M` (5000), `RANK_MAX_KEYWORDS` (20), `RANK_TRACKER_OFFSET_KM` (1.5), `RANK_DEV_MAX_KEYWORDS` (2). `GOOGLE_PLACE_API_KEY` is optional and may be empty. |
| `9fb9c59` | `src/clients/http.ts`: pluggable transport, 15 s timeout, one retry on 429/5xx/timeout/network with jittered backoff and Retry-After handling, and errors that never keep request headers (C20). |
| `6771f16` | `src/clients/placesClient.ts`: `searchTextIds` (IDs-only mask with a hard guard, up to 3 pages, `stopWhenFound`, `movedPlaceId`), `searchTextWithNames` (1 page, Pro SKU), `getPlaceDetails`, per-SKU call counts. Fixtures and 30 client tests. |
| `ccc2ed0` | **C25 fixed:** agenda has its own connection; `defineAllJobs` registry; `defineJob` / `scheduleJob` with IDs-only data (C21); `post-to-gbp` unchanged; agenda starts from `server.ts` and stops on SIGTERM/SIGINT. |
| `8b430f0` | `npm run smoke:places` (written, **not run**) and `npm run smoke:agenda`. |
| `476680e` | Tests: type-check once up front (`npm test` = `tsc -p tests/tsconfig.json && jest`) and transpile-only in workers. This fixed the intermittent "worker failed to exit gracefully" warning in parallel runs. |
| this commit | AUDIT (C25 fixed; C20 and C21 partial), OPERATIONS (tests, smoke scripts, agenda) and this entry. |

### Checks

| Check | Result |
|---|---|
| `npm ci` from an empty `node_modules` | Passes. |
| `npm run build` | **0 TypeScript errors.** |
| `npm run lint` | 98 errors (baseline 99). **No new errors.** Every new file in `src/clients`, `src/jobs` and `src/scripts` is lint-clean. |
| `npm test` with no `GOOGLE_PLACE_API_KEY` | **65/65 pass** across 5 suites, repeated runs, no warnings. |
| Places fixture scenarios | Page-1 hit (rank 4, 1 call); page-3 hit (rank 47, 3 calls); not found in 60 (60+); multi-target `stopWhenFound` stops at page 2; `movedPlaceId` counts as the target; error then retry success (2 calls); timeout retried; two errors → `PlacesApiError` with `apiCalls: 2` (Phase 4 maps this to status `error`); 400 not retried; missing key throws before any request; IDs-only mask guard; a sentinel key never appears in logs or errors. |
| `npm run dev` against `mps_rebuild` | "Agenda jobs defined: post-to-gbp", "Mongo has connected successfully", "✅ Agenda connected and ready.", **"🚀 Agenda has started and is processing jobs."**, `/api/healthcheck` 200. |
| `npm run smoke:agenda` (with dev running) | Job scheduled 10 s ahead, ran after 10.012 s, removed, **0 left**, exit 0. |
| Secrets | No key-like strings in the Phase 3 diff; `.env` is ignored and not committed. |

**API calls consumed:** 0 (no key exists; `smoke:places` was not run).

### Decisions
- **C25:** `npm ls mongodb` showed agenda resolving its own driver 4.17.2, so it gets its own connection via `db.address`. No agenda upgrade and no new env vars.
- **Job registry location:** `src/jobs/index.ts`, not `configs/agenda.ts`, to avoid the circular import `jobs → gbpPostSchedular.service → agenda`. CLAUDE.md is updated.
- **Where agenda starts:** in `src/server.ts` instead of the Mongoose `open` handler, so seed scripts (which import `mongoConnection`) never process jobs.
- **`gbpPostSchedular.service.ts` is untouched:** `mongoConnection.ts` still re-exports `agenda`.
- **C21:** the `post-to-gbp` payload stays as it is until Phase 8. New jobs must use `defineJob` / `scheduleJob`.
- **Places API docs check:** `places.movedPlaceId` and `nextPageToken` are in the Essentials (IDs Only) SKU, and `displayName` is Pro, so the CLAUDE.md masks are correct. Page-token requests repeat every other parameter, as the API requires.
- **Local `.env`:** `GOOGLE_PLACE_API_KEY` is now blank (not committed).

### Out-of-scope or shared files touched
- `src/server.ts` and `src/configs/mongoConnection.ts`: agenda start and stop only.
- `src/jobs/postToGbp.ts`: signature only (it now receives the agenda instance).

### Closed (2026-09-26)
- Approved by Mohit. Merged into `claude/rebuild` as **`53986e0`** ("Phase 3 — foundations (M1)"), which also brought in Phase 1.6.
- **Milestone M1 pushed on 2026-09-26:** `origin/claude/rebuild` = `53986e0`, plus `claude/phase-1.6-build-green` (`e09ff59`) and `claude/phase-3-foundations` (`7847004`). `main` is untouched.

### M1: merge and push (run by Mohit)

Local merges, in order (1.6 is not in `claude/rebuild` yet):

```sh
git switch claude/rebuild
git merge --no-ff claude/phase-1.6-build-green -m "Phase 1.6 — build green"
git merge --no-ff claude/phase-3-foundations -m "Phase 3 — foundations"
```

One push for the milestone. `origin` already has `claude/rebuild` and `claude/phase-1.5-hygiene` at the 1.5 state; this fast-forwards `claude/rebuild` and adds the 1.6 and 3 branches:

```sh
git push -u origin claude/rebuild claude/phase-1.6-build-green claude/phase-3-foundations
```

### Developer summary (M1)

> **MyPageSEO backend rebuild — milestone M1 (foundations)**
> Branch `claude/rebuild`. Nothing on `main` changed.
>
> - **Setup:** copy `.env.example` to `.env`. Local MongoDB is a separate database, `mps_rebuild`: see `docs/OPERATIONS.md` for Homebrew or Docker. `MONGODB_AUTH_SOURCE` is required. Leave `GOOGLE_PLACE_API_KEY` empty for now.
> - **One-time git config:** `git config blame.ignoreRevsFile .git-blame-ignore-revs` and `git config core.autocrlf input`. The repo is now LF-only.
> - **Build and tests:** `npm ci`, `npm run build` (0 TypeScript errors), `npm test` (65 tests, no API key or network needed).
> - **What's new:** a Places API (New) client in `src/clients/` with a free IDs-only search, timeouts and one retry. Background jobs now actually run: agenda was silently never starting before and has its own DB connection now. `src/jobs/defineJob.ts` is the pattern for new jobs (IDs-only data).
> - **Next:** Phase 4 (ranking engine) and Phase 5 (Rank Tracker, Local Search Grid and Map Ranking endpoints), all tested against fixtures until the API key is added.
> - **Docs:** `docs/AUDIT.md` (all findings with status), `docs/PROGRESS.md` (every phase and commit), `docs/OPERATIONS.md` (setup and running), `docs/ROUTES.md`.

---

## Phase 4: Ranking engine

Branch `claude/phase-4-ranking-engine`, from `claude/rebuild` @ `53986e0`. Pure logic in `src/ranking/`, as specified in CLAUDE.md §4 and §8. **No existing code was changed**, and no out-of-scope files were touched.

### Commits

| Commit | What it did |
|---|---|
| `f30d781` | Docs before planning: new `docs/STATUS.md`; CLAUDE.md session-start line and stale facts fixed; Phase 3 closed; C25 Fixed and C20 Partial in AUDIT; smoke-script table in OPERATIONS. |
| `fc164da` | `types.ts` and `points.ts`: `trackerPoints` (center plus N/S/E/W at 1.5 km) and `gridPoints` (3/5/7, 0.25–5 km, row 0 north, col 0 west, center exact). The flat-earth math is ported from the legacy `generateGrid()`. 22 tests. |
| `19764c5` | `rankCell.ts` (`toCell` with the 60 cap and `movedPlaceId`, `bucket`, `displayRank`) and `metrics.ts` (`avgRank` with `not_found` = 61 and errors excluded, `foundRate`, `top3Rate`, `overallAvgRank`, `cellChange`, `keywordChange`, `overallChange`). 38 tests. |
| `21ca8ca` | `engine.ts`: per-run engine; promise cache keyed by (keyword, lat 5 dp, lng 5 dp); at most 4 searches at once with 100–300 ms jitter; all targets ranked from one list; API errors become `error` cells with their calls counted; a missing key fails the run; stats. 16 tests. |
| `3e77047` | `estimate.ts` (`estimateCalls`), `region.ts` (`regionFromCountry`), `limits.ts` (`applyDevKeywordCap`), `index.ts` barrel. 32 tests. |
| this commit | CLAUDE.md §8 "as built" and §14 corrected cost figures; STATUS.md rewritten; this entry. |

### Checks

| Check | Result |
|---|---|
| `npm run build` | **0 TypeScript errors.** |
| `npm run lint` | 98 errors (same as Phase 3). **No new errors**, and none in `src/ranking`. |
| `npm test` (no `GOOGLE_PLACE_API_KEY`) | **175/175 pass** (65 from before plus 110 new) across 12 suites, repeated runs, no warnings. |
| Required test areas | Geometry within 1% (haversine, including 60°N) and parity with the legacy `generateGrid`. Metrics edge cases: all `not_found` (61 / 0 / 0), all `error` (null), mixed. Change labels `entered_top_60` and `dropped_out_of_top_60` at both cell and keyword level. Cache hits: tracker plus 3×3 gives 13 searches with 1 hit; concurrent dedupe; map reuse of the center. Pool: peak in flight is exactly 4 over 49 searches, jitter within [100, 300]. Estimator figures. |
| Isolation | `src/ranking` has no imports from `src/helpers` (the math is ported) and no `any`. |

**API calls consumed:** 0.

### Decisions
- **Keyword-level change** (CLAUDE.md said `keywordChange(prevCell|prevAvg, curr)`): implemented as `keywordChange(prevSummary, currSummary)`.
  - Labels come from `foundRate` going 0 → >0 (`entered_top_60`) or >0 → 0 (`dropped_out_of_top_60`).
  - Otherwise the change is the `avgRank` delta, labelled `improved`, `declined` or `unchanged`.
  - The cell-level rules are in `cellChange`, exactly as in §4.
  - The plan flagged this interpretation for confirmation; it was approved with the plan.
- **Grid orientation:** row 0 is north and col 0 is west (heatmap order). The legacy grid ran south to north.
- **Cost figures:** `estimateCalls` counts tracker ∪ grid points. The old §14 figure (980–2,940 for 20 keywords × 7×7) left out the 4 tracker points; the correct range is **1,060–3,180**. CLAUDE.md §14 is updated.
- **Where things live:** `regionFromCountry` and `applyDevKeywordCap` are in `src/ranking` for Phase 5. The Map Ranking names search stays in the Phase 5 job, not the engine.

### Merge command (run by Mohit after approval)

```sh
git switch claude/rebuild
git merge --no-ff claude/phase-4-ranking-engine -m "Phase 4 — ranking engine"
```

No push: the next push is **M2**, after Phase 5.
