# Project summary: the MyPageSEO backend rebuild

_Snapshot updated 2026-09-29 at the end of Phase 13b (built on `claude/phase-13b-admin`, awaiting merge; 13a merged and pushed). First written at the planned pause earlier that day. Read this first when you circle back, then [STATUS.md](STATUS.md) for the live state and [CLAUDE.md](../CLAUDE.md) for the rules. Update this file whenever a phase finishes or the picture changes._

## 1. Where to start when you come back

1. **This file:** the big picture, what works, what doesn't, and what's left.
2. **[STATUS.md](STATUS.md):** the phase table, open items for Mohit, what's blocked on Google, the Maps ToS risk register, and the next step.
3. **[CLAUDE.md](../CLAUDE.md):** the rules (scope, git, safety, quality gates) and every phase spec with "as built" notes.
4. **[plans/](plans/):** plans. [plans/phase-13-billing-admin.md](plans/phase-13-billing-admin.md) is built (13a + 13b). [plans/upcoming-features.md](plans/upcoming-features.md) is the groundwork for four features whose specs are pending (AI GBP posts, AI visibility, review management, white-label hosting).
5. **[PROGRESS.md](PROGRESS.md):** the detailed history, commit by commit.

**Reference docs:**
- [ENDPOINTS.md](ENDPOINTS.md): every current endpoint, checked by `npm run check:endpoints`
- [API.md](API.md): request / response examples
- [FRONTEND_BACKEND_MAP.md](FRONTEND_BACKEND_MAP.md): what the frontend may build
- [FLOWS.md](FLOWS.md): the core flows as API call sequences (tested end to end)
- [OPERATIONS.md](OPERATIONS.md): how to run, the deploy checklist, costs
- [AUDIT.md](AUDIT.md): security and correctness findings with status
- [CHANGELOG.md](CHANGELOG.md): methodology changes (for chart markers)
- [GBP_CONNECT.md](GBP_CONNECT.md), [LIVE_TEST.md](LIVE_TEST.md), [LEGACY_FEATURES.md](LEGACY_FEATURES.md), [MIGRATION.md](MIGRATION.md), [PRODUCT.md](PRODUCT.md), [calibration/](calibration/)

**Quick check after a break** (all offline, no Google calls):
```sh
git checkout claude/rebuild && git pull
npm ci
npm run build          # expect 0 TypeScript errors
npm test               # expect 99 suites, 903 tests, all passing (includes check:endpoints and the flow tests)
npm run lint           # expect 40 errors, all in legacy GBP posting (0 in rebuilt code and tests)
npm run seed:demo-orgs # demo Business + Agency organizations, reports, dashboards (local mps_rebuild only)
npm run dev            # then GET /api/healthcheck → 200; stop all three processes (cross-env, nodemon, ts-node) afterwards
```

In VS Code, use the workspace TypeScript: run "TypeScript: Select TypeScript Version" → "Use Workspace Version". See [OPERATIONS.md](OPERATIONS.md), "Lint and editor setup".

## 2. Numbers at this snapshot (2026-09-29)

| Item | Value |
|---|---|
| Branch | `claude/rebuild` (everything through Phase 13a merged and pushed); Phase 13b on `claude/phase-13b-admin` awaiting merge; `main` untouched at `62240ac` |
| Commits since `main` | 193 (including 13b) |
| Source | ~37,100 lines of TypeScript in `src/` (384 files; 13b removed ~5,900 net), 54 model files |
| Tests | 99 suites, **903 tests**, offline (no API key, no network; one in-memory MongoDB per run; Google and PayPal faked) |
| Build | 0 TypeScript errors (TypeScript 5.9.3) |
| Lint | 40 errors, **all in legacy GBP posting** (Phase 9); 0 in the rebuilt code and tests |
| Endpoints | **225**: 224 live, 1 dev-only, 0 deprecated; 190 rebuilt or new, 35 legacy (reference data, blog, FAQ, contact form, GBP posting, health checks); auth: 97 user, 92 admin, 36 none |
| Background jobs | 12: `post-to-gbp`, `rank-run`, `gbp-sync`, `gbp-report`, `monthly-refresh`, `report-generate`, `report-email`, `report-schedule-dispatch`, `report-retention`, `unverified-cleanup`, `billing-renewals`, `billing-reminders` |
| Live Google calls so far | Places: Phase 5.5 validation (106 IDs-only, 7 Pro, 3 Details) and the variance test (at least 180 IDs-only, 0 Pro). GBP: 1 OAuth exchange + 1 `accounts.list` (429, quota 0). PayPal: none yet |

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
| 16 | Citations: directory master list (CSV), category groups, per-location lists with suggestions and NAP checks, admin work queue, customer dashboard, Citation Health, Citation Report; legacy citation module and `serpapi` retired | `daff461` |
| 13a | Billing: first + (n − 1) × additional location pricing with dated prices (USD / CAD), 20-location cap, 7-day trial then read-only, prorated location slots, tokens for manual refreshes (with refunds), PayPal subscriptions (price override, renewal snapshot 11 days ahead) and one-time orders, numbered PDF invoices, manual (invoice) billing, billing admin with audit log; Square, credits and the guest checkout retired | `2c77a8a` |
| 13b | Legacy removal (65 routes; no deprecated routes; fresh database with `setup:fresh`, no migrations); `/auth` sessions and account; Google connect under `/gbp`; password reset by link for users and admins (no OTP); one email switch (`EMAIL_TRANSPORT`); the payment-provider interface; flaky tests fixed; end-to-end flow tests + FLOWS.md; admin panel (overview, users, organizations, admin accounts) + support tickets | awaiting merge |
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
- **Auth:** `/auth` with link verification, the login gate, resend, cleanup job; password reset **by link** (users and admins; no OTP anywhere); sessions (refresh rotation, logout, change password, me, deactivate); admin auth with permissions, admin accounts with a set-password link.
- **Core flows end to end** (13b, `tests/flows`): Business signup → first report; Agency clients and locations (Places and GBP), reassign / unassign, client averages; a client_user's isolation and read-only access; trial → subscription → paid slot → user limit → read-only after the trial.
- **Admin panel and support** (13b): overview, users (disable, sign out, verify), organizations (suspend, trial, limit overrides), support tickets with threads and internal notes.
- **Email:** one switch (`EMAIL_TRANSPORT=smtp|log`) for every email type.
- **Reports center:** create → snapshot → PDF → download / email / share / schedule / retention; white-label branding.
- **Billing (Phase 13a), with PayPal faked:** gates (402 / 403 reasons), checkout → activation → payment → invoice PDF, replayed webhooks, the renewal snapshot and PATCH, location slots (quote → order → capture, idempotent), manual billing (invoices, recorded payments, overdue → read-only), tokens (spend, refund on failure, packs with coupons, refund of a pack), reminders, the billing admin. Also checked on the dev server with the demo data. **Not verified live:** no PayPal sandbox run yet.
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
| **Citations** | **Merged (Phase 16), offline only.** The starter directory list has placeholder authority values; the real list is the admin team's work. The legacy module is gone. | Merge + deploy (`db:sync-indexes`, `seed:citation-directories`); the admin team curates the list and starts checking listings. |
| **Billing / plans** | **Merged (13a), offline only**: PayPal is faked in every test; no sandbox run yet. No prices are set (checkout answers 409 `price_not_set`). | Deploy (`setup:fresh`); Mohit sets prices, packs and token costs; PayPal sandbox credentials → `billing:paypal-setup` + webhook → the sandbox test. |
| **Admin panel / support** | **Built (13b), offline only.** | Merge; the admin panel frontend. |
| **GBP posting** | Legacy flow (`gbpPostSchedular`, `post-to-gbp` job) using v4; not rebuilt | Phase 9, needs v4 access. |
| **Legacy routes** | None deprecated. Still legacy code: reference data, blog, FAQ, contact form (kept by decision) and GBP posting (Phase 9) | STATUS.md "What remains legacy". |
| **Production** | Never deployed from the rebuild | Phase 14 (fresh server, backups, nginx, pm2, monitoring) + the deploy checklist in OPERATIONS.md. |
| **Docs debt** | `ARCHITECTURE.md` not written (Swagger removed in 13b) | 9b. ENDPOINTS.md + API.md are current and are the reference until then. |
| **Tooling** | `moduleResolution: node` is removed in TypeScript 7; 40 legacy lint errors (GBP posting) | OPERATIONS.md "Lint and editor setup"; STATUS.md backlog. |
| **Maps ToS** | Accepted risk: names, competitor data and reports store Places content (with attribution) | Revisit before launch (STATUS.md "Maps ToS: accepted risk"). |

## 7. What's left (roadmap)

**M5 = launch-ready** = 12 ✔ + 12.5 ✔ + 10 ✔ + 8.1 ✔ + 16 ✔ + **13** (13a ✔, 13b built) + **14**, plus the pre-launch live validation and the Google approvals.

| Next phases | Scope | State |
|---|---|---|
| **13b** | Legacy removal, `/auth`, password links, email switch, flows, admin panel + support (CLAUDE.md §12h) | **Built, awaiting merge** |
| **14 Production readiness** | Fresh server (Mongo, backups, nginx, pm2, log rotation, monitoring, alerts), deploy-checklist dry run with `setup:fresh`, Maps ToS decision | **Next** (plan mode) |
| AI GBP posts · AI visibility · Review management · White-label hosting | Groundwork: [plans/upcoming-features.md](plans/upcoming-features.md) | Planned, spec pending |
| 9 GBP reviews & posting | Rebuild posting on `gbpClient`, AI review replies | Blocked on v4 |
| 15 Notifications & automations | – | Planned |
| 17 Ranking extras | Keyword groups, larger grids | Planned |
| 9b Cleanup | ARCHITECTURE.md, final docs pass, TypeScript 7 move | Ongoing |

**Before starting any phase:** the spec goes in CLAUDE.md, then plan mode and Mohit's approval, then a branch `claude/phase-<n>-<slug>` from `claude/rebuild`. At the end: docs, the merge command, and the push command. Mohit runs them unless he asks otherwise.

## 8. Pending on Mohit's side

Also in STATUS.md, "Open items":
- **Google:** GBP API access request, v4 access, OAuth app verification; Authorised JavaScript origins on the OAuth client.
- **Cost / quota:** check `src/configs/pricing.ts` against Google's price list; confirm the Places quota is at least 600 requests/minute; budget alerts.
- **Live validation:** the Dallas test + a formal `calibrate:score`.
- **Billing:** prices (first / additional location per currency), token packs and token costs in the billing admin; PayPal sandbox credentials, `billing:paypal-setup`, the webhook, then the sandbox test; invoice seller details (`BILLING_SELLER_*`).
- **Credentials:** the DataForSEO password change by the account owner (the old credential is in git history).
- **Deploy-time** (OPERATIONS.md deploy checklist):
  - rotate `JWT_SECRET` (at least 32 characters); set `ADMIN_JWT_SECRET`, `PAYPAL_WEBHOOK_ID`, `ACCESSDOMAINS`, `FRONTEND_URL`, `ADMIN_FRONTEND_URL`, `SHARE_BASE_URL`, `SUPPORT_EMAIL` and `EMAIL_TRANSPORT=smtp`
  - the Google Cloud redirect URI → `…/api/v1/gbp/connect/callback` (13b)
  - a fresh database: `npm run setup:fresh -- --confirm` (nothing is migrated from the old system)
  - the PayPal / billing variables; remove `SQUARE_*`
- **Frontend:** build against FRONTEND_BACKEND_MAP.md (its "Notes for the frontend team") and FLOWS.md (the call sequences); the `/verify-email` and `/reset-password` pages are in API.md.
- **Decide:** the checkout quantity (STATUS open item 15); specs for the four upcoming features.

## 9. Architecture at a glance

- **Layering:** routes → middlewares → controllers → services → helpers / clients → models (Express + Mongoose 8, TypeScript, pm2 cluster). Jobs run on agenda (Mongo-locked; never node-cron).
- **Rebuilt code:**
  - `src/ranking/`: the engine, pure
  - `src/gbp/`: sync executor, mappers, scoring, report
  - `src/clients/`: Places, GBP, HTTP, the Places rate limiter
  - `src/services/`:
    - `ranking`, `refresh`, `gbp`, `onboarding`, `locations`, `org`, `clients`
    - `dashboard`, `team`, `reports`, `usage`
    - `auth` (`emailVerification`, `links`, `session.service`), `admin` (`adminToken`, `adminAuth`, `users`, `organizations`, `overview`), `support`, `setup` (fresh database), `citations` (Phase 16), `billing` (Phase 13a; `providers/` since 13b)
    - `common/email.service.ts`: every email through `deliver()` and `EMAIL_TRANSPORT`
  - `src/citations/`: citation matching and Citation Health, pure (`scoring.config.ts`)
  - `src/billing/`: pricing and entitlement, pure; `src/clients/paypalClient.ts`
  - `src/jobs/`: the 12 jobs above
  - `src/configs/`: `config`, `adminPermissions`, `pricing`, `multer`, `corsConfigs`
- **Legacy code still in place:** GBP posting (Phase 9), blog, FAQ, contact form, reference data. Guarded and hardened, not rebuilt (STATUS.md "What remains legacy").
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
- **Billing:** first + (n − 1) × additional location, 20-location cap (enterprise above), prices dated and applied at each organization's next renewal, tokens for manual refreshes, PayPal price override patched 11 days before renewal, no tax, coupons on token packs only.
- **Fresh database, delete don't deprecate (2026-09-28):** no data is migrated from the old system (`setup:fresh`); anything the rebuilt product doesn't use is deleted, not deprecated.
- **Links, not codes (2026-09-29):** email verification and password resets are one-time links; no OTP anywhere. One email switch (`EMAIL_TRANSPORT`).
