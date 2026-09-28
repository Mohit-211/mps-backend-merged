# Project summary: the MyPageSEO backend rebuild

_Snapshot updated 2026-09-27 at the end of Phase 16 (citations built on `claude/phase-16-citations`, awaiting merge). First written at the planned pause earlier that day. Read this first when you circle back, then [STATUS.md](STATUS.md) for the live state and [CLAUDE.md](../CLAUDE.md) for the rules. Update this file whenever a phase finishes or the picture changes._

## 1. Where to start when you come back

1. **This file:** the big picture, what works, what doesn't, and what's left.
2. **[STATUS.md](STATUS.md):** the phase table, open items for Mohit, what's blocked on Google, the Maps ToS risk register, and the next step.
3. **[CLAUDE.md](../CLAUDE.md):** the rules (scope, git, safety, quality gates) and every phase spec with "as built" notes.
4. **[plans/](plans/):** approved plans not built yet. Today that is only [plans/phase-16-citations.md](plans/phase-16-citations.md).
5. **[PROGRESS.md](PROGRESS.md):** the detailed history, commit by commit.

**Reference docs:**
- [ENDPOINTS.md](ENDPOINTS.md): every current endpoint, checked by `npm run check:endpoints`
- [API.md](API.md): request / response examples
- [FRONTEND_BACKEND_MAP.md](FRONTEND_BACKEND_MAP.md): what the frontend may build
- [OPERATIONS.md](OPERATIONS.md): how to run, the deploy checklist, costs
- [AUDIT.md](AUDIT.md): security and correctness findings with status
- [CHANGELOG.md](CHANGELOG.md): methodology changes (for chart markers)
- [GBP_CONNECT.md](GBP_CONNECT.md), [LIVE_TEST.md](LIVE_TEST.md), [LEGACY_FEATURES.md](LEGACY_FEATURES.md), [MIGRATION.md](MIGRATION.md), [PRODUCT.md](PRODUCT.md), [calibration/](calibration/)

**Quick check after a break** (all offline, no Google calls):
```sh
git checkout claude/rebuild && git pull
npm ci
npm run build          # expect 0 TypeScript errors
npm test               # expect 84 suites, 800 tests, all passing (includes check:endpoints)
npm run lint           # expect 137 errors, all in legacy modules (0 in rebuilt code and tests)
npm run seed:demo-orgs # demo Business + Agency organizations, reports, dashboards (local mps_rebuild only)
npm run dev            # then GET /api/healthcheck → 200; stop all three processes (cross-env, nodemon, ts-node) afterwards
```

In VS Code, use the workspace TypeScript: run "TypeScript: Select TypeScript Version" → "Use Workspace Version". See [OPERATIONS.md](OPERATIONS.md), "Lint and editor setup".

## 2. Numbers at this snapshot (2026-09-27)

| Item | Value |
|---|---|
| Branch | `claude/rebuild` (everything through 8.1 merged and pushed); Phase 16 on `claude/phase-16-citations` awaiting merge; `main` untouched at `62240ac` |
| Commits since `main` | about 147 (including Phase 16) |
| Source | ~42,400 lines of TypeScript in `src/` (382 files), 55 model files (Phase 16 added 4 and deleted 6 legacy ones) |
| Tests | 84 suites, **800 tests**, offline (no API key, no network; in-memory MongoDB) |
| Build | 0 TypeScript errors (TypeScript 5.9.3) |
| Lint | 137 errors, **all in legacy modules**; 0 in the rebuilt code and tests |
| Endpoints | **220**: 205 live, 14 deprecated, 1 dev-only; 97 rebuilt or new, 123 legacy; auth: 97 user, 74 admin, 47 none, 2 refresh token |
| Background jobs | 10: `post-to-gbp`, `rank-run`, `gbp-sync`, `gbp-report`, `monthly-refresh`, `report-generate`, `report-email`, `report-schedule-dispatch`, `report-retention`, `unverified-cleanup` |
| Live Google calls so far | Places: Phase 5.5 validation (106 IDs-only, 7 Pro, 3 Details) and the variance test (at least 180 IDs-only, 0 Pro). GBP: 1 OAuth exchange + 1 `accounts.list` (429, quota 0) |

## 3. What the product is

A **local SEO platform for US and Canadian businesses and agencies**, about Google Maps / Google Business Profile visibility only. Website SEO, Q&A, SerpAPI, Moz and keyword-volume vendors are out.

The hierarchy is Organization → (agency) Clients → Locations → modules. Every location is one Google Maps business with a `place_id`, added via a GBP profile or a Places search, never by hand. Data refreshes **monthly** per location (plus a manual refresh at most once per 24 h per type).

The target screens are in [product/frontend-roadmap.pdf](product/frontend-roadmap.pdf). Screen-by-screen backend status is in [FRONTEND_BACKEND_MAP.md](FRONTEND_BACKEND_MAP.md).

## 4. What has been built (phase by phase)

| Phase | What it delivered | Merge |
|---|---|---|
| 1 / 1.5 / 1.6 | Audit (AUDIT.md, ROUTES.md), LF line endings, dead code and unused dependencies removed, 46 TypeScript errors fixed, `.env` via `ENV_FILE` | `e4a7419`, `53986e0` |
| 3 | Foundations: Joi config, the Places API (New) client with field-mask guards, agenda with its own connection, `defineJob`, the jest + in-memory Mongo harness | `53986e0` (M1) |
| 4 | Ranking engine (`src/ranking`): points, grids, rank cells, metrics and change rules (CLAUDE.md §4), a run cache, a pool, `estimateCalls` | `3da12ed` (M2) |
| 5 | Three ranking pages from one run: `RankRun`, the `rank-run` job, tracking settings, Rank Tracker / Grid / Map Ranking endpoints, `seed:rank-demo` | `2bb4cf8` (M2) |
| 5.5 | First live Places validation (Fredericton): an informal pass | `5735bad` |
| 6 | GBP connection: hashed one-time OAuth state, encrypted tokens, `gbpClient` (rate limit, retry, quota-0 detection), discovery, bind / unbind / disconnect, `gbp:preflight` | `4e4d556` |
| 7a | Google popup connect, several Google accounts per user, the onboarding flow, competitor suggestions, Places search, a daily Places cap | `1273e2b` |
| 9a | Legacy cleanup: old ranking, GBP audit, Reputation Manager, white-label links and Search Console removed (~7,300 lines) | `73e4fe9` |
| 7b | `gbp-sync` (performance, keywords, profile, verification; v4 behind a flag) and the monthly refresh scheduler with manual refresh | `e74b079` |
| 7c | GBP Score (5 pillars), Public Score, competitor comparison + insights, the `gbp-report` job, the GBP report endpoint | `fb5af9f` (M3) |
| 8 | Organizations, memberships and roles, new `/auth`, plan limits, the add-location flows, the locations list and overview, agency clients, onboarding state | `819dfd8` |
| 11 | Business and Agency dashboards (from stored summaries), team invitations and roles | `0786801` (M4) |
| 12 | Reports center: Rank Tracker, GBP Audit, Competitor and Full reports as frozen snapshots; PDFKit PDFs; email; share links `/r/:token`; monthly schedules; agency white-label | `3f1e192` |
| 12.5 | Ranking quality: full depth (60), 3 samples 60 s apart with median, stored result lists, Map Ranking at 5 points, richer competitor data, a usage ledger + `cost:report`, Google attribution | `c5aee43` |
| 10 | Security: admin auth + role permissions, every admin route guarded (tested from ENDPOINTS.md), helmet / CORS / body limits / upload limits, request sanitiser, PayPal webhook verification, revocable tokens, 1-day access tokens, log redaction | `3c776fd` |
| 8.1 | Email verification by link (24 h), login blocked until verified, resend, hourly cleanup of unverified signups, `migrate:email-verified`; legacy register removed | `604f8d6` |
| 16 | Citations: directory master list (CSV), category groups, per-location lists with suggestions and NAP checks, admin work queue, customer dashboard, Citation Health, Citation Report; legacy citation module and `serpapi` retired | awaiting merge |
| (hygiene) | Editor TypeScript pinned to the workspace version, explicit tsconfig defaults, lint script covering every file, test lint fixes | `c35e378`, `bec6772`, `f8c7447` |

**Also on `claude/rebuild` between phases:**
- Phase 16 joined M5.
- Frontend notes were written: token refresh, admin sign-in and permissions, CORS.
- DataForSEO was removed completely.
- Decisions were recorded (STATUS.md "Key decisions").

## 5. What works (verified)

**Verified offline** (tests + dev-server smoke runs):
- **Ranking:** tracking settings, rank runs (full depth, sampling, medians), the three ranking pages, history and change rules, dev caps, the 422 over-budget guard, the stuck-run guard, cluster-wide Places throttling, the usage ledger.
- **Refresh:** the monthly scheduler (per-location anchor day about 03:00 local), manual refresh with the 24 h guard.
- **GBP:** the connect flows (popup + redirect) and token storage (encrypted, rotation), bind / unbind / disconnect, the sync executor on fixtures (v4 on and off), GBP Score, Public Score, competitors, insights, the report endpoint. `seed:demo-orgs` shows every part.
- **Organizations and access:** Business / Agency signup, roles (owner / member / client_user read-only), plan limits, locations, clients, onboarding, dashboards, team invitations.
- **Auth:** new `/auth` with link verification, the login gate, resend, cleanup job, password reset; token refresh; admin auth with permissions.
- **Reports center:** create → snapshot → PDF → download / email / share / schedule / retention; white-label branding.
- **Citations (Phase 16):** admin CRUD + CSV round trip, suggestions (country / region / category group), NAP mismatch guard, bulk, history, the three queues, customer view (no admin names or notes), dashboard blocks, the Citation Report and the Full report part, the starter seed (50 directories) and demo lists. Also checked on the dev server with a temporary admin.
- **Security:** every admin-only route gives 401 / 403 correctly (a test driven by ENDPOINTS.md); traversal, operator keys, oversize bodies and bad tokens are all refused.

**Verified live** (real Google calls, on Mohit's go):
- **Places ranking:** the Fredericton validation. Ranks were close to Mohit's manual Maps checks (informal pass).
- **Variance test** (2026-09-27): 0 s gave 90 % identical ranks (max spread 2); 60 s gave 80 % identical (max spread 5). That decided 3 samples 60 s apart.
- **GBP popup connect** for `mohit@mypageseo.com`: tokens stored encrypted, id_token verified.

## 6. What doesn't work yet, or isn't verified

| Area | State | Why / what unblocks it |
|---|---|---|
| **GBP data (sync, private report sections, GBP Score on real data)** | Built, **never run live** | Google: Business Profile API quota is 0 for project `1010247538246`. Resume at `npm run gbp:preflight -- 6ab76e2c99cf66c2cc414a13` when Mohit says "GBP access approved". |
| **GBP reviews, media, posts (v4)** | Built behind `GBP_V4_ENABLED=false` | Google v4 access. Then flip the flag; no code change. |
| **Real customers connecting Google** | Blocked | OAuth app verification (`business.manage` is a sensitive scope). |
| **GBP Score / Public Score thresholds** | Starting values, uncalibrated | Needs real GBP data (the calibration steps are in PROGRESS.md, 7c). |
| **Ranking accuracy in a big market** | Only one small market checked (informal) | The Dallas test + a formal `calibrate:score` (pre-launch, Mohit triggers). |
| **Citations** | **Built (Phase 16), offline only.** The starter directory list has placeholder authority values; the real list is the admin team's work. The legacy module is gone. | Merge + deploy (`db:sync-indexes`, `seed:citation-directories`); the admin team curates the list and starts checking listings. |
| **Billing / plans** | Legacy Square / PayPal / credits code untouched (only security fixes in Phase 10). Plan limits read optional `location_limit` / `keyword_limit`. | Phase 13. |
| **GBP posting** | Legacy flow (`gbpPostSchedular`, `post-to-gbp` job) using v4; not rebuilt | Phase 9, needs v4 access. |
| **Deprecated routes** | 14 still registered: legacy `/user/auth/*` login / OTP / forgot, `/user/clients*`, legacy white-label | Removed once the frontend has fully moved (9b). |
| **Production** | Never deployed from the rebuild | Phase 14 (fresh server, backups, nginx, pm2, monitoring) + the deploy checklist in OPERATIONS.md. |
| **Docs debt** | `swagger.json` is stale; `ARCHITECTURE.md` not written | 9b. ENDPOINTS.md + API.md are current and are the reference until then. |
| **Tooling** | `moduleResolution: node` is removed in TypeScript 7; 137 legacy lint errors | OPERATIONS.md "Lint and editor setup"; STATUS.md backlog. |
| **Maps ToS** | Accepted risk: names, competitor data and reports store Places content (with attribution) | Revisit before launch (STATUS.md "Maps ToS: accepted risk"). |

## 7. What's left (roadmap)

**M5 = launch-ready** = 12 ✔ + 12.5 ✔ + 10 ✔ + 8.1 ✔ + 16 (built, awaiting merge) + **13** + **14**, plus the pre-launch live validation and the Google approvals.

| Next phases | Scope | State |
|---|---|---|
| **16 Citations** | Directory master list (CSV import / export), category groups, per-location lists with suggestions, status history, admin work queue, customer dashboard, Citation Health score, Citation Report; legacy citation module and `serpapi` retired | **Built, awaiting merge** |
| **13 Billing & plans** | Square / PayPal aligned with organizations, plan → limits, upgrade / downgrade, subscription-status gating, invoices; **plus the admin panel backend for launch** (users, organizations, subscriptions, support tickets); decide the future of citation credits (`LegacyLocationCitation`) | **Next, in plan mode** (notes in CLAUDE.md §12h) |
| **14 Production readiness** | Fresh server (Mongo, backups, nginx, pm2, log rotation, monitoring, alerts), deploy-checklist dry run, Maps ToS decision | Planned |
| 9 GBP reviews & posting | Rebuild posting on `gbpClient`, AI review replies | Blocked on v4 |
| 15 Notifications & automations | – | Planned |
| 17 Ranking extras | Keyword groups, larger grids | Planned |
| 9b Cleanup | swagger, ARCHITECTURE.md, final docs pass, remove deprecated routes, TypeScript 7 move | Ongoing |

**Before starting any phase:** the spec goes in CLAUDE.md, then plan mode and Mohit's approval, then a branch `claude/phase-<n>-<slug>` from `claude/rebuild`. At the end: docs, the merge command, and the push command. Mohit runs them unless he asks otherwise.

## 8. Pending on Mohit's side

Also in STATUS.md, "Open items":
- **Google:** GBP API access request, v4 access, OAuth app verification; Authorised JavaScript origins on the OAuth client.
- **Cost / quota:** check `src/configs/pricing.ts` against Google's price list; confirm the Places quota is at least 600 requests/minute; budget alerts.
- **Live validation:** the Dallas test + a formal `calibrate:score`.
- **Credentials:** the DataForSEO password change by the account owner (the old credential is in git history).
- **Deploy-time** (OPERATIONS.md deploy checklist):
  - rotate `JWT_SECRET` (at least 32 characters); set `ADMIN_JWT_SECRET`, `PAYPAL_WEBHOOK_ID`, `ACCESSDOMAINS`, `FRONTEND_URL` and `SHARE_BASE_URL`
  - run the migrations in order, including **`migrate:email-verified` before the new code starts**
  - delete the old `ANALYTICS` token rows
- **Frontend:** build against FRONTEND_BACKEND_MAP.md: its "Notes for the frontend team", and the `/verify-email` page flow in API.md.

## 9. Architecture at a glance

- **Layering:** routes → middlewares → controllers → services → helpers / clients → models (Express + Mongoose 8, TypeScript, pm2 cluster). Jobs run on agenda (Mongo-locked; never node-cron).
- **Rebuilt code:**
  - `src/ranking/`: the engine, pure
  - `src/gbp/`: sync executor, mappers, scoring, report
  - `src/clients/`: Places, GBP, HTTP, the Places rate limiter
  - `src/services/`:
    - `ranking`, `refresh`, `gbp`, `onboarding`, `locations`, `org`, `clients`
    - `dashboard`, `team`, `reports`, `usage`
    - `auth` (including `emailVerification`), `admin` (`adminToken`), `citations` (Phase 16)
  - `src/citations/`: citation matching and Citation Health, pure (`scoring.config.ts`)
  - `src/jobs/`: the 10 jobs above
  - `src/configs/`: `config`, `adminPermissions`, `pricing`, `multer`, `corsConfigs`
- **Legacy code still in place:** payments / subscriptions / PayPal / Square / credits (incl. the old citation *order* model `LegacyLocationCitation`, until Phase 13), white-label (deprecated), GBP posting, support, blog, FAQ, contact-us, reference data, legacy `/user/auth` and `/user/clients`, admin operations. Guarded and hardened, not rebuilt.
- **Access model:** organization membership (owner / member / client_user), never `created_by`. The current organization comes from `X-Organization-Id` or the default. Platform admins use a separate token and permission matrix.
- **Data rules:** no third-party fetch on a page view (jobs only). The monthly cadence per location. Snapshots for reports. The usage ledger for every Google call.

## 10. Key decisions

The full dated list is in STATUS.md "Key decisions". The ones that shape the future most:
- **Ranking:** Places API (New) Text Search, IDs-only (free) for ranks, max depth 60, `not_found` counts as 61. 3 samples 60 s apart, median. Map Ranking at 5 points.
- **Cost:** quality over cost; about $1 to $3 per monthly refresh per location is accepted.
- **Pushing:** after every merged phase (GitHub is the only off-machine backup).
- **Maps ToS:** accepted risk with "Google Maps" attribution; revisit before launch.
- **Security:** admin auth on permissions; access tokens last 1 day, refresh tokens 30 days.
- **Signup:** email verification by link; unverified signups are deleted after 24 h.
- **Citations:** manual and admin-managed; no external citation APIs.
