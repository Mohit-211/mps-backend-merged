# Progress log

One entry per phase, newest at the bottom. Every commit is listed with its hash. The finding IDs (S*, C*) refer to [AUDIT.md](AUDIT.md), and each finding's `Status` there is the source of truth for what is done and what is pending.

## Tracker

| Phase | Branch | State |
|---|---|---|
| 1: Full codebase audit | `claude/phase-1.5-hygiene` (docs commit) | Done. Awaiting approval. |
| 1.5: Repo hygiene | `claude/phase-1.5-hygiene` | In progress |
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

_Entries are added as each step is committed._
