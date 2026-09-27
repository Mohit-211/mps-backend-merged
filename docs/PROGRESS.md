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
| 4: Ranking engine | `claude/phase-4-ranking-engine` | Done. Merged `3da12ed`. Pushed at M2. |
| 5: Ranking reports | `claude/phase-5-ranking-reports` | Done. Merged `2bb4cf8`. **Pushed at M2 on 2026-09-26.** |
| 5.5: Live validation | `claude/phase-5.5-live-validation` | Done. Merged `5735bad` (not pushed; next push is M3). **Informal pass, one market; formal scoring pending.** |
| 6: GBP connection fixes | `claude/phase-6-gbp-connection` | Done. Merged `4e4d556` (no push; M3 after Phase 7). |
| 7a: Connect (popup) + onboarding | `claude/phase-7a-connect-onboarding` | Done, **awaiting approval and merge**. Offline: 0 Google calls. |
| 7b: GBP sync | — | Not started |
| 7c: Scoring + report + competitors (M3) | — | Not started |
| 9a: Legacy cleanup (early part of Phase 9) | `claude/phase-9a-legacy-cleanup` | Done, **awaiting merge after 7a**. |
| 7b: GBP sync (monthly cadence) | `claude/phase-7b-gbp-sync` (from 9a) | Done, **awaiting merge after 7a and 9a**. Offline: 0 Google calls. |
| 8: Auth, Organization, Onboarding & Locations | — | Not started (was "GBP posting") |
| 9: GBP posting (was 8) / 9b: remaining cleanup | — | Not started |
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

### Closed
Approved by Mohit and merged into `claude/rebuild` as `3da12ed` (not pushed; it pushes with M2).

---

## Phase 5: Ranking reports (milestone M2)

Branch `claude/phase-5-ranking-reports`, from `claude/rebuild` @ `3da12ed`. Built per CLAUDE.md §9 plus Mohit's 8 points. There is no API key, so **every test and the demo use offline clients: 0 Google API calls.**

### Commits

| Commit | What it did |
|---|---|
| `da2605e` | CLAUDE.md §4: per-cell, per-keyword (accepted interpretation) and overall change rules. |
| `8e5303c` | Models: `Location.tracking` (with a scheduler index) and `RankRun` (status flow, the `active` flag with a unique partial index giving one active run per location, timings, config snapshot, estimate, tracker, grid, mapList, overall, `api_calls`, `run_errors`). Config: `RANK_MAX_CALLS_PER_RUN` (3200), `STORE_PLACE_NAMES` (true). |
| `5b09218` | Tracking rules (keyword normalise and dedupe, an order-insensitive set compare so the version bumps only on a real change, competitor rules, next-run maths), `runPlan` (dev limits, estimate, cap), and the tracking service. 19 tests. |
| `6454928` | Enqueue: preconditions, an active run returned instead of a duplicate (race-safe), 422 over the cap, job data `{ run_id }`. The `rank-run` executor: atomic claim, center from lat/lng or 1 Place Details (`location`), one engine over tracker ∪ grid, the map list (names search), summaries, change against the previous run with the same `keywords_version`, and done / partial / failed. Engine `getErrors()`. `scriptedPlaces` (the offline client). 20 tests. |
| `7014f51` | The `rank-run` job and the `rank-scheduler` job (stuck guard at 30 minutes, due weekly and monthly locations, compare-and-set claims, no catch-up bursts, recurring every 15 minutes). 18 tests. |
| `db11385` | API: 8 endpoints with auth, ownership (404) and Joi validation; report views; `resolveNames` (opt-in only). supertest route tests (18). |
| `19195b1` | `npm run seed:rank-demo` and the demo scenario (offline). |
| this commit | `docs/API.md`, `docs/LIVE_TEST.md`, ROUTES (163 routes), OPERATIONS (demo, jobs), AUDIT (9 legacy findings superseded; C7 fixed for ranking; C21 and C23 partial), CLAUDE.md §9 "as built", §15, §3, STATUS rewrite, this entry. |

### Checks

| Check | Result |
|---|---|
| `npm ci`, `npm run build` | Pass. **0 TypeScript errors.** |
| `npm run lint` | 98 errors (unchanged). **No new errors.** All new and changed files lint-clean (checked directly, because the project glob does not reach `src/services/ranking` and similar folders). No `any` in the new code. |
| `npm test` (no key) | **239/239 pass** in 16 suites, repeated runs, no worker warnings. |
| Required tests | Full run of 2 keywords × 3×3 (26 IDs-only + 2 Pro, center shared); change across two runs, including `entered_top_60` and `dropped_out_of_top_60`; keyword edit gives a new version and no change; partial and failed runs on injected errors; one-active-run guard (3 concurrent requests create 1 run); scheduler picks, advances and claims atomically, plus the stuck guard; ownership (another user's location gives 404 on all 8 routes); 422 cost-cap rejection. |
| `npm run dev` | "Agenda jobs defined: post-to-gbp, rank-run, rank-scheduler"; "Recurring job scheduled: rank-scheduler every 15 minutes"; the first scheduler tick finished cleanly. |
| `seed:rank-demo` | Refuses when `NODE_ENV` is not `development` and when the database is not `mps_rebuild` (both tested). Creates 3 runs (done, done, partial). Every endpoint was called live with the demo token (200s, and 400, 401 and 202-existing where expected). |

**API calls consumed:** 0. A development "run now" made while capturing examples failed immediately with "GOOGLE_PLACE_API_KEY not set", before any network call, as designed. The demo data was re-seeded afterwards.

### Decisions
- **`run_errors`** instead of `errors` on RankRun (a reserved Mongoose name).
- **One active run per location** is enforced by a unique partial index, so two "run now" requests cannot both create a run.
- **Map Ranking names:** stored by default (`STORE_PLACE_NAMES=true`). When false, `GET map-ranking?resolveNames=true` resolves them live, which is the only exception to "no third-party calls on a page view". **The ToS decision is pending (Mohit).**
- **Demo seed:** uses production limits (3 keywords, 5×5) because its client is offline. Real development runs stay at 2 keywords and 3×3.
- **Ownership middleware:** puts the location on `res.locals`, not `req.body`, because the body is client-controlled.
- **Shared or out-of-scope files touched:** `models/location.model.ts` (the `tracking` addition only), `models/index.ts` (export), `routes/v1/common/index.ts` (one mount), `server.ts` (the recurring-jobs line).
- **Security hygiene:** my local MongoDB password was replaced with `<local-db-password>` in OPERATIONS.md and LIVE_TEST.md. It had been in OPERATIONS.md since Phase 1.6, and it is local-only. During development, one seed run printed the local demo user's password and token to my session; that demo user was deleted and recreated, so those credentials no longer work.

### M2: merge and push (run by Mohit)

```sh
git switch claude/rebuild
git merge --no-ff claude/phase-5-ranking-reports -m "Phase 5 — ranking reports (M2)"
git push -u origin claude/rebuild claude/phase-4-ranking-engine claude/phase-5-ranking-reports
```

### Developer summary (M2)

> **MyPageSEO backend rebuild — milestone M2 (ranking reports)**
> Branch `claude/rebuild`. `main` is untouched.
>
> - **What's new:** the backend for the three ranking pages. The endpoints are `/api/v1/locations/:locationId/{tracking, rank-runs, rank-tracker, grid, map-ranking}`. Every endpoint needs a user token and only works on your own locations. Full reference with real responses: `docs/API.md`.
> - **How it works:** "Run now" (`POST …/rank-runs`) queues a background job. It runs Google Places searches around the business, then stores one `RankRun` that feeds all three pages. A scheduler job reruns weekly and monthly locations. Runs are capped by an API-call estimate.
> - **Frontend work without an API key:** set up `.env` and local MongoDB (`docs/OPERATIONS.md`), then run `npm run seed:rank-demo`. It creates a demo user, a location and 3 weekly runs, and prints a login, an access token and `curl` examples. Run `npm run dev`, then call the endpoints with `Authorization: Bearer <token>`. The data includes improving and declining ranks, "entered / dropped out of top 60", "60+" cells and one error cell. Re-run the seed any time for fresh data.
> - **Checks:** `npm test` (239 tests, no key or network needed), `npm run build` (0 TypeScript errors).
> - **Not yet:** no real Google searches have run. The first live test follows `docs/LIVE_TEST.md` once the API key is added. Legacy `/rank-tracker`, `/local-search-grid` and `/local-map-ranking` stay until the frontend switches (Phase 9).

---

## Phase 5.5: Live validation (Fredericton)

Branch `claude/phase-5.5-live-validation`, from `claude/rebuild` @ `2bb4cf8`; merged by Mohit as `5735bad`. The first real Places API calls of the rebuild, approved by Mohit with hard call budgets.

**Verdict: informal PASS, one market, formal scoring pending.** Mohit checked MyPageSEO (Fredericton, NB) on Google Maps and the API ranks are close. For example, for "digital marketing agency fredericton" Maps shows #9 and the API shows #7 at the center (#7–9 across the tracker points). For "digital marketing agency", MyPageSEO is not visible on Maps, which matches the API's 60+ at every point. `calibrate:score` has not been run: the manual columns in the CSVs are blank.

### Commits

| Commit | What it did |
|---|---|
| `c38730a` | Engine, model and executor store the first 3 place IDs per sample point (free, from the existing result list). |
| `0aa70dd` | `src/calibration`: RFC 4180 CSV, sheet rows (`maps_url`, names from the map lists), scoring maths (within-2, found/not-found mismatches both ways, top-3 overlap, PASS/FAIL, worst 5). Tests. |
| `727f841` | Scripts: `calibrate` (reads a run, no API calls), `calibrate:score`, `find:place`, `setup:live-test` (development + `mps_rebuild` only; token written to a mode-600 file). |
| `38235b7` | LIVE_TEST.md rewritten to the calibration flow. |
| `28e4a7b` | Result count and early-stop flag per sample point (`result_count`, `more_results`). |
| `3da433a` | `calibrate:score --tracker-only` and per keyword × point-type counts; `calibrate --suffix=`; `api_results` column. |
| `e0f2d21` | `find:place --names` (1 Pro call, 20 names) and `--id=` (1 Details call). |
| this commit (on `claude/phase-6-gbp-connection`) | Both Fredericton CSVs (manual columns blank), this entry, STATUS. |

### Live calls and runs

| Step | Estimate | Actual | Result |
|---|---|---|---|
| `find:place` "MyPageSEO Fredericton NB" | 1 IDs-only + 1 Details | 1 + 1 | Mypageseo, 82 Westmorland St, `ChIJneho2koPp0wRIbUtaCCIReA` |
| `smoke:places` "seo company" | 1 IDs-only | 1 | rank 1; 17 results on page 1 |
| Round 1 run `6ab76e48aee0841b42f15bbc` (2 keywords, 3×3 @ 1 km) | 26–78 IDs-only + 2 Pro + 0 Details | **52 + 2 + 0** | `done` in 6.6 s |
| Round 2 run `6ab77383ab221fbd3de13c67` (4 keywords, 3×3 @ 1 km) | 52–156 IDs-only + 4 Pro + 0 Details | **52 + 4 + 0** | `done` in 8.3 s |
| `find:place --names` "plumber Dallas TX", then `--id` (Dallas test, not run) | 1 Pro + 1 Details | 1 + 1 | Workman Plumbing picked; the Dallas run moved to the backlog |

**Total: 106 IDs-only, 7 Pro, 3 Place Details.** Every call succeeded on the first attempt: no retries, no 4xx or 5xx. Both runs were within their estimates. Round 2 used `RANK_DEV_MAX_KEYWORDS=4` for that server process only (`.env` unchanged).

| Keyword (tracker) | Round | avgRank | foundRate | top3Rate | C / N / S / E / W |
|---|---|---|---|---|---|
| seo company | 1 and 2 | 1.4 | 1.00 | 1.00 | 1 / 2 / 1 / 2 / 1 |
| digital marketing agency | 1 | 61 | 0 | 0 | 60+ everywhere |
| digital marketing agency fredericton | 2 | 8.0 | 1.00 | 0 | 7 / 8 / 8 / 9 / 8 |
| seo fredericton | 2 | 2.2 | 1.00 | 0.80 | 1 / 2 / 4 / 2 / 2 |
| marketing agency | 2 | 5.6 | 1.00 | 0 | 5 / 5 / 6 / 7 / 5 |

### Surprises
- **Shallow market.** Fredericton lists are short (16–20 on page 1), so mid-range ranks (10–60) could not be validated here. Page 1 can hold fewer than 20 results while more pages exist.
- **Call-to-call variance.** At the same center, Round 1's Pro list put "Fredericton Local SEO" at #8 while the IDs-only list had it at #2; in Round 2 both had it at #2. The "seo company" grid NW corner went from 5 to 1 between rounds. This looks like Google varying between calls, not a difference between SKUs.
- **IDs-only vs Pro at the center:** identical client rank for all 4 Round 2 keywords.
- **Overall average:** a keyword that is 60+ everywhere counts as 61 and dominates `overallAvgRank` (Round 1: 31.2 from 1.4 and 61). This follows §4, but the page needs to explain it.
- **Leftover jobs:** two stale `rank-run` agenda jobs from earlier local testing were picked up on startup and skipped ("not queued any more"), with no calls. The idempotency guard works.
- **Dev server:** killing only the `ts-node` child left `nodemon` alive, and it restarted the server on the next file edit. Stop all three processes (`cross-env`, `nodemon`, `ts-node`).

### Calibration files
- `docs/calibration/2026-09-26-mypageseo-fredericton.csv` (Round 1, 28 rows)
- `docs/calibration/2026-09-26-mypageseo-fredericton-r2.csv` (Round 2, 56 rows)

Both are committed with the manual columns blank.

### Checks
`npm run build`: 0 TypeScript errors. New and changed files lint-clean. **273/273 tests pass** with no key and no network.

---

## Phase 6: GBP connection

Branch `claude/phase-6-gbp-connection`, from `claude/rebuild` @ `5735bad`. Built per CLAUDE.md §10, Mohit's Phase 6 list and the approved plan. **Offline:** tests use fixtures and mocks, and **0 Google API calls** were made. The first live step, `gbp:preflight`, is Mohit's.

### Commits

| Commit | What it did |
|---|---|
| `f3b04f2` | (Phase 5.5 close-out: CSVs, STATUS, PROGRESS.) |
| `022dadb` | Config: `TOKEN_ENCRYPTION_KEY` (64 hex, required in production), `GOOGLE_GBP_*` in Joi, `GBP_MAX_RPS`. `utils/tokenCrypto.ts` (AES-256-GCM, random IV, `enc:v1:` prefix). Tests. |
| `2194ae1` | `http.ts`: DELETE, `formBody`, a shared `httpErrorFromResponse` (keeps the ErrorInfo `reason` and `quota_limit_value`, understands OAuth `{error, error_description}`). The fake transport uses the same parser. GBP error fixtures. |
| `5aca9dd` | Models: `UserAuth` (`scope`, `status`, `last_error`, `last_refreshed_at`, and a unique active `(user_id, token_type)` index), `OAuthState` (hashed, TTL), `UserGBP` (`place_id`, `bound_at`, optional title/website/language, unique active indexes). `tokenStore` (C17, encrypted GBP tokens, legacy re-encrypt) and `encryptExistingTokens` (idempotent). Tests. |
| `0b46e5b` | `gbpClient`: 5 rps limiter, 429 backoff (3 retries), quota-0 and disabled-API errors, refresh when < 60 s remain or on a 401, persisted refresh and rotation, `invalid_grant` marks revoked, paginated accounts and locations with `readMask`, `getLocation`, `exchangeCode`, `revoke` (token in the body). Fixtures and tests. |
| `b6e572e` | OAuth (S11): one-time hashed state with 10-minute expiry, `business.manage` only, callback via `gbpClient`. `userAuth.service` delegates; `storeToken` is per token type (C17). Tests, including replay, expiry and forged state. |
| `61063f7` | Discovery across all accounts with no Places calls (C9, C22); server-side bind with `place_id` rules; real unbind (C12) and disconnect; `POST /gbp/unbind`; `GBPPost.last_error`; `JOB_NAMES.GBP_SYNC`. Service and route tests. |
| `4981953` | Posting (`publishPostToGBP`, `deleteGBPPost`) gets its token from `gbpClient.getAccessToken`. Posting logic is unchanged (Phase 8). |
| `c5be35c` | `npm run gbp:preflight` (read-only; explains quota 0 / disabled API / reconnect / config), `setup:live-test --token-only`, `explainGbpError`. Tests. |
| this commit | `docs/GBP_CONNECT.md`, API.md (GBP section), ROUTES, OPERATIONS, AUDIT (S11, S12, S29, C9, C12, C17, C22; new S30), CLAUDE.md §3, §10 and §13a, STATUS, this entry. |

### Checks

| Check | Result |
|---|---|
| `npm run build` | **0 TypeScript errors.** |
| `npm run lint` | 98 errors (unchanged baseline). All new files are lint-clean with no `any`. Touched shared files have no new errors (`userAuth.service` 14 → 9, `gbpPostSchedular.service` 14 → 10). |
| `npm test` (no key) | **347/347 pass** in 27 suites (74 new). |
| Required tests | State creation, validation, expiry and replay (plus a forged old-style JSON state); pagination with fixtures; token encryption, refresh and rotation; C17 regression (GBP never overwrites Search Console); quota-0 / disabled API / `invalid_grant`; limiter ≤ 5 requests per second; C22 (Places and the legacy helper asserted never called); bind `place_id` set / match / conflict; **C12: bind → unbind gives no binding, no tokens and no `gbp-sync` or scheduled-post jobs** (real agenda on the memory MongoDB); disconnect. |
| Local, no Google calls | `npm run dev` then `GET /user/auth/google/gbp` gives a consent URL with only `business.manage`, `offline`, `consent` and a 43-character state. A bogus state and the old JSON state give 400. `GET /gbp` without a connection gives 400 "Please connect with Google Business Profile". |

**API calls consumed: 0** (Google Business Profile and Places).

### Decisions (approved with the plan)
1. **Search Console tokens stay plaintext.** Only the C17 filter fix applies to them. S11, S12 and S29 for Search Console are Phase 10.
2. **No `OAUTH_STATE_SECRET`.** A random one-time state stored as a hash replaces the HMAC.
3. **Tokens are per user (Google account).** Unbind deletes them only with the last binding; disconnect removes everything.
4. **Unbind cancels pending scheduled posts** for that GBP location (`REJECTED`, "GBP location unbound").
5. **Bind fills `Location.lat/lng`** from GBP when both are empty.
6. **`GET /gbp` returns `{ accounts, locations, errors }`** (a frontend change).
7. **Legacy plaintext GBP tokens** are re-encrypted on first use; `gbp:encrypt-tokens` is written but **not run**. To run it on a server:
   1. Back up `user_auths`.
   2. Set `TOKEN_ENCRYPTION_KEY` and `MONGODB_*`.
   3. Run `npm run gbp:encrypt-tokens`.
   4. Run it again to confirm: it should report "0 encrypted now".
- **Also:** "reconnect" is returned as 400, not 401, because a 401 would log the user out of MyPageSEO.

### Shared or out-of-scope files touched
- `services/user/userAuth.service.ts` and `controllers/user/userAuth.controller.ts`: only the GBP functions and `storeToken`.
- `models/gbpPost.model.ts` (`last_error`), `models/index.ts` (export), `jobs/jobNames.ts` (`GBP_SYNC`).
- `tests/helpers/fakeTransport.ts`.

### Open items for Mohit
- **Setup** (see [GBP_CONNECT.md](GBP_CONNECT.md)):
  - Your `.env` `GOOGLE_GBP_REDIRECT_URI` uses port **5000**. Change it to `http://localhost:5055/api/v1/user/auth/google/gbp/callback` and register exactly that in Google Cloud.
  - Add `TOKEN_ENCRYPTION_KEY` (`openssl rand -hex 32`).
- **GBP API access approval** for the Cloud project. `gbp:preflight` reports quota 0 until then.
- **Frontend:** `GET /gbp` now returns an object, the bind body needs only 3 fields, and `POST /gbp/unbind` is new.
- **New finding S30 (Low, Phase 10):** the morgan request logger writes full URLs, so a failed OAuth callback logs its `code` and `state`.

---

## Phase 7a: Google connect (account-chooser popup) + onboarding

Branch `claude/phase-7a-connect-onboarding`, from `claude/rebuild` @ `4e4d556`. It follows Mohit's Phase 7 brief (7a) and the approved plan. **Offline:** tests use fixtures and mocks, and **0 Google or Places calls** were made.

### Commits

| Commit | What it did |
|---|---|
| `fa3b08e` | Connect: the GIS popup (`GET /google/gbp/popup`, `POST /google/gbp/code`, exchanged with `postmessage`); scopes `openid email business.manage`; `prompt=select_account consent`; id_token verification (`services/gbp/idToken.ts`: RS256 signature, issuer, audience, expiry, `email_verified`); `google_email` and `google_sub` stored; `OAuthState.flow` (popup and redirect states can't be swapped; a popup state must belong to the caller); account switch while bound gives 409; missing refresh token rules. `PLACES_USER_DAILY_LIMIT` config. Tests use locally signed id_tokens. |
| `5fa41bf` | Places: `searchTextForSuggestions` (Enterprise mask with rating and `userRatingCount`, 1 page) and `searchTextNamesAddresses` (Pro, 10 results), each with an exact-mask guard and its own SKU counter. The IDs-only ranking mask is unchanged (tested). Fixtures. |
| `7c0230f` | Onboarding: `Location.onboarding` / `gbp_sync` / `competitor_suggestions`; `places_usage` (atomic daily cap, TTL); `/onboarding/{state,gbp-profiles,select-profile,complete}`; `GET /locations/:id/competitor-suggestions` (merge, dedupe, self excluded incl. moved listings, best position, top 10, 24 h cache per `keywords_version`, dev keyword cap); `GET /places/search`; the tracking PUT advances the onboarding step; bind accepts a pre-fetched profile (1 GBP call per select); `serviceArea` added to the discovery `readMask` (service-area country). Tests. |
| `fd0663e` | Docs: API.md (onboarding section + screen map), GBP_CONNECT.md (popup + frontend snippet), ROUTES, OPERATIONS, CLAUDE.md §11 (the 7a/7b/7c split, 7a as built, the `GBP_V4_ENABLED` plan), STATUS, this entry. |
| `52b4d17`, `1695187` | CLAUDE.md environment and repo map brought up to date; `docs/ENDPOINTS.md` (one-page list of every rebuilt endpoint). |
| `8af1b19` | **Review fixes (Mohit):** (1) popup settings are `select_account: true` only (GIS has no `prompt`); (2) **several Google accounts per user**: connections keyed by id_token `sub` (`UserAuth` index `user_id + token_type + google_sub`, `UserGBP.google_sub`, `gbpClient` `ConnectionRef`), discovery grouped per account, bind and disconnect take `google_sub`, per-account unbind and disconnect, the 409 rule removed, pre-7a rows still work and are upgraded on reconnect; (3) **service-area center step**: `PUT /locations/:id/center { query }` (1 IDs-only Text Search without location bias + 1 Details `location`, `center_source: 'manual'`, daily cap), steps `center_needed` / `center_set`, `/complete` requires a center; `Location.center_source` (`gbp` / `place_details` / `manual`), `center_label`. Places `searchText` bias is now optional (ranking always sets it). Tests: two-account scenario (disconnect A, B keeps working, with real agenda jobs), center service and flow, route checks. |
| this commit | Docs for the fixes: API.md, GBP_CONNECT.md, ENDPOINTS.md, ROUTES (173), CLAUDE §11, STATUS ("Decide before launch (Maps ToS)"), this entry. |

### Checks

| Check | Result |
|---|---|
| `npm run build` | **0 TypeScript errors.** |
| `npm run lint` | 98 (unchanged baseline). All new files are lint-clean. |
| `npm test` (no key) | **414/414 pass** in 35 suites (67 new in 7a, including the review fixes). |
| Local, no Google calls | `GET /google/gbp/popup` returns the config (only `openid email business.manage`, `select_account consent`, a 43-character state). `POST /google/gbp/code` with a bogus state gives 400. `GET /onboarding/state` for the live-test user gives not connected with no locations. `/places/search` without a token gives 401. The server log shows 0 Places or GBP calls. |

**API calls consumed: 0.**

### Decisions (approved with the plan)
1. **Suggestions use the Text Search Enterprise SKU** (rating and review count): 1 call per keyword (2 in development), cached 24 hours.
2. **Switching Google account while bound gives 409** ("disconnect first").
3. **`/places/search` requires `locationId`.**
4. **US and Canada only** at select-profile.
5. **`PLACES_USER_DAILY_LIMIT` = 50** per user per UTC day (suggestions + manual search).
6. **`/onboarding/complete` records `gbp_sync.requested_at`**; the 7b scheduler picks it up.
7. **The suggestions cache holds names, addresses and ratings for 24 hours:** part of the Maps ToS decision before production.
- **Also:** a service-area business can be onboarded (country from `serviceArea.regionCode`). Competitor suggestions need coordinates, so for it they work only after its first ranking run resolves the center.
- **Popup settings (after review):** `select_account: true` only; no `prompt`. A same-account reconnect without a refresh token reuses the stored one.
- **Several Google accounts per user (after review):** replaces the earlier 409 "switch account" rule.
- **Service-area center (after review):** geocoded with Places (IDs-only search + Details `location`) instead of the Geocoding API (not enabled) or Nominatim (1 request/second policy, different data source).

### Shared or out-of-scope files touched
`services/user/userAuth.service.ts`, `controllers/user/userAuth.controller.ts` and `routes/v1/user/userAuth.route.ts` (the two popup routes only); `routes/v1/common/index.ts` (two mounts); `models/location.model.ts` (additions only); `models/index.ts`.

### Your live steps (when you say so; in order)
1. **Popup connect** for MyPageSEO (frontend, or a small test page with the GBP_CONNECT.md snippet). Calls: 1 OAuth token exchange + 1 certificate fetch. Connecting another Google account later adds a second connection.
2. **`npm run gbp:preflight -- 6ab76e2c99cf66c2cc414a13`**. Calls: 1 accounts page + 1 locations page per account.
3. **select-profile.** 1 GBP call.
4. **Competitor suggestions.** 2 Enterprise Text Search calls in development (1 per keyword, first 2 keywords).
5. (7b) first sync; (7c) report.

The frontend also needs the **Authorised JavaScript origin** in the OAuth client for the popup.

---

## Phase 9a: Legacy cleanup (early part of Phase 9)

Branch `claude/phase-9a-legacy-cleanup`, from the 7a branch (so it merges after 7a), with the 7a review fixes merged in (`6867c88`). Requested by Mohit.

**Mohit's decisions:**
- Delete the old ranking and report endpoints now (the frontend moves to the new ones).
- Remove the Reputation Manager and the white-label report links, but keep a rebuild reference.
- Remove every unused config and env variable (checked one by one).

### Commits

| Commit | What it did |
|---|---|
| `2e1fc26` | Deleted (57 files, about 7,300 lines):<br>• old Rank Tracker / Local Search Grid / Local Map Ranking / GBP Audit / Reputation Manager (routes, controllers, services, middlewares, helpers, models)<br>• the 3 white-label report routes<br>• the Search Console connect (3 routes, `oAuth2Client.ts`)<br>• `serpConfig`, `google-countries`, `google-domains`, `serpCountryCode`, `razorpay.ts`, `gbpOauthClinet.ts`, the legacy select fields<br>• unused config and env vars (Stripe, Razorpay, SerpAPI, Moz, DataForSEO, `GOOGLE_PLACE_API_URL`, unused Square / company / JWT-minutes / admin-URL / role vars)<br>The legacy location create now uses the Places (New) client, `location` field only (C23). The legacy `generateGrid()` regression test now uses recorded output. |
| `6867c88` | Merged the 7a review fixes (clean merge). |
| this commit | Removed the unused `googleapis` package. Docs: `LEGACY_FEATURES.md` (what the removed features did, why, and how to rebuild the Reputation Manager and white-label links properly; the old code is at `1695187`), `MIGRATION.md` (unused collections, dead rows and fields, removed env vars), ROUTES (158 routes), AUDIT (9 superseded findings → removed; C8, C11 and C23 updated; S13, S15 and S17 partly resolved), ENDPOINTS, OPERATIONS, CLAUDE §3 and §13, STATUS, this entry. |

### Checks

| Check | Result |
|---|---|
| `npm run build` | **0 TypeScript errors.** |
| `npm run lint` | **32** (was 98). Most of the baseline was in the deleted legacy files. No touched file got worse. |
| `npm test` | **414/414 pass** (no key, no network). |

**API calls consumed: 0.**

### Kept on purpose
- **Square and PayPal:** payments still use them.
- **SMTP.**
- **`serpapi`:** the citation tracker (out of scope) imports it; it has never worked (C13).
- **`users.is_analytics_connected`:** still returned to the frontend (MIGRATION.md).
- **MongoDB collections:** none dropped.

### Merge order (Mohit)
1. 7a: `claude/phase-7a-connect-onboarding`
2. then 9a: `claude/phase-9a-legacy-cleanup`

---

## Decisions 2026-09-26: roadmap, monthly cadence, add-location paths, phase order

Recorded on `claude/phase-7b-gbp-sync` before 7b work (docs-only commit).

- **Target product:** `docs/product/frontend-roadmap.pdf` (25 pages, Business vs Agency, screen inventory). Summarised for the backend in `docs/PRODUCT.md`. Every §16 screen is mapped to endpoints and a status in `docs/FRONTEND_BACKEND_MAP.md`, including an explicit "not supported" list: organic Google ranks, search volume, competitor citations/links/authority, competitor photo counts, Q&A, duplicates, Analytics/Search Console, social login.
- **Decision 1: monthly auto + manual refresh.**
  - Per-location monthly refresh (rank run → GBP sync → GBP report), staggered on the setup day (≤ 28) at about 03:00 local time.
  - `POST /locations/:id/refresh` (24 h per type, `next_allowed_at`).
  - `tracking.frequency` becomes `auto_monthly | manual_only` (migrated).
  - One `monthly-refresh` scheduler.
  - 7b sync windows: performance a rolling 40 days, keywords the last 2 months.
- **Decision 2: two ways to add a location, no manual entry.**
  - (a) GBP profile or (b) Places search (one minimal Place Details call).
  - Every location has a `place_id`, plus `source` and `gbp_connected`.
  - A later GBP bind is matched by `place_id`.
  - `gbp_not_connected` sections.
  - A per-organization duplicate guard.
- **New phase order:** 7b → live test → 7c (M3) → **8 Auth, Organization, Onboarding & Locations** → 9 GBP posting → 9b cleanup → 10 security. Nothing is planned beyond Phase 8. M4 is to be agreed.
- **CLAUDE.md** updated: product intent, the "Refresh cadence" in §4, the phase order and milestones, §11 7b/7c, §12 new Phase 8, §12a posting as Phase 9, §13 cleanup as 9b.

---

## Phase 7b: GBP sync on the monthly cadence

Branch `claude/phase-7b-gbp-sync`, from `claude/phase-9a-legacy-cleanup` (merge order 7a → 9a → 7b). It follows CLAUDE.md §11 7.1, Mohit's Decision 1 (monthly cadence + manual refresh) and the approved plan. **Offline:** fixtures and mocks, **0 Google or Places calls**.

### Commits

| Commit | What it did |
|---|---|
| `7869fca` | Context docs (the roadmap PDF, PRODUCT.md, FRONTEND_BACKEND_MAP.md, CLAUDE.md, STATUS, PROGRESS): decisions and the new phase order. |
| `ebb81bb` | GBP sync data layer.<br>• **Models:** `GbpSync` (one active per location), `GbpMetricDaily`, `GbpKeywordMonthly` (values vs thresholds), `GbpProfileSnapshot` (dated history, `is_latest`), `GbpReview` (display name only).<br>• **`gbpClient`:** Performance daily metrics, search keywords (one month per request: the API sums over a range), full profile, attributes, `getGoogleUpdated`, Voice of Merchant, and v4 reviews/media/customer media/posts, all paginated.<br>• Pure `windows.ts` and `mappers.ts`.<br>• Fixtures and tests. |
| `0d1f5e2` | Cadence and sync.<br>• **`cadence.ts`:** the anchor day (≤ 28), the next date at about 03:00 local (IANA zone, else longitude offset, else UTC), no drift or bursts.<br>• **`monthly-refresh` scheduler:** replaces `rank-scheduler` and cancels its old document; stuck guards for runs and syncs; compare-and-set claim; rank run + GBP sync (if bound).<br>• **Manual refresh:** `POST/GET /locations/:id/refresh` (24 h per type, compare-and-set claim, released on failure, 429 when everything is limited); "run now" shares the rankings limit.<br>• **`gbp-sync` executor/job:** backfill 18 m / 6 m, then rolling 40 d / 2 m; per-type status; connection-wide abort; v4 behind `GBP_V4_ENABLED`; upserts; snapshot; `onGbpSyncFinished` hook for 7c.<br>• `GET /locations/:id/gbp/sync`.<br>• `tracking.frequency` becomes `auto_monthly \| manual_only` (mapped on read, `next_run_at` rejected) + `npm run migrate:refresh`.<br>• Onboarding `/complete` queues the first sync and sets the anchor.<br>• The shared process-wide GBP limiter.<br>• Tests. |
| this commit | Docs: API.md (refresh, sync), ENDPOINTS (#25–27, updated #2/#3/#22), FRONTEND_BACKEND_MAP, OPERATIONS (jobs, migration, v4 go-live), ROUTES (161), GBP_CONNECT (first sync), CLAUDE §3/§9/§11 as built, STATUS, this entry. |

### Checks

| Check | Result |
|---|---|
| `npm run build` | **0 TypeScript errors.** |
| `npm run lint` | 32 (baseline). New files lint-clean. |
| `npm test` (no key) | **453/453 pass** in 43 suites (+29 new; the jest hook timeout was raised to 30 s because more suites now start an in-memory MongoDB in parallel). |
| Local, no Google calls | `migrate:refresh` on `mps_rebuild`: 1 → `auto_monthly`, 1 → `manual_only`, 2 schedules set. `npm run dev` (with the Places key forced empty): "Agenda jobs defined: post-to-gbp, rank-run, gbp-sync, monthly-refresh"; "Cancelled 1 old rank-scheduler job document(s)"; the first tick ran in 13 ms. `GET /refresh` and `GET /gbp/sync` for the live-test location answer correctly (`manual_only`, not connected). 0 Places/GBP calls. |

**API calls consumed: 0.**

### Decisions (approved with the plan)
1. **About 03:00 local:** `Location.timezone` if set, else an offset estimated from longitude (±1 h), else UTC. There is no timezone-database dependency; Phase 8 can fill `timezone`.
2. **"Run now" (`POST /rank-runs`) shares the 24 h rankings limit** with `/refresh`.
3. **`rank-scheduler` removed.** `monthly-refresh` takes over the stuck guard (runs and syncs).
4. **Onboarding `/complete` queues the first GBP sync directly** and sets the monthly anchor.
5. **`GbpReview` keeps the reviewer display name only.**
6. **The raw Business Information location** is kept on each snapshot (the owner's own data) for 7c.
- **Also:**
  - Search keywords are fetched **one month per request**, because the Performance API sums over the requested range.
  - The first sync counts as backfilled once performance is stored.
  - Each sync gets its own client (own call counts) that shares one process-wide ≤ 5 rps limiter.

### Merge order (Mohit)
```sh
git switch claude/rebuild
git merge --no-ff claude/phase-7a-connect-onboarding -m "Phase 7a — Google connect (popup) + onboarding"
git merge --no-ff claude/phase-9a-legacy-cleanup -m "Phase 9a — legacy cleanup (early)"
git merge --no-ff claude/phase-7b-gbp-sync -m "Phase 7b — GBP sync on the monthly cadence"
npm run migrate:refresh   # local mps_rebuild (already run once; idempotent)
```
No push: M3 comes after 7c.


## On `claude/rebuild` after the 7b merge (2026-09-26)

- **`dumps/cities.json`:** Mohit's intentional reduction to the supported countries (US, AU, UK, IN, CA, IE), committed on its own.
- **Endpoint docs rule** (Mohit): [ENDPOINTS.md](ENDPOINTS.md) is the single source of truth for every current endpoint (161 routes + 1 dev-only), with auth, purpose, phase and status (`live | behind flag | deprecated | dev only`).
  - `npm run check:endpoints` (`tests/docs/endpoints.test.ts`, helper `tests/helpers/endpoints.ts`) loads the Express app without MongoDB, agenda or cron, lists every route (nested routers expanded; a path-mounted middleware such as swagger `/docs` counts as GET) and fails on drift in either direction, on a bad status, and on a detail row (`#`) not in the catalogue. It runs inside `npm test`.
  - ROUTES.md is now a frozen snapshot. The rule is in CLAUDE.md §2 and the end-of-phase checklist.
- **Live-test page:** `GET /dev/gbp-connect` (`src/routes/dev/devConnect.route.ts`), mounted in `app.ts` only when `NODE_ENV=development`. It runs the GIS popup flow against `/user/auth/google/gbp/popup` and `/code`, with its own CSP (helmet's blocks the GIS script). GBP_CONNECT.md §3a; the preflight example updated to the multi-account output.
- **Shared-file edit (called out):** `src/app.ts`, 5 lines to mount the dev router.
- **API calls:** 0.

## Live test with MyPageSEO, attempt 1 (2026-09-26, triggered by Mohit)

- **Popup connect: passed.** On `/dev/gbp-connect`, the Google account `mohit@mypageseo.com` connected (`google_sub` 101302451261559635090). Tokens are stored encrypted (`enc:v1:`), with scope `business.manage` + `userinfo.email` + `openid`, the id_token verified, and `is_gbp_connected=true`.
  - Setup fixes on the way: `ACCESSDOMAINS` must include `http://localhost:5055` (a same-origin POST sends an `Origin`), and `TOKEN_ENCRYPTION_KEY` was set.
- **Profile discovery: blocked by Google.** `accounts.list` returned 429 `RATE_LIMIT_EXCEEDED` with `quota_limit_value: 0` for "Requests per minute" on `mybusinessaccountmanagement.googleapis.com` (Cloud project 1010247538246). The GBP API access is not approved for this project; per CLAUDE.md §10 this is an access gate, so the test stopped here.
- **Google calls:** 1 OAuth code exchange, 1 `accounts.list` (429). Places: 0.
- **Not run yet:** preflight, bind, first sync. They resume once Google approves access (quota > 0).
- **Found:** `mongoose.set('debug', true)` in `src/configs/mongoConnection.ts` is unconditional, so every query is logged in every environment, including user emails, OAuth-state hashes and the (encrypted) token documents.

## On `claude/rebuild` after the live test (2026-09-26)

- `4184c23` **Mongoose query logging** is opt-in: `MONGOOSE_DEBUG` (default false), honoured only with `NODE_ENV=development`, ignored with a startup warning elsewhere (`src/configs/mongooseDebug.ts`, tests). Before, every query and document (emails, OAuth-state hashes, encrypted tokens) was logged in every environment.
- `0a55d15` STATUS "Blocked on Google": GBP API access (quota 0; resume at `gbp:preflight` when Mohit says "GBP access approved"), v4 access, OAuth app verification.

## Phase 7c: GBP Score, Public Score, competitor comparison and the GBP report

Branch `claude/phase-7c-scoring-report` (from `claude/rebuild`). Built and tested only on fixtures and `seed:gbp-demo`: **0 GBP calls, 0 Places calls.**

**Commits**
- `dab1780` pure layer: `scoring.config.ts`, GBP Score, Public Score, US/CA holidays, performance / keywords / reviews sections, competitor set + freshness rule, gap insights, with tests.
- `cf1e07c` report: `GbpReport` model, generation, `gbp-report` job with debounced requests, `GET /locations/:id/gbp/report` (#28), `/refresh` report state and competitor refetch flag, demo data builder, config; ENDPOINTS.md and API.md in the same commit; the `check:endpoints` parser now handles escaped pipes.
- `9b8f53d` `npm run seed:gbp-demo [-- --v4-off]`.
- docs commit: FRONTEND_BACKEND_MAP, OPERATIONS, GBP_CONNECT §6, CLAUDE.md as built, STATUS, PROGRESS.

**What changed**
- **GBP Score** (private, 0–100): completeness 25, activity 20 (v4), reviews 25 (v4), visibility 20, engagement 10; 26 checks. Missing data → `not_available` → excluded and rescaled (`partial`). Today (v4 off) the score runs on completeness + visibility + engagement.
- **Public Score** (client and competitors alike): rating 25, review count 20, center rank 20, center top-3 10, public profile 25.
- **Competitor comparison:** client + tracked competitors + top 3 of the map list (max 5), Place Details at most once per monthly cycle (or on a manual refresh after 24 h), gap insights (max 5).
- **Report sections:** performance per range (28 d / 90 d / 12 m, previous period, same period last year, coverage), keywords (thresholds kept), reviews / media / posts (v4), pending Google edits, verification, sync status, score history.
- **Generation:** after each GBP sync and rank run (and competitor change, unbind), debounced 120 s and skipped while a run or sync is active: a monthly refresh gives one report.
- **Unbound locations** (Places search): private sections `gbp_not_connected`; Public Score and comparison work.

**Files touched (shared, called out):** `src/models/location.model.ts` (`gbp_report`), `src/jobs/rankRun.job.ts` (report hook), `src/services/gbp/binding.service.ts` (unbind requests a report), `src/controllers/ranking/ranking.controller.ts` (competitor change), `src/services/refresh/refresh.service.ts`.

**Decisions (approved in the plan):** thresholds as in `scoring.config.ts` (starting values); Public Score ranks from the map list for everyone; `editorialSummary` off by default (Atmosphere tier); no separate competitor-refresh endpoint; one report per location (no Places history); 120 s debounce; competitor change requests a report.

**Tests:** 547 pass (was 467 before 7c); build 0 errors; lint baseline 32 unchanged. Dev server check with the Places key empty: `gbp-report` job registered; report for all 3 ranges, `gbp_not_connected` for the unbound demo location, 400 for a bad range, `/refresh` report state; 0 Google calls.

**API calls consumed:** 0.

### Scoring calibration (after "GBP access approved")

Run after the first real sync and report for MyPageSEO (GBP_CONNECT.md §5–6). Compare each against the real data and propose threshold changes in `scoring.config.ts` for approval:
1. **Coverage and lag:** latest metric date vs today; days with data in 28 / 90 / 365; does the 80 % coverage rule blank out a small profile?
2. **Engagement:** real actions per 1,000 impressions vs the 5 / 15 / 30 / 50 bands.
3. **Impressions trend:** the real month-to-month swing vs the ±10 % bands.
4. **Completeness vs the real profile:** description length, categories, attribute count (≥ 5), service items, pending edits, verification. Any false fails?
5. **Visibility:** MyPageSEO's real `overallAvgRank` and top-3 rate (Phase 5.5 runs) vs the rank bands.
6. **Public Score:** client vs 3–5 real Fredericton competitors. Does the ordering match intuition? Do the review-count bands suit a small market?
7. **Keywords:** share of threshold-only keywords; are the `not_tracked` suggestions useful?
8. **Place Details calls** per generation vs the estimate (≈ 6).

## Phase 8: Auth, Organization, Onboarding & Locations

Branch `claude/phase-8-org-onboarding` (from `claude/rebuild` after the 7c merge and the M3 push). Offline only: **0 Google calls, 0 Places calls** (the add-location Place Details is mocked in tests; the demo seed uses offline clients).

**What changed**
- **Organizations:** `Organization` (business / agency, name, country, owner, onboarding skips) and `Membership` (owner / member / client_user with `client_ids`). Locations and clients carry `organization_id`; every access check in the rebuilt code moved from `created_by` to membership (ranking, refresh, sync, report, onboarding, binding, Places search, legacy GBP posting). `X-Organization-Id` picks the organization; otherwise the user's default.
- **Auth:** `/auth/signup|verify-email|verify-email/resend|login|forgot-password|reset-password`. Codes are HMAC-hashed, 15 minutes, 5 attempts, single use; Mongo rate limits; neutral answers for resend and forgot; reset revokes refresh tokens; logs carry user ids only. Legacy `/user/auth/{register,otp,verify-otp,login,forgot-password}` deprecated (still live); legacy register creates an organization and employee add/remove maintains memberships.
- **Plan limits:** optional `location_limit` / `keyword_limit` on `SubscriptionPlan` (read from the owner's active plan), default `DEFAULT_LOCATION_LIMIT=1`; enforced on select-profile (new location), `POST /locations` and `PUT /tracking`. `GET /organization/usage`.
- **Locations:** legacy routes replaced at the same paths; `google-locations/*` deleted. `GET /locations` (search, filter, sort, pages; status `active | setup_required | gbp_not_connected | reconnect_required`), `POST /locations { place_id }` (1 Place Details, US/CA, duplicate guard), `GET /locations/:id`, `/overview`, `PATCH`, soft `DELETE`. `Location.summary` kept by the rank-run and report hooks.
- **Clients:** `/clients` CRUD, assign / unassign, detail with locations and summary (agency only; client_user sees its own).
- **Onboarding:** organization steps (Business / Agency) derived from data, `POST /onboarding/skip`, location step `place_selected`, `/complete` without GBP, `place_id_mismatch` and `duplicate_place` refusals on bind.
- **Scripts:** `migrate:organizations`; `seed:demo-orgs` (Business + Agency + client user; `seed:gbp-demo` alias); `seed:rank-demo` and `setup:live-test` create organizations.

**Files touched (shared or out of scope, called out):**
- `src/models/subscriptionPlan.model.ts`: 2 optional fields, data only.
- `src/models/user.model.ts` (`default_organization_id`), `src/models/client.model.ts` (organization, contact email, optional URL / generated unique id).
- `src/utils/apiError.ts`, `src/utils/errorHandler.ts`: optional `data` on errors.
- `src/services/user/userAuth.service.ts`: organization hook on legacy register; membership hooks on employee add/remove.
- `src/middlewares/common/gbpPostSchedular.middleware.ts`: 2 location lookups → membership.
- Deleted: the legacy location controller, service and middleware (replaced).
- Not changed: white-label (still `created_by`), payments, citations, admin.

**Local data (mps_rebuild):** `migrate:organizations` mapped 3 accounts to business organizations (the live-test user → "Live Test"), assigned 3 locations and reported one duplicate (the old gbp-demo account, removed by `seed:demo-orgs`); a second run was clean and synced the unique index.

**Tests:** 573 pass (was 547); build 0 errors; lint baseline 32. Dev server with the Places key empty: agency list (3 statuses), usage, client detail, overview, client_user reads 200 and writes 403, a business add over the limit 403, signup 201 and unverified login 403; 0 Google calls.

**API calls consumed:** 0.

**Open questions**
- Team invitations, role changes and client-user invites are modelled (roles enforced) but have no endpoints yet.
- The live-test organization is named "Live Test" (from its profile); rename with `PATCH /organization` if wanted.
- White-label profiles still check `created_by` (out of scope).

## On `claude/rebuild` after the Phase 8 merge (2026-09-27)

- `19b9a1d` OPERATIONS.md: a **deploy checklist** (backup, env, build, `migrate:refresh`, `migrate:organizations`, `gbp:encrypt-tokens`, start).

## Phase 11: Dashboards + team (M4)

Branch `claude/phase-11-dashboards-team`. Offline only: **0 Google calls, 0 Places calls**.

**What changed**
- **Summary:** `Location.summary` gains the dashboard fields (see CLAUDE.md §12b), written after each rank run and GBP report. The run summary reads only the latest run's tracker summaries, targets and map-list names, plus the last 6 runs' overall figures.
- **`GET /dashboard`:**
  - **Business:** visibility + trend, GBP Score + change, reviews (public numbers until v4), movement, key competitor, top 5 actions, refresh, statuses, locations.
  - **Agency:** clients / locations, portfolio averages, status counts, declines, GBP issues, actions, paged and sortable table.
  - A client_user is limited to its clients. No rank-run or report reads at request time (tested with spies).
- **Team:**
  - invitations (owner): create / re-issue, list with statuses, revoke
  - accept / inspect (public, token in the body): new accounts are created verified and logged in; existing accounts get `login_required`
  - role change and removal (the owner is protected), rate limits
  - `sendInvitationEmail`; development logs the link with the email masked
- **Scripts:** `summaries:rebuild`; `db:sync-indexes` (it dropped the stale Phase 6 `user_auths` unique index on the local database; any database from before 7a has it and it blocks a second Google account); `seed:demo-orgs` extended.
- **Fix found on the way:** unstable ordering when two memberships or invitations share a `created_at` millisecond (flaky test); `_id` is now the tie-breaker.

**Files touched (shared, called out):** `src/services/common/email.service.ts` (one exported `sendInvitationEmail`), `src/configs/config.ts` (`FRONTEND_URL` in the Joi config, `INVITATION_TTL_DAYS`).

**Tests:** 590 pass (was 573); build 0 errors; lint 32. Dev server, Places key empty: business, agency and client-user dashboards; invite → masked dev log link → inspect → accept (new account) → role change → remove; 0 Google calls; the invitee's email never in the log.

**API calls consumed:** 0.

## Phase 12: Reports center

Branch `claude/phase-12-reports`. Offline only: **0 Google calls, 0 Places calls**. Plan approved 2026-09-27 (PDFKit over Puppeteer).

**What changed**
- **Reports:** Rank Tracker, GBP Audit, Competitor Analysis and Full, from stored data only (rank run, GBP report, profile snapshot). Generation freezes the section data and the branding (logo included) in a `ReportSnapshot`, then renders the PDF once into the private `REPORTS_STORAGE_DIR`. One active report per location and type; a stuck one (30 min) is marked failed. v4 sections are "Not available yet", never sample data.
- **PDF engine: PDFKit**, with DejaVu Sans embedded (accents print). One document model (typed blocks) feeds the PDF renderer, the HTML share page, the email body and the in-app viewer (`GET /reports/:id` → `document.blocks`). Heatmaps are vector grids (two per row), charts are vector lines.
- **Measured** (compiled code, the seeded 8-page Full report): about 50 ms CPU and 40 MB transient memory per render; heap flat across 100 renders (81 MB); 30–50 KB per PDF. No Chromium, no system packages; nothing extra per pm2 instance.
- **Library and actions:** list (filters, paging, archived), view, PDF download, archive, email (attachment, or a 30-day link above 10 MB; branding sender name + reply-to; 20 / hour per organization; development logs with masked recipients).
- **Share links:** hashed 32-byte tokens shown once, optional expiry, revocable; public `/r/:token` (HTML) and `/r/:token/pdf` with noindex, CSP `default-src 'none'`, no-referrer, 60 / min per IP, the same 404 for every failure, no internal ids; the request log redacts the token.
- **Schedules:** monthly, location or client scope; fire once per monthly automatic refresh of each covered location, after its GBP report (`report-schedule-dispatch`, compare-and-set on the cycle), then emailed when ready (`report-email`); `next_expected`, `last_sent_at`, `last_error`. Manual refreshes don't fire; `manual_only` locations are refused.
- **White-label (agency only):** `Organization.branding` (agency name, private logo, colours, footer/contact, hide MyPageSEO, sender name, reply-to). Business organizations get the default branding. The agency onboarding step `reporting_brand` is now real (done once branding is saved; skippable).
- **Legacy white-label:** `/white-label-profiles*` marked deprecated (still live; the unauthenticated `GET /:id` goes in Phase 10). `npm run migrate:branding` copies each agency's primary legacy profile (name → agency name, header → contact text, footer, colour name → colour, logo into private storage); never overwrites.
- **Reused vs replaced:** reused the legacy profile fields and the email transport; replaced per-location profiles (→ one per organization), public logo files in `public/uploads` (→ private storage), the unauthenticated profile read and `access_password` links (→ hashed, expiring, revocable share tokens).
- **Retention:** daily `report-retention` deletes PDFs and snapshots older than `REPORT_RETENTION_MONTHS` (24) → `expired`.
- **Scripts:** `migrate:branding`; `db:sync-indexes` covers the report collections; `seed:demo-orgs` renders 6 reports offline, agency branding with a generated logo, one client schedule and one share link.

**Endpoints:** #61–#81 (ENDPOINTS.md, API.md "Reports center"), FRONTEND_BACKEND_MAP.md (Reports, White label; Citation Report "planned (Phase 16)").

**Files touched (shared, called out):**
- `src/services/common/email.service.ts`: one exported `sendReportEmail`.
- `src/configs/morgan.ts`: the log format uses `:safe-url` (redacts `/r/<token>`).
- `src/app.ts`: mounts `/r` (share links).
- `src/services/auth/rateLimit.ts`: two limits (`reportEmailPerOrg`, `sharePerIp`).
- `src/services/gbp/report.service.ts`: after a generated GBP report, requests the schedule dispatch.
- `src/services/org/onboardingState.ts`: `reporting_brand` derived from branding.

**Decisions:** PDFKit over Puppeteer; white-label agency only; branding frozen per report; schedules per monthly auto-refresh cycle; logo as a base64 JSON body; `/r/:token` path with log redaction; legacy white-label deprecated, not deleted; above 10 MB emails carry a link. The frozen branding lives on the snapshot (not on `Report` as the plan said) so the logo bytes stay with the frozen data.

**Open questions for Mohit:**
- Local `.env` has `API_BASE_URL=http://localhost:5000` while the dev server listens on 5055, so seeded share links point at 5000. Set `SHARE_BASE_URL=http://localhost:5055` (or fix `API_BASE_URL`).
- Production: nginx must forward `/r/` to the app (not only `/api`), and `SHARE_BASE_URL` should be the public API origin.
- Share pages and emails show business names from Place Details (competitor table) and the map list: part of the existing "Decide before launch (Maps ToS)" items.

**Tests:** 619 pass (was 590; 29 new across `tests/services/reports/*` and `tests/routes/reports.routes.test.ts`, plus the onboarding step); build 0 errors; lint 32 (baseline). Dev server, Places key empty: library (agency and client user), create → agenda job → ready in ~1 s → PDF download, email in development (masked log), share → public HTML (headers checked, 0 ids, 0 scripts) and PDF → revoke → 404, schedules with `next_expected`, branding and logo; tokens redacted in the request log; 0 Google calls.

**API calls consumed:** 0.

## Phase 12.5: Ranking & data quality

Branch `claude/phase-12.5-quality`. Decisions (Mohit, 2026-09-27): push after every merged phase; Maps ToS accepted risk for now (stores listed in STATUS.md, attribution added); quality over cost (about $1 per refresh acceptable; no monthly manual-refresh cap existed, the 24 h guard stays). Offline build: **0 Google calls**. The live variance test is built and waiting for Mohit.

**What changed**
- **Full depth:** ranking searches fetch every page (up to 60 results); `stopWhenFound` stays in the client for other uses. Per point `result_count` is now meaningful, and the full ordered list of every point and sample is stored in `rank_result_lists` (one document per run and keyword; dictionary of place IDs + uint16 indexes: 120 bytes per 60-result list, ~22 KB per keyword at 7×7, ~0.45 MB per 20 × 7×7 run with 1 sample, ~1.2 MB with 5; plain arrays would be ~2.3 / ~11.5 MB).
- **Repeated sampling:** `RANK_SAMPLES_PER_POINT` (1–5, default 1) and `RANK_SAMPLE_SPACING_SEC`; the point's cell is the median (61 = not found, errors excluded, error majority → error, even count rounded up), with every sample and the spread stored on the cell and shown by the rank-tracker and grid endpoints.
- **Map Ranking at 5 points:** the named top 20 at C/N/S/E/W (`MAP_RANKING_POINTS=all|center`); `GET map-ranking ?point=`; the Rank Tracker report's "Who ranks across the area" table. Center-only consumers (competitor set, center ranks, Public Score) filter the center lists.
- **Competitors:** Place Details now include reviews (up to 5, author name + profile link kept), photos (count, "10+") and editorial summary (Enterprise + Atmosphere; the flag is gone, so every Public Score's editorial part is now available and scores shift once). Insights `photos_gap`, `review_freshness`; the Competitor Analysis report gets a Photos column and "What customers say".
- **Runtime:** `estimateCalls` counts samples and map points; `estimateDuration`; `RANK_MAX_CALLS_PER_RUN` 16,000 (20 × 7×7 × 3 pages × 5 samples = 15,900); `RANK_SEARCH_CONCURRENCY` (4); `PLACES_MAX_QPS` (8/s) enforced across all pm2 processes by a MongoDB per-second counter, assuming the default 600/min per method; `expected_duration_ms` on runs, the stuck guard waits max(30 min, 2 × expected + 10 min), and the rank-run job renews its agenda lock every minute. Expected: 10 keywords × 5×5 ≈ 2 min (1 sample), 5.5 min (3 samples 60 s apart), 22 min (3 samples 10 min apart); the maximum ≈ 33 min.
- **Cost visibility:** `api_usage` ledger (organization, location, month, SKU) for every Places and GBP HTTP call, attributed through AsyncLocalStorage scopes (every `/api/v1` request, filled in by the org and location access helpers; the rank-run, gbp-sync and gbp-report jobs). `GET /organization/usage` → `api_usage`; `npm run cost:report`; list prices in `src/configs/pricing.ts` (`PRICING_FILE`). OPERATIONS.md: cost model (≈ $1.75 per monthly refresh at 10 keywords, $3.35 at 20; `MAP_RANKING_POINTS=center` → ≈ $0.47) and the Google Cloud checklist.
- **Attribution:** `attribution: { provider: "Google", text: "Business data © Google" }` on map-ranking, competitor-suggestions, places/search, the GBP report, locations list/overview, dashboard and report view; PDFs and share pages print it under Places tables and in every page footer when the report shows Places content.
- **Variance test** (`npm run variance:test -- --confirm-live`): MyPageSEO, "marketing agency" + "digital marketing agency fredericton", 5 tracker points, 3 samples at 0 s / 60 s / 600 s; worst case 270 IDs-only calls, stopped before 300; writes `docs/calibration/variance-<date>.md` with the % identical and max spread per spacing and target, and the recommendation by Mohit's rule.

**Files touched (shared, called out):** `src/app.ts` (the usage scope middleware on `/api/v1`), `src/services/org/access.ts` and `src/middlewares/org/org.middleware.ts` (fill in the usage scope), `src/clients/gbpClient.ts` (counts each call), controllers for attribution (dashboard, locations, onboarding, GBP report, reports).

**Decisions:** as approved in the plan (compact list storage; median rounded up on an even count; editorial summary always fetched; Map Ranking at 5 points as the default with a center switch; 8 req/s cluster-wide; Mohit's attribution wording, with Google's "Google Maps" wording one constant away; default 1 sample until the variance test).

**Open for Mohit:**
- Trigger the variance test and confirm the resulting sampling default.
- Do the Google Cloud checklist (OPERATIONS.md) before the first monthly refresh on the server.
- Prices in `src/configs/pricing.ts` are list prices as I know them; check them against Google's current pricing page.
- The monthly refresh cost with Map Ranking at 5 points is ≈ $1.75 (10 keywords) to $3.35 (20 keywords), above the "about $1" guide; `MAP_RANKING_POINTS=center` halves the Pro calls if needed.

**Tests:** 645 pass (was 619), no key, no network; build 0 errors; lint 32. Dev server (key empty): map-ranking `point=N` and `all`, sample fields on grid cells, `api_usage` in `/organization/usage`, attribution on the dashboard, `cost:report`, `variance:test` refuses without `--confirm-live`; 0 Google calls. `seed:demo-orgs` re-rendered the reports (Map Ranking table, reviews, photos insight, attribution in the footer checked visually).

**API calls consumed:** 0.

## On `claude/rebuild` after the Phase 12.5 merge (2026-09-27)

Phase 12.5 merged (`c5aee43`) and pushed by Mohit; `COMPETITOR_DETAILS_ATMOSPHERE` removed from his `.env`. Follow-ups committed on `claude/rebuild` at Mohit's request:
- **Sampling defaults:** 3 samples 60 s apart, from the variance test (0 s: 90 % of points identical, max spread 2; 60 s: 80 %, max spread 5; 10 min interrupted). `estimateCalls` defaults follow the config, and tests pin 1 sample.
- **Variance test record:** the script only wrote its file at the end and the run was interrupted, so `docs/calibration/variance-2026-09-27.md` was written from the reported numbers. The Ctrl-C also skipped the usage flush, so `api_usage` has no record of those ~180+ calls. The script now writes and flushes after each spacing and on Ctrl-C; `--spacings=600` reruns one spacing into its own file.
- **Attribution text:** "Google Maps".
- **Decisions:** recorded with dates in STATUS.md; methodology changes dated in the new `docs/CHANGELOG.md` for chart markers.
- **OPERATIONS.md:** decided defaults, durations, storage per run, cost per refresh (accepted), limits and quota assumption, post-deploy steps.
- **CLAUDE.md:** Phase 12.5 done; the "nothing lives only in chat" rule; Phase 16 (citations) spec, right after Phase 10; Phase 10 must include the admin auth and roles.

Tests 646 pass, build 0 errors, lint 32. **API calls:** the variance test, run by Mohit: ≥ 180 IDs-only (free SKU) plus part of the last round, 0 Pro.

## Phase 10: Security hardening

Branch `claude/phase-10-security`. Plan approved 2026-09-27; all Deferred-P10 items plus the admin auth and roles Phase 16 relies on. Offline: **0 Google calls**.

**What changed** (one commit per area; statuses per item in AUDIT.md):
- **Admin auth (S1, S14, S19, S22 admin):**
  - one token module (`ADMIN_JWT_SECRET`, HS256, audience `mps-admin`, 12 h sessions, 15-minute single-use reset tokens, `token_version` revocation)
  - roles → permissions (`admins.manage`, `platform.read` / `write`, `content.manage`, `system.read`, `citations.manage`)
  - crypto passwords and OTPs, rate limits, no account enumeration
  - a password change uses the signed-in admin (it took `admin_id` from the body)
  - no self role change, the last super admin protected, no secret fields in responses
- **Guards (S2, S3, S17, S27):** 49 admin-only routes; the white-label profile detail needs its owner. The guard test is generated from ENDPOINTS.md.
- **Transport (S5, S7, S8, S9, S10, S16, S28):**
  - trust proxy; full helmet; no wildcard CORS (unknown origins get no headers instead of a 500)
  - 1 MB bodies; uploads only on 5 routes after auth (text fields still parsed elsewhere); file routes contained
  - the error handler: generic 500s, 4xx kept, one log line
- **Input and payments (S4, S6):** request sanitiser instead of `sanitizeFilter` (explained in §13a); PayPal webhooks verified with PayPal; checkout routes rate-limited.
- **Tokens and legacy auth (S15, S22–S25):**
  - user `token_version`, HS256 pinned, bad tokens 401 (were 500), 1-day access tokens
  - legacy OTP attempts / expiry / hashed reset tokens
  - account deletion disconnects Google
  - post delete and legacy citation routes check organization access
- **Logging (S21, S30):** 68 `console.*` calls → logger without payloads; no super-admin password in the seed log; query-value redaction.
- **Closed:** S11 / S12 / S29 (Search Console gone), S18, S20; S13 code done (the credential rotation stays on Mohit's list).

**Found on the way:**
- The admin forgot-password token could never work (signed with a different key than it was checked with).
- `verifyToken` turned bad signatures into 500s.
- The OTP model reset its expiry on every save.

All three are fixed.

**Files touched (out of scope, security items only, as approved for Phase 10):**
- **routes:** roles, business categories, subscription, payments, supports, contact-us, blog, blog categories, FAQs, citation, system, white-label
- **services:** subscription / PayPal / payment (webhook verification, logging), citation middleware, admin services
- **shared:** `app.ts`, `configs/{multer,morgan,corsConfigs,config,mongoMigrate}.ts`, `utils/errorHandler.ts`

**Deploy (OPERATIONS.md):**
- rotate `JWT_SECRET` (≥ 32 characters; users sign in again once)
- new `ADMIN_JWT_SECRET` (admins sign in again), `PAYPAL_WEBHOOK_ID`, `TRUST_PROXY_HOPS=1`, `ACCESSDOMAINS` complete
- delete the old `ANALYTICS` token rows; check the `roles` collection

**Tests:** 734 pass (was 646), no key, no network; build 0 errors; lint 32.

**Dev server:**
- user dashboard / reports / usage 200
- admin routes 401 without a token
- traversal 404, bad token 401, operator key 400, oversize body 413
- no wildcard CORS, strict CSP, HSTS
- 0 Google calls

**API calls consumed:** 0.

## On `claude/rebuild` after the Phase 10 merge (2026-09-27)

Phase 10 was merged as `3c776fd` and pushed by Mohit. Follow-ups, committed on `claude/rebuild`:
- **Phase 16 is part of M5** (Mohit): the Citation Report is one of the four mandatory reports, and the admin team needs time to build the directory list. Roadmap (CLAUDE.md, STATUS.md): M5 = 12 + 12.5 + 10 + 8.1 + 16 + 13 + 14 + pre-launch live validation + Google approvals. Phase 8.1 (email verification by link) was added before 16.
- **Frontend notes** (FRONTEND_BACKEND_MAP.md "Notes for the frontend team"; API.md "Session tokens and refresh"):
  - access tokens last 1 day and refresh tokens 30 days (`JWT_REFRESH_EXPIRATION_DAYS`), with the refresh flow and its errors
  - the admin panel signs in via `/admin/auth/login`, with every guarded route and its permission listed
  - the frontend origins must be in `ACCESSDOMAINS`
- **DataForSEO fully removed (2026-09-27).**
  - There was nothing left in code, config, `.env.example`, tests or fixtures (the code went in 9a, the env vars earlier). The local `.env` had no DATAFORSEO lines, so nothing needed removing.
  - The remaining docs mentions (CLAUDE.md, AUDIT, FRONTEND_BACKEND_MAP, LEGACY_FEATURES, MIGRATION, PRODUCT, STATUS) now read "keyword search-volume vendor (removed 2026-09-27)" or similar.
  - Outside this history file, the only remaining mention is Mohit's STATUS item: "DataForSEO password change by the account owner (old credential in git history)".
- **Pending on Mohit's side** (STATUS.md open items): the price check, the quota check, the Dallas test + formal `calibrate:score`, the Google approvals (GBP API access, v4, app verification).

## Phase 8.1: Email verification by link

Branch `claude/phase-8.1-email-verify` (from `claude/rebuild` at `e9c36ee`). Spec and decisions: CLAUDE.md §12g. Offline; 0 Google calls.

**What changed:**
- **Signup** emails `FRONTEND_URL/verify-email?token=…` instead of a 6-digit code.
  - The token is 32 random bytes, stored as a SHA-256 hash in `auth_codes` (purpose `verify_email`, one row per user), single use.
  - The link expires at the account's deadline: signup + `EMAIL_VERIFICATION_TTL_HOURS` (24).
  - A signup response includes `verify_before`.
- **`POST /auth/verify-email { token }`:**
  - the first time, it verifies and returns the session
  - a second click: 200 `{ verified: true, already_verified: true }`, no tokens (a used link row is kept 7 days)
  - otherwise 400 `link_expired` / `link_invalid`
- **`POST /auth/resend-verification { email }`** (replaces `/auth/verify-email/resend`): 3/h per email, 10/h per IP. It always gives the same answer, and a new link replaces the old one.
- **Login** (new and legacy) refuses unverified accounts after the password check: 403 `{ reason: "email_not_verified", resend }`, with no tokens.
- **User fields:** `email_verified_at` (the truth for "verified"; verifying also sets status `ACCEPTED`) and `verification_deadline` (set only by the 8.1 signup, cleared on verify).
- **`unverified-cleanup` job**, hourly and cluster-safe. It deletes signups past their deadline with:
  - their profile, codes, tokens, legacy OTPs and memberships, and the invitations they sent
  - owned organizations with no other members and no locations, with their invitations and clients

  Organizations with other members or locations are kept. It logs counts only.
- **Signup** with the email of an expired unverified account deletes it first, so the address is free at once.
- **Invitations:** accepting one verifies the email (new accounts are created verified; existing unverified ones are marked). Password reset also verifies.
- **Migration** `npm run migrate:email-verified`: existing users → verified, `PENDING` / `REVIEWING` → `ACCEPTED`. It also creates the `users` indexes. Deploy checklist step 12, **before** the new code starts.
- **Legacy:**
  - `POST /user/auth/register` removed (the rebuilt app uses `/auth/signup`; nothing else needs it)
  - `/user/auth/otp` and `/verify-otp` take `FORGOT_PASSWORD` only (`verification_by_link` otherwise)
  - legacy login gives 403 `email_not_verified` and sends no code
  - employee add creates verified accounts
- **Development:** no email; the link is logged with the email masked (`p***@example.com`).
- **Removed:** the verify-email code path, `sendEmailVerification` and its OTP HTML template (`src/constants/sendEmailVerificationFormat.ts`, a shared-constants edit).

**Tests:** `tests/routes/emailVerification.routes.test.ts`:
- signup → login refused → verify → login OK
- already verified; expired, wrong and malformed tokens
- resend invalidates the old link and answers the same for anyone; the rate limit
- development logging
- cleanup: only unverified signups past 24 h and their empty organizations; an organization with another member is kept; never verified, invited or legacy users; idempotent; the email can sign up again
- expired-email signup; invitations verify; the migration; the legacy routes

`org.routes.test.ts` was moved to the link flow.

**Docs:** ENDPOINTS.md (rows 29–31, legacy rows, register removed), API.md (the `/verify-email` page flow and codes), FRONTEND_BACKEND_MAP.md (Signup, `/verify-email`), OPERATIONS.md (deploy step 12), `.env.example` (`EMAIL_VERIFICATION_TTL_HOURS`, `FRONTEND_URL`), CLAUDE.md §12g + roadmap, STATUS.

**API calls:** none.

## Sanitation pass on `claude/rebuild` (2026-09-27, after the Phase 8.1 merge)

Mohit saw red lines in `tsconfig.json`, `tests/tsconfig.json`, `app.ts`, `server.ts` and other files.

**Causes:**
- **Editor TypeScript:** VS Code uses its bundled TypeScript 6.0.3; the project builds with 5.9.3.
  - With the unchanged configs, TS 6 reported config errors: `moduleResolution=node10` deprecated, and `tests/tsconfig.json` files outside the new default `rootDir` (22).
  - With those silenced it reported **627 file diagnostics**, from its new defaults (`strict` on): 514 `catch` variables typed `unknown`, implicit `any`, and the missing luxon types.
  - The build and `npm test` (5.9.3) were clean.
- **ESLint scope:** `npm run lint` used an unquoted `src/**/*.ts`, which `sh` expands one level deep. It linted **159 of 365** files, so the "32" baseline in earlier phase summaries under-counted. The real count was 172 in `src/` (all legacy) plus 11 in the rebuild's tests.

**Fixes:**
- `.vscode/settings.json` (newly tracked; `.gitignore` un-ignores only that file) points VS Code at the workspace TypeScript.
- `tsconfig.json` states `strict: false` and `rootDir: "."`; `tests/tsconfig.json` states `rootDir: ".."`. These are the values 5.9.3 already used, so the build output is unchanged. TS 6 now reports 0 file errors and only the `moduleResolution` deprecation.
- The lint scripts quote their globs and cover `src`, `tests` and `index.ts`. The new baseline is **169, all legacy**; the rebuilt modules and tests have 0.
- The 11 test lint errors are fixed: `Reflect.deleteProperty` for env cleanup, the correct `no-var-requires` disable, typed `jest.fn` generics, an interface, and no unused destructuring.
- Three imports left unused by Phase 8.1's removal of the legacy register validator are removed from `src/middlewares/auth/auth.middlware.ts`.

**Checks:**
- `npm run build`: 0 errors. Tests type-check: 0. `npm test`: 76 suites, 743 tests passed.
- Dev-server boot: healthcheck 200, user and admin routes without a token 401, public reference 200, all 10 jobs defined, 3 recurring jobs scheduled, no error logs other than the expected 401 request lines. All three dev processes stopped.
- No Google calls.

**Left for later:** the TypeScript 7 migration (OPERATIONS.md "Lint and editor setup"; STATUS backlog).

## Pause point (2026-09-27)

Mohit paused the work: "we will get back to citation and other stuff later on". The context was brought up to date so the work can resume cleanly.

**New docs:**
- [PROJECT_SUMMARY.md](PROJECT_SUMMARY.md): the entry point after a break. It has the reading order, a quick self-check, numbers, what was built per phase, what works (offline and live), what doesn't or isn't verified, the remaining roadmap, Mohit's pending items, an architecture overview and the key decisions.
- [plans/phase-16-citations.md](plans/phase-16-citations.md): the approved Phase 16 plan, copied into the repo so it isn't only in a local session file. Status header: approved, build paused, how to resume.
- [plans/README.md](plans/README.md): an index of approved but unbuilt plans.

**Updated:**
- **STATUS.md:** the pause, Phase 16 paused, done-so-far (8.1, sanitation, tests 743, lint 169 legacy, 208 endpoints, the 12.5 sampling line), decisions (8.1, Phase 16 plan and pause, tooling), next up (Mohit picks among 16 / 13 / 14), the index of where facts live.
- **CLAUDE.md:** the session-start reading order (STATUS → PROJECT_SUMMARY → CLAUDE), roadmap row 16 paused, the phase-order paragraph, the §12f pointer to the plan, Phase 10 / 8.1 marked done with their merge hashes, and a repository-map entry for security, auth and tooling.
- **ENDPOINTS.md:** a summary block (208 endpoints by status, origin and auth; coming changes), the legacy citation routes marked "to be retired in Phase 16", and the Phase 8.1 removals listed.
- **FRONTEND_BACKEND_MAP.md:** the status line (2026-09-27). **PRODUCT.md:** the module table, the reports paragraph and the phase map. **OPERATIONS.md:** email verification by link (auth codes are now for password reset only).

**Checks:** `npm run check:endpoints` passes; docs only, no code changes. **API calls:** none.

## Phase 16: Citations (manual, admin-managed tracking)

Branch `claude/phase-16-citations` (from `claude/rebuild` at `c921dc2`). Plan: [plans/phase-16-citations.md](plans/phase-16-citations.md), approved 2026-09-27. Plan choices were re-confirmed on resume: retire the legacy module and `serpapi`, keep the order model renamed, add `citations.view`, the score defaults, and csv-parse / csv-stringify. Offline: **0 Google calls**.

**Commits:**
- `a9c3033`: Phase 16 in progress; Phase 13 notes (CLAUDE.md §12h: the admin panel backend for launch; the legacy citation order model).
- `289e772`: the legacy `/citation/*` module retired.
  - Removed: 13 routes, the controller, middleware and service (805 lines, including its old-Places-API `place/details` call with our key), the SerpAPI helper, 5 models, unused constants, and `serpapi`.
  - The order model became `LegacyLocationCitation` (collection `locationCitations`) for `payment.middleware` / `payment.service` (a minimal payments edit, flagged).
- `5ea02a9`: models and the pure layer.
  - Models `Directory`, `DirectoryCategory`, `LocationCitation`, `CitationStatusLog`.
  - `src/citations/`: constants, US / CA regions, matching, Citation Health + `scoring.config.ts`.
  - `src/utils/nap.ts`: the NAP helpers moved from the GBP audit section, plus address comparison.
  - The worked example is tested: 50 D, then 66 C after one NAP fix.
- `5df11a8`: the admin master list and categories.
  - Directory CRUD and category groups mapped to the GBP business categories, plus a business-category search.
  - CSV import (all-or-nothing, dry run, upsert by domain, per-row errors) and export (BOM, formula-safe).
  - The `citations.view` permission; `csv-parse` + `csv-stringify`. ENDPOINTS #82–#93.
- `2a59c90`: per-location lists and the queue.
  - Suggestions by country, region and category group, also at onboarding completion. They never remove anything or re-add a removed entry.
  - Entries: manual add; checks with a server-side NAP mismatch and 409 `nap_mismatch` unless `confirm`; bulk (request order); remove / restore; history.
  - The work queue: unchecked, stale (`CITATION_STALE_DAYS` 90), recent; filtered by organization, client, status, directory and type; deleted locations excluded.
  - `Location.summary.citation_*`. ENDPOINTS #94–#104.
- `7e47b19`: the customer side.
  - `GET /locations/:id/citations[/changes]`, read-only: problems first; NAP issues found vs expected; "MyPageSEO team" in place of admin names; internal notes hidden.
  - The dashboard `citations` block, agency portfolio and table fields, and the actions `citations:nap_wrong` / `citations:not_found`.
  - Organization-access tests (S15 moved here). ENDPOINTS #105–#106.
- `02d2519`: the Citation Report (type `citation`: score, table, NAP issues, changes in range) and a Citations part in the Full report; schedules of type `citation`.
- `263539c`: the starter master list and demo data.
  - The starter list (`src/scripts/data/`): 5 category groups, 50 US / CA directories with placeholder authority values. `npm run seed:citation-directories` is idempotent and loads the GBP category dump when that collection is empty.
  - `seed:demo-orgs`: citation lists with 60 days of history, plus a Citation Report.
  - `db:sync-indexes` and `summaries:rebuild` now cover citations; the OPERATIONS deploy step is added.
- (this commit): the end-of-phase docs.

**Checks:**
- **Tests:** `npm test` gives **84 suites, 800 tests**, offline (was 76 / 743). The admin guard matrix covers all 23 new `admin (citations.*)` rows. `check:endpoints` passes.
- **Build and lint:** build 0 errors. Lint **137** (was 169; the retired legacy files took 32), **0 in new code and tests**.
- **Seed:** 50 directories and 5 categories on local `mps_rebuild`; a second run left everything unchanged.
- **Dev server** with a temporary local admin (removed afterwards; token never printed):
  - directories 50, categories with counts, export → dry-run import 50 unchanged
  - queues filled from the demo data; location view 57 (C)
  - `live_correct` with a wrong phone → 409 `nap_mismatch`; a status update works
  - bad token → 401, legacy `/citation/tracker` → 404, 0 Google calls; dev processes stopped
- **Demo data:** `seed:demo-orgs` re-run to restore it (88 listings, 70 checked; 7 reports including a Citation Report).

**Endpoints:** 208 → 220. The 13 legacy routes were removed; 23 admin routes and 2 customer routes were added; `/reports` gained type `citation`.

**Decisions and flags:**
- **Shared-file edits** (minimal):
  - `payment.middleware.ts` (the model rename)
  - `constantTypes.ts` / `constants/selectFields.ts` (unused citation constants removed)
  - `onboarding.service.ts` (the suggestion hook)
  - `dashboard` (the citations block)
  - `seedDemoOrgs.ts`, `syncIndexes.ts`, `rebuildSummaries.ts`
- **Reference-data edit:** `seed:citation-directories` loads `dumps/businessCategory.json` only when that collection is empty (the same insert as `mongo-migrate`).
- **Open for Mohit / the admin team:**
  - the starter list's authority values are placeholders
  - the Citation Health weights (`scoring.config.ts`) are the approved defaults, tunable later
  - Phase 13 decides whether the legacy citation credits survive

**API calls:** none.
