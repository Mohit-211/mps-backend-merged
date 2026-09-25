# Progress log

One entry per phase, newest at the bottom. Every commit is listed with its hash. The finding IDs (S*, C*) refer to [AUDIT.md](AUDIT.md), and each finding's `Status` there is the source of truth for what is done and what is pending.

## Tracker

| Phase | Branch | State |
|---|---|---|
| 1: Full codebase audit | `claude/phase-1.5-hygiene` (commit `5e8bdf2`) | Done. Awaiting approval. |
| 1.5: Repo hygiene | `claude/phase-1.5-hygiene` | Done. Awaiting approval. One item on hold (PayPal SDK). |
| 2: Security hardening | — | Not started (gated, needs explicit approval and an item list) |
| 3: Foundations | — | Not started |
| 4: Ranking engine | — | Not started |
| 5: Ranking reports | — | Not started |
| 6: GBP connection fixes | — | Not started |
| 7: GBP data sync and report | — | Not started |
| 8: GBP posting | — | Not started |
| 9: Cleanup and docs | — | Not started |

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
- `project-tree.txt` still lists deleted files. It is a static listing and was not edited.

### Open questions for Mohit
1. **`@paypal/checkout-server-sdk`:** `configs/paypal.ts` imports it to build `client`, but nothing uses `client`; `paypal.service.ts` imports only `BASE_URL`. Option: reduce `configs/paypal.ts` to the `BASE_URL` export and remove the package. That touches a payments file, which is out of scope. Awaiting your answer.
2. Carried over from Phase 1: rotate the DataForSEO credential (S13), and check the production `JWT_SECRET` format (S19).

### One-time setup for every developer after pulling

```sh
git config blame.ignoreRevsFile .git-blame-ignore-revs
git config core.autocrlf input
```

If your working copy still has CRLF files from before this change, refresh it once. This deletes uncommitted changes to tracked files, so commit or stash first:

```sh
git rm -rq --cached . && git reset -q --hard
```
