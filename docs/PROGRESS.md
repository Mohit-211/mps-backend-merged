# Progress log

One entry per phase, newest at the bottom. Every commit is listed with its hash. The finding IDs (S*, C*) refer to [AUDIT.md](AUDIT.md), and each finding's `Status` there is the source of truth for what is done and what is pending.

## Tracker

Phase order (Mohit, 2026-09-25): functionality first, security deferred. There is no Phase 2; it moved to Phase 10.

| Phase | Branch | State |
|---|---|---|
| 1: Full codebase audit | `claude/phase-1.5-hygiene` (commit `5e8bdf2`) | Done |
| 1.5: Repo hygiene | `claude/phase-1.5-hygiene` | Done and approved. **Merge into `claude/rebuild` and push are pending** (Mohit to run; see Phase 1.6 notes) |
| 1.6: Build green | `claude/phase-1.6-build-green` | Done except the local MongoDB (Docker not installed). Awaiting Mohit. |
| 3: Foundations | — | Next after 1.6 approval |
| 4: Ranking engine | — | Not started |
| 5: Ranking reports | — | Not started |
| 6: GBP connection fixes | — | Not started (includes signed OAuth state, encrypted tokens, C12) |
| 7: GBP data sync and report | — | Not started |
| 8: GBP posting | — | Not started |
| 9: Cleanup and docs | — | Not started |
| 10: Security hardening (gated) | — | Deferred; needs explicit approval |

Base branch: `claude/rebuild`, created from `main` @ `62240ac` with no commits of its own yet.

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
| — | this commit | This progress entry. |

### Checks (step f)

| Check | Result |
|---|---|
| `npm ci` from an empty `node_modules` | Passes (556 packages). |
| `npm run build` | **Passes, 0 TypeScript errors** (was 46). No `.env` copy step. |
| `npm run lint` | 99 errors vs 103 after Phase 1.5 and 115 at baseline. **No new errors:** no file/rule pair increased. The 4 fewer are in the reduced `configs/paypal.ts`. |
| `npm run dev` reads `./.env` | Yes. It read `PORT` from the file with nothing injected. `ENV_FILE` overrides it, and `node build/index.js` started from the repo root also reads `./.env`. `/api/healthcheck` returned 200 in all three. |
| DB connected and agenda started | **Not done: blocked.** Docker is not installed on this machine (none of Docker Desktop, OrbStack, Colima or Podman), so `mps-mongo` could not be started. Without a database, Mongo never connects and agenda never starts (agenda only starts after the Mongo `open` event). |

**API calls consumed:** 0.

### Decisions
- **`getKeywordMovmentData` (step a).** The strict rule is "behaviour-changing fixes are listed and skipped", but that would have left 2 errors and conflicted with "zero errors". The function is imported but never called anywhere, so the fix (use the client factory, the same pattern as its sibling `getLastFiveMonthPosition`) has no effect on the running app. It is dead code slated for deletion in Phase 9 (C11). **If you want the strict reading instead, revert this hunk and the 2 errors return.**
- **Step b:** nothing else needed a behaviour change, so the skip list is empty.
- **Finding ID:** the admin-JWT issue you called "S16" is already **S19** in AUDIT.md (S16 is the path traversal). I updated S19 instead of renumbering.
- **Local `.env`:** created from `.env.example` placeholders, with `PORT=5055` (macOS AirPlay uses 5000). It is gitignored and not committed.

### Blocked, needs Mohit
1. **Docker (step e).** Install Docker Desktop, or tell me to use a Homebrew MongoDB (`brew install mongodb-community@7.0`) instead. After that I will:
   - run `docker run -d --name mps-mongo -p 27017:27017 mongo:7`
   - create the `mps_db` user (the code always authenticates against `authSource: 'mps_db'`; see OPERATIONS.md)
   - point `.env` at it
   - re-run step f: DB connected, agenda started, `/api/healthcheck` 200.
2. **Merge and push for Phase 1.5.** The session's permission policy blocked both. Either run them yourself:
   ```sh
   git switch claude/rebuild
   git merge --no-ff claude/phase-1.5-hygiene -m "Phase 1.5 — repo hygiene"
   git push -u origin claude/rebuild claude/phase-1.5-hygiene
   ```
   or add a permission rule for `git merge` / `git push` to this project's Claude Code settings.
3. **Rotate the DataForSEO credential.** It is still in git history (S13), and that history is already on GitHub (`origin/main` = `62240ac`).

