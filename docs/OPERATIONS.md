# Operations

How to configure, build and run the backend. Environment variables are listed, with a comment each, in [`.env.example`](../.env.example).

## Environment file

`src/configs/config.ts` loads environment variables once, at startup:

1. If `ENV_FILE` is set, it loads that file. The path can be absolute, or relative to the working directory.
2. Otherwise it loads `.env` from the **current working directory** (`process.cwd()`).

Variables already present in the process environment take precedence over the file (standard `dotenv` behaviour). A missing file is not an error. Joi validation then fails at startup if a required variable is absent.

**Always start the app with the repo root as the working directory**, or set `ENV_FILE`. The build no longer copies `.env` into `build/`.

## Local development

```sh
cp .env.example .env      # then fill in real test values
npm ci
npm run dev               # nodemon + ts-node, run from the repo root
```

`npm run dev` runs from the repo root, so it picks up `./.env`.

Checks:
- `GET /api/healthcheck` returns `{"response":"ok"}`.
- `GET /ping` returns 200.

### Local MongoDB

The rebuild uses its **own local database, `mps_rebuild`**, on a MongoDB server running on the developer's machine and bound to localhost only. It never connects to the production database, and the rebuild is free to change collections and indexes in it.

`src/configs/mongoConnection.ts` authenticates with `MONGODB_USER` / `MONGODB_PASSWORD` against `MONGODB_AUTH_SOURCE`, which is **required** (no default), so the app refuses to start without an explicit database. The old `mps_db` database is not used anywhere. Locally it is `mps_rebuild`. The server will get a fresh setup with a new database once the rebuild is done (Mohit, 2026-09-25).

**Default: Homebrew** (MongoDB Community 7.0, a brew service on `127.0.0.1:27017`):

```sh
brew tap mongodb/brew
# Homebrew 7 asks you to trust third-party formulae. The install reads these four:
brew trust --formula mongodb/brew/mongodb-community@7.0 mongodb/brew/mongodb-database-tools \
                     mongodb/brew/mongodb-enterprise mongodb/brew/mongodb-community
brew install mongodb-community@7.0
brew services start mongodb/brew/mongodb-community@7.0
mongosh mps_rebuild --quiet --eval \
  'db.createUser({user:"mps_local",pwd:"<local-db-password>",roles:[{role:"readWrite",db:"mps_rebuild"}]})'
```

`.env`:

```
MONGODB_URL=mongodb://127.0.0.1:27017/mps_rebuild
MONGODB_USER=mps_local
MONGODB_PASSWORD=<local-db-password>
MONGODB_AUTH_SOURCE=mps_rebuild
```

**Query logging (`MONGOOSE_DEBUG`).** Off by default. `MONGOOSE_DEBUG=true` prints every Mongoose query to the console, including whole documents (emails, OAuth-state hashes, encrypted tokens). It works only with `NODE_ENV=development`; in any other environment it is ignored and a warning is logged at startup. Turn it on only while debugging a query, and don't paste its output into tickets or chats.

**Alternative: Docker**

```sh
docker run -d --name mps-mongo -p 127.0.0.1:27017:27017 mongo:7
docker exec mps-mongo mongosh mps_rebuild --quiet --eval \
  'db.createUser({user:"mps_local",pwd:"<local-db-password>",roles:[{role:"readWrite",db:"mps_rebuild"}]})'
```

Use the same `.env` values.

Set up an empty database with `npm run setup:fresh -- --confirm` (indexes, reference data, billing plan, citation directories, first super admin; see "Deploy checklist"). Reference data alone: `npm run seed:reference-data`.

On a healthy start the log shows:
- "Mongo has connected successfully"
- "Mongoose connection opened successfully"

- "Agenda jobs defined: post-to-gbp"
- "✅ Agenda connected and ready."
- "🚀 Agenda has started and is processing jobs."

## Email (13b)

Every email goes through one service (`src/services/common/email.service.ts`, `deliver()`) and one switch, **`EMAIL_TRANSPORT`**:

| Value | What happens | Default |
|---|---|---|
| `smtp` | Sent through `SMTP_HOST` / `SMTP_PORT` / `SMTP_USERNAME` / `SMTP_PASSWORD`, From `EMAIL_FROM` (display names vary: branding for reports, "MyPageSEO Billing" for billing) | production |
| `log` | Not sent. One log line per email: `email [<kind>] not sent (EMAIL_TRANSPORT=log): "<subject>" to j***@example.com: <link>` | development, test |

- **Kinds:** `verification`, `password_reset`, `invitation`, `report`, `billing`, `admin`, `contact`, `support`. No per-feature exceptions: `EMAIL_TRANSPORT=smtp` in development sends every kind for real (use a test mailbox).
- **Log mode prints links** (verify, reset, invitation, share): that is its purpose locally. In production the app warns at startup if `EMAIL_TRANSPORT=log`.
- **Responses:** log mode counts as delivered. `email_sent` (invitations) and `email_verification: "sent"` (signup) are false / `"failed"` only when the SMTP server refused the email; a report or billing email that SMTP refuses is an error (recorded on the report / notice).
- **`SUPPORT_EMAIL`:** the support inbox for contact-form notifications and support tickets (new tickets and customer replies); empty = not sent. (It was hardcoded before 13b.)

## Background jobs (agenda)

- `src/configs/agenda.ts` owns the agenda instance. It opens **its own** MongoDB connection (from the same `MONGODB_*` values) and stores jobs in the `agendaJobs` collection. This is deliberate: `agenda@5` must use its bundled MongoDB driver 4 (AUDIT C25).
- Jobs are registered in `src/jobs/index.ts` (`defineAllJobs`). Agenda is started from `src/server.ts` after the HTTP server listens, so seed scripts never process jobs. SIGTERM and SIGINT stop agenda before exit.
- New jobs use `defineJob` / `scheduleJob` from `src/jobs/defineJob.ts`: job data must be IDs only, and every job declares its concurrency and lock lifetime.
- Self-test: `npm run smoke:agenda` (see [Smoke scripts](#smoke-scripts)).

## Reports center (Phase 12)

- **Storage:** report PDFs and branding logos live in `REPORTS_STORAGE_DIR` (default `./storage/reports`, relative to the working directory; git-ignored). It is **private**: never served statically; files are read only through the authenticated endpoints and share links. Layout: `pdf/<organization_id>/<report_id>.pdf`, `branding/<organization_id>/logo.png|jpg`. **Back it up** with MongoDB: a report without its file answers 409 `file_missing`.
- **Size:** 30–50 KB per report (3–8 pages); 1,000 reports ≈ 50 MB.
- **Retention:** `REPORT_RETENTION_MONTHS` (24). The daily `report-retention` job deletes older PDFs and snapshots (status `expired`).
- **Rendering:** PDFKit in-process (pure Node, no Chromium, **no system packages**). Measured on the seeded data: an 8-page Full report takes about 50 ms of CPU and about 40 MB of transient memory; the heap is flat across 100 renders. `REPORT_RENDER_CONCURRENCY` (1, max 2) limits renders per pm2 process.
- **Jobs:** `report-generate` (one report), `report-email` (a scheduled report once ready), `report-schedule-dispatch` (after a location's GBP report: creates the reports due for its monthly cycle), `report-retention` (daily).
- **Email:** From is `EMAIL_FROM` with the branding's sender name; Reply-To from branding. PDFs above `REPORT_EMAIL_MAX_ATTACHMENT_MB` (10) are sent as a 30-day share link. Sent or logged per `EMAIL_TRANSPORT` (see "Email").
- **Share links:** `SHARE_BASE_URL` (else `API_BASE_URL`) + `/r/<token>`, served by this app outside `/api/v1`. If nginx only proxies `/api`, add a location for `/r/`. The request log redacts the token.

## AI (OpenAI) and review management (Phase 18)

**Rule:** AI only on an explicit user action; nothing in the background. Every call goes through `src/services/ai/ai.service.ts` (`runAiTask`): the organization pays MyPageSEO tokens first (refunded if OpenAI fails), a server-wide daily budget caps spend, and each request is logged in `ai_calls` (counts and estimated USD only; no prompts or review text).

**Setup (Mohit):**
1. Create an OpenAI API key for a project with a **monthly budget limit** set in OpenAI's dashboard (the hard stop, on top of ours).
2. Put it in the server's `.env` as `OPENAI_API_KEY=` (never commit it), plus `OPENAI_MODEL=gpt-5-nano`, `OPENAI_REASONING_EFFORT=minimal`, `AI_DAILY_BUDGET_USD=5` (our daily safety net; `0` turns AI off), `AI_MAX_REVIEWS_PER_REQUEST=20`, `REVIEWS_REFRESH_MIN_MINUTES=15`. Restart with `pm2 restart all --update-env`.
3. Without a key every AI route answers 503 `ai_not_configured`; the rest of review management works.

**Model and cost (OpenAI's pricing page, 2026-10-02, per 1M tokens):** `gpt-5-nano` $0.05 input / $0.005 cached / $0.40 output (default; `gpt-5-mini` $0.25 / $2.00 for better writing). Prices live in `src/configs/pricing.ts` (`OPENAI_PRICES`); an unknown model is costed at the gpt-5-mini rate so the daily budget errs safe.

| Action | Per request | Approx. cost (gpt-5-nano) | MyPageSEO tokens (default) |
|---|---|---|---|
| Reply drafts | up to 10 reviews | ≈ 1,500 in + 1,000 out ≈ **$0.0005** | 1 per started 10 |
| Analysis | up to 10 reviews | ≈ $0.0005 | 1 per started 10 |
| Appeal draft | 1 review | ≈ $0.0002 | 1 |
| Insights | 60 excerpts × 300 chars + counts | ≈ 15,000 in + 800 out ≈ **$0.001** | 2 |

A reused result (same review text) costs nothing. Token costs per plan: `PATCH /admin/billing/plans/:planId { ai_token_costs }`.

**Google calls for reviews:** the Refresh Reviews button lists newest-updated first and stops at known reviews (usually 1 call; once per 15 min per location). Sending a reply is 1 call (`updateReply`), deleting one 1 call. The monthly GBP sync still fetches all reviews. All are free (quota only).

**Watching spend:** `db.ai_calls.aggregate([{ $group: { _id: '$task', usd: { $sum: '$cost_usd' }, calls: { $sum: 1 } } }])`; today's total is in `ai_budget_days`.

## Ranking quality, Google API usage and cost (Phase 12.5)

**Ranking at full quality** (Mohit, 2026-09-27: quality over cost):
- Every search fetches all pages (up to 60 results) at every point; each point's full ordered list is stored (`rank_result_lists`, one document per run and keyword).
- **Samples: 3 per point, 60 s apart** (`RANK_SAMPLES_PER_POINT=3`, `RANK_SAMPLE_SPACING_SEC=60`; decided by Mohit on 2026-09-27 from the variance test, see `docs/calibration/variance-2026-09-27.md`). The point's rank is the median of its samples.
- **Map Ranking at 5 points** (`MAP_RANKING_POINTS=all`, decided 2026-09-27): the named top 20 (Pro SKU) at the center and N/S/E/W. Phase 17 adds `places.formattedAddress` and `places.location` to that mask for the map pins; both are Text Search Pro fields (Google's SKU list, checked 2026-10-01), so the price per call is unchanged.
- Competitor Place Details include reviews (up to 5), photos (count) and editorial summary: Enterprise + Atmosphere SKU.

**Limits and quota.**
- `PLACES_MAX_QPS=8` (480/min): enforced across **all** pm2 processes by a MongoDB per-second counter (`places_rate`, TTL). It assumes Google's default quota of **600 requests per minute per method** (Text Search, Place Details); Mohit is confirming it in Cloud (2026-09-27). Raise both together only.
- `RANK_SEARCH_CONCURRENCY=4` searches in flight per run.
- `RANK_MAX_CALLS_PER_RUN=40000` IDs-only calls (Phase 17): a 20-keyword 13×13 run at 3 samples (≈ 30,400 at full depth) fits; at 5 samples it doesn't (≈ 51,000) and is refused with 422. Grids are 3×3 to 13×13 with a radius up to 15 km (default 7×7 at 8 km); the Rank Tracker / Map Ranking offset is radius ÷ 2 per location (`RANK_TRACKER_OFFSET_KM` was removed).
- **Run durations at `PLACES_MAX_QPS` 8** (20 keywords, 3 samples, full depth): 7×7 ≈ 17 min, 9×9 ≈ 32 min, 11×11 ≈ 47 min, 13×13 ≈ 65 min. Runs share the 8/s across the server, so monthly refreshes of many large-grid locations queue behind each other; `GET /locations/:id/tracking/estimate` shows a grid's figures before it is saved.

**Run duration** (background jobs, at 8 req/s; full depth assumes 60 results everywhere; **bold = the current defaults**):

| Run | IDs-only calls | Pro | Duration |
|---|---|---|---|
| 10 keywords × 5×5, 1 sample | 870 | 50 | ~2 min |
| **10 keywords × 5×5, 3 samples, 60 s apart** | **2,610** | **50** | **~5.5 min** |
| 10 keywords × 5×5, 3 samples, 10 min apart | 2,610 | 50 | ~22 min |
| 20 keywords × 7×7, 3 samples, 60 s apart | 9,540 | 100 | ~20 min |
| 20 keywords × 7×7, 5 samples (the maximum) | 15,900 | 100 | ~33 min |

Each run stores `expected_duration_ms`; the stuck guard fails a running run only after max(30 min, 2 × expected + 10 min), and the rank-run job renews its agenda lock every minute. Several runs at once share the 8 req/s.

**Storage per run** (`rank_result_lists`: a dictionary of place IDs + 2 bytes per result; plain ID arrays would be about 5× larger):

| Run | 1 sample | 3 samples (default) | 5 samples |
|---|---|---|---|
| 10 keywords × 5×5 | ~0.15 MB | ~0.25 MB | ~0.35 MB |
| 20 keywords × 7×7 | ~0.45 MB | ~0.8 MB | ~1.2 MB |

Plus the RankRun document (sample ranks per cell and target): up to ~1 MB at 20 × 7×7 × 5 samples. Monthly runs for 1,000 locations at 20 × 7×7 with 3 samples ≈ 10 GB a year.

**Cost per monthly refresh** (list prices, before Google's free monthly allowances; **accepted by Mohit on 2026-09-27: quality first**):

| Item | 10 keywords | 20 keywords |
|---|---|---|
| Ranking searches, IDs-only (any number of samples) | $0 (free SKU) | $0 |
| Map Ranking at 5 points (Pro, $32 per 1,000) | 50 calls, $1.60 | 100 calls, $3.20 |
| Competitor Place Details (Enterprise + Atmosphere, $25 per 1,000) | ≤ 6 calls, $0.15 | $0.15 |
| **Total, Map Ranking at 5 points (current)** | **≈ $1.75** | **≈ $3.35** |
| Total with `MAP_RANKING_POINTS=center` (not used) | ≈ $0.47 | ≈ $0.79 |

A manual rankings refresh costs the Map Ranking row again (≈ $1.60 at 10 keywords). Setup, once: competitor suggestions (Enterprise, ≤ 1 per keyword), add location (Details Enterprise), manual search (Pro): ≈ $0.05–0.40. Prices are defaults in `src/configs/pricing.ts`; **Mohit is checking them against Google's pricing page** (2026-09-27).

**Setup-center picker (2026-10-01):** `GET /places/autocomplete` + `PUT /locations/:id/center { place_id, session }`, one Google session per pick. Per Google's session pricing, the pick (Place Details Essentials, **$5 per 1,000**) ends the session, and only the session's first 12 autocomplete requests bill (Autocomplete Requests, **$2.83 per 1,000**; the rest are free). A pick after 3–5 keystrokes ≈ **$0.013–0.019**, inside the free 10,000 per SKU per month for a long time. Abandoned sessions bill every keystroke. Counts: the pick 1 toward `PLACES_USER_DAILY_LIMIT`; keystrokes rate-limited to 120 per user per hour. Usage SKU `places.autocomplete`.

**Post-deploy steps (Phase 12.5):** `npm run db:sync-indexes -- --confirm` (builds `rank_result_lists`, `api_usage` and the `places_rate` TTL index), remove `COMPETITOR_DETAILS_ATMOSPHERE` from `.env` (done locally 2026-09-27), then the Google Cloud checklist below.

**Variance test (rerun a spacing later):** `npm run variance:test -- --confirm-live --spacings=600` reruns only the 10-minute spacing (2 keywords × 5 points × 3 samples × 3 pages = 90 IDs-only calls, about 20 min). Results are written after each spacing, so an interrupted run keeps what finished.

**Usage ledger.** Every Places and GBP HTTP call (retries included) is counted in `api_usage` per organization, location, month and billing SKU: `places.text.ids_only | pro | enterprise`, `places.details.ids_only | essentials | pro | enterprise | enterprise_atmosphere`, `places.autocomplete` (2026-10-01), `gbp.account_management | business_information | performance | verifications | v4 | oauth`. Requests and jobs are attributed automatically; calls outside both are "unattributed". Counts only, no limits. `GET /organization/usage` → `api_usage` for the organization.

```sh
npm run cost:report                                   # this month, per organization and location
npm run cost:report -- --month=2026-09 --org=<id>    # one organization; --json for machine output
```

Prices: `src/configs/pricing.ts` (USD per 1,000, Google list prices for the Places API (New), first volume tier; **verify on Google's pricing page**), overridable with `PRICING_FILE=<json>`. The report shows list price and, project-wide, the price after Google's free monthly allowances.

**Google Cloud checklist (Mohit):**
1. **Budget + alerts:** Billing → Budgets & alerts, a monthly budget for the project with alerts at 50 %, 90 % and 100 % (email).
2. **Quotas, high enough not to block normal runs:** APIs & Services → Places API (New) → Quotas: keep Text Search and Place Details at **≥ 600 requests per minute** (the default). If you set a daily cap, size it from the cost model: about **1,000 × locations refreshed per day** Text Search requests (a 20 × 7×7 run with 5 samples needs 16,000), plus 100 per location for Pro. Raise `PLACES_MAX_QPS` only with the per-minute quota.
3. **API key:** restrict it to the Places API (New) and to the server's IP address.
4. **Billing export** to BigQuery (optional), to compare Google's invoice with `npm run cost:report`.
5. **Monthly:** run `npm run cost:report -- --month=<last month>` and compare with the invoice.

## Tests

```sh
npm test            # type-checks src + tests (tsc -p tests/tsconfig.json), then runs jest
npm run test:types  # type-check only
TEST_LOGS=1 npm test   # show winston output while testing
```

- Tests never need a Places API key or network access. They load the committed `.env.example` (placeholders), unset `GOOGLE_PLACE_API_KEY`, and replay hand-written fixtures from `tests/fixtures/`.
- Integration tests use an in-memory MongoDB (`mongodb-memory-server`, pinned to 7.0.14 in `package.json`). The binary (about 65 MB) downloads on the first run. Set `MONGOMS_SYSTEM_BINARY=/opt/homebrew/bin/mongod` to use the local server's binary instead.

## Lint and editor setup

```sh
npm run lint        # eslint over src/, tests/ and index.ts (every depth)
```

- **Lint baseline (2026-09-27, after Phase 16): 137 errors, all in legacy modules.** They are in payments / subscriptions / PayPal, white-label, legacy GBP posting (Phase 9), support, legacy user auth, admin operations and old models. The rebuilt modules and all tests have **0**. (It was 169 before Phase 16 deleted the old citation module.)
  - Gate: files you touch add no new errors.
  - Until 2026-09-27 the script was `eslint src/**/*.ts` with an unquoted glob. `sh` has no `**`, so it linted only files exactly one folder deep (159 of 365), and the old "32" baseline under-counted. The globs are quoted now, so ESLint expands them itself.
- **Editor: use the project's TypeScript.** VS Code bundles TypeScript **6.0**, while the project builds with **5.9.3** (`node_modules/typescript`).
  - TS 6 changes defaults: `strict` is on, `rootDir` defaults to the tsconfig folder, and `moduleResolution: node` is deprecated. Under TS 6 the editor showed hundreds of red lines the build never had.
  - `.vscode/settings.json` (committed) sets `typescript.tsdk` to the workspace version. Accept the prompt once, or run **"TypeScript: Select TypeScript Version" → "Use Workspace Version"**.
  - Both tsconfigs now state `strict: false` and `rootDir` explicitly, so TS 5.9 and TS 6 agree on everything except the one deprecation notice (next item).
- **TypeScript 7 migration (later, 9b / 14):** TS 7 removes `moduleResolution: node` (node10). The move is `module` + `moduleResolution: node16`. Two lines need changing first: the side-effect `import('./configs/mongoConnection')` in `src/app.ts` and `import('./mongoConnection')` in `src/configs/mongoMigrate.ts`. Under node16 these would stay real ESM dynamic imports instead of `require`, so the change needs care and testing. No other file is affected (checked with TS 6.0.3).

## Demo ranking data (frontend work, no API key)

```sh
npm run seed:rank-demo
```

- **Creates:** a demo user (`rank-demo@mypageseo.test`), a Toronto plumber location (3 keywords, 2 competitors, 5×5 grid, weekly) and **3 weekly RankRuns** in `mps_rebuild`.
- **How:** it runs the real enqueue and rank-run code against an **offline** Places client (`src/ranking/demo/demoPlaces.ts`), so it makes **0 Google calls**.
- **Output:** a login, an access token (valid 7 days), the location id, and `curl` examples.
- **What the data covers:**
  - ranks improving and declining
  - `entered_top_60` and `dropped_out_of_top_60`
  - "60+" grid corners
  - one error cell, so the latest run is `partial`
- **Guards:** it **refuses to run** unless `NODE_ENV=development` **and** the connected database is `mps_rebuild`.
- **Re-running:** deletes and recreates only the demo user's data, with a new password and token.
- Endpoint reference: [API.md](API.md). First real run with a key: [LIVE_TEST.md](LIVE_TEST.md).

## Demo organizations (frontend work, no API key)

```sh
npm run seed:demo-orgs              # GBP reviews, media and posts filled (as with GBP_V4_ENABLED=true)
npm run seed:demo-orgs -- --v4-off  # the GBP report as it looks before v4 access (GBP Score partial)
```

It creates, in `mps_rebuild`:
- **Business** `business-demo@mypageseo.test`: 1 GBP-connected location with 3 monthly rank runs, 18 months of GBP data and a GBP report; in its 7-day trial with 2 tokens (Phase 13a).
- **Agency** `agency-demo@mypageseo.test`, on a comp (manual, free) subscription for 5 locations with 10 tokens and one paid token-pack invoice (Phase 13a): 2 clients and 3 locations (2 GBP-connected, 1 added from a Places search: `gbp_not_connected`), each with rank runs and a report.
- **Client user** `agency-client@mypageseo.test`: sees one client, read-only.
- **Dashboard data (Phase 11):**
  - Ranks improve (Maple Leaf) and decline (Queen West).
  - GBP Scores have a trend: two reports a month apart.
  - Queen West is unverified and on a revoked Google connection (`reconnect_required`).
  - One team invitation is pending (its token isn't printed).
- **Reports center (Phase 12):** real PDFs rendered offline into `REPORTS_STORAGE_DIR` (business: Rank Tracker + Full; agency: Rank Tracker, GBP Audit and Competitor Analysis for Maple Leaf, a Full report for Danforth without GBP), agency white-label branding with a generated logo, one monthly schedule (client Maple Leaf Group) and one 30-day share link (printed; it uses `SHARE_BASE_URL`, else `API_BASE_URL`, so set it to the port the dev server listens on).

- **Citations (Phase 16):**
  - The starter master list is seeded (50 directories, 5 category groups).
  - Each demo location gets a suggested list (22 listings) with mixed statuses and 60 days of history (the Toronto locations also get Ontario's chamber); a few checks are older than 90 days, for the stale queue.
  - One Citation Report is generated, and the Full reports include a Citations part.

**How:** the real rank-run and report code with **offline** Places clients: **0 Google calls**. The demo Google connection is a placeholder that is never used. **Output:** one password for all demo accounts, three tokens, ids and `curl` examples. Same guards as `seed:rank-demo` (development + `mps_rebuild`; only the demo accounts' data are replaced).

**Billing demo data (Phase 13a):** when the standard plan has no prices, the seed sets demo prices (USD 39 / 15, CAD 49 / 19 for first / additional location), so checkout and `/pricing` can be tried locally. It never overwrites real prices. It also adds the token packs "Starter (demo)" (10) and "Pro (demo)" (50) and the coupon `DEMO10` (10 %). These stay in the local database between runs.

## Citations (Phase 16)

Manual, admin-managed citation tracking (no external citation APIs, no Google calls). The API is in API.md "Citations (Phase 16)".

- **Starter master list:** `npm run seed:citation-directories [-- --confirm]` upserts 5 directory categories and 50 US / CA directories. The data is in `src/scripts/data/`: `directory-categories.json` and `citation-directories.csv`, the same CSV format as the admin import. It is idempotent (upserts by slug / domain, never deletes) and prints created / updated / unchanged.
  - When the `businesscategories` collection is empty, the seed first loads `dumps/businessCategory.json` (the 4,101 Google categories, as `npm run seed:reference-data` does). Without them no location can match a category group.
  - Authority values in the starter CSV are placeholder estimates (marked in `notes`); the admin team replaces them.
- **Suggestions** run when a location completes onboarding, and on `POST /admin/citations/locations/:id/suggest`. Changing the master list doesn't touch existing lists: re-run suggest per location.
- **Citation Health weights:** `src/citations/scoring.config.ts` (change only with Mohit's approval). Every change of an entry refreshes `Location.summary.citation_*`.
- **Stale queue:** `CITATION_STALE_DAYS` (default 90) is the default N of `GET /admin/citations/queue/stale`.
- **Permissions:** `citations.view` / `citations.manage` (`src/configs/adminPermissions.ts`), both held by super admin, admin and editor.

## Billing (Phase 13a)

**Jobs** (one agenda document each, Mongo-locked):
- `billing-renewals`, every 6 hours:
  - PayPal renewal snapshots: 11 days before each renewal (`PAYPAL_PRICE_CHANGE_LEAD_DAYS`, a PayPal provider setting) it fixes quantity = the active locations (at least 1) and the prices in effect at the renewal date, then PATCHes the subscription's price. PayPal ignores price changes within 10 days of a charge for PayPal-funded subscriptions, so the job runs every 6 hours: a failed PATCH is retried while there is still time. `patch_errors` in the log line means a PATCH failed.
  - Manual billing: at each period end the next period starts and an **open** invoice is issued, due in `MANUAL_INVOICE_DUE_DAYS` (14). It includes the prorated slot lines added since the last invoice. Comped subscriptions (`comp_until`) advance without an invoice.
  - Monthly token grants (custom plans): credited once per payment (PayPal) or per period (manual).
  - Token expiry (only packs with `expires_after_days`; off by default): what is left of an expired pack is removed. Oldest tokens are spent first.
- `billing-reminders`, daily: trial ending in 3 days and in 1 day (organizations without a subscription), and each manual invoice once it is past due.

**Emails** (`src/services/billing/billingEmails.ts`): receipt (invoice PDF attached), invoice issued (manual, PDF attached), invoice overdue, payment failed, subscription activated / cancelled, trial ending. They go to the billing email (`PATCH /billing/details`), else the owner. Sent or logged per `EMAIL_TRANSPORT` (see "Email").

**Tokens:** manual refreshes and "run now" spend `tokens_per_refresh` (per type, default 1); the monthly refresh is free. A refresh that fails entirely (including the stuck guards) is refunded automatically. The trial grants `trial.tokens` (default 0) at organization creation.

### PayPal setup (Phase 13a)

**No live PayPal call has been made yet.** Mohit gives sandbox credentials and says when to test live.

**Account:** a PayPal **Business** account. In the developer dashboard (developer.paypal.com → Apps & Credentials), create one REST app per environment (sandbox, live). Its client id and secret go in `.env`. Make sure the account can receive **USD and CAD**, and that the app has **Subscriptions** and **Checkout (Orders)** enabled.

**Environment variables:**

| Variable | Default | Purpose |
|---|---|---|
| `PAYPAL_MODE` | `sandbox` | `sandbox` or `live` (API base URL) |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | empty | The REST app (never commit, print or log them) |
| `PAYPAL_WEBHOOK_ID` | empty | The app's webhook id; without it every webhook is refused (Phase 10) |
| `PAYPAL_PRODUCT_ID`, `PAYPAL_PLAN_ID_USD`, `PAYPAL_PLAN_ID_CAD` | empty | Written by `billing:paypal-setup` (below); without the plan id for a currency, checkout answers 503 `billing_not_configured` |
| `BILLING_GRACE_DAYS` | 7 | Failed payment / overdue manual invoice → read-only after this |
| `MANUAL_INVOICE_DUE_DAYS` | 14 | Manual invoices are due this many days after issue |
| `PAYPAL_PRICE_CHANGE_LEAD_DAYS` | 11 | Renewal snapshot + price PATCH this many days before a renewal (PayPal ignores changes within 10) |
| `BILLING_SELLER_NAME`, `BILLING_SELLER_ADDRESS` (address lines separated by a vertical bar), `BILLING_SELLER_EMAIL`, `BILLING_SELLER_TAX_ID` | name `MyPageSEO`, others empty | The seller block on invoices |
| `FRONTEND_URL` | – | PayPal returns to `FRONTEND_URL/settings/billing?…` |

**Card payments without a PayPal account (Mohit, 2026-09-28).** Customers must be able to pay by card without creating a PayPal account, like on other SaaS products. Two account settings are needed for that; step 0 below.

**Steps (per environment):**
0. **Business account settings (Mohit):**
   - Turn on **"PayPal Account Optional"**: Account Settings → Website payments → Website preferences. This lets buyers pay by card as guests.
   - Ask **PayPal support** to enable **guest (card) checkout for subscriptions** on the account. Whether a subscription can be paid by card without a PayPal login depends on the account and region, and is not a setting we control. Note the ticket number and answer in STATUS.md ("Decide before launch").
1. Set `PAYPAL_MODE`, `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`.
2. Run `npm run billing:paypal-setup -- --confirm`. It creates the catalog product "MyPageSEO" and two monthly plans (USD, CAD; the plan price is a placeholder because each subscription carries its own price) and prints `PAYPAL_PRODUCT_ID`, `PAYPAL_PLAN_ID_USD` and `PAYPAL_PLAN_ID_CAD` for `.env`. Ids already set are reused. About 4 PayPal calls.
3. **Webhook:** in the app → Webhooks → Add webhook, URL `https://<API host>/api/v1/subscription/paypal/webhook`, events:
   - `BILLING.SUBSCRIPTION.CREATED`, `.ACTIVATED`, `.UPDATED`, `.EXPIRED`, `.CANCELLED`, `.SUSPENDED`, `.PAYMENT.FAILED`
   - `PAYMENT.SALE.COMPLETED`, `.DENIED`, `.REFUNDED`, `.REVERSED`
   - `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, `.DENIED`, `.PENDING`, `.REFUNDED`

   Copy the webhook id into `PAYPAL_WEBHOOK_ID`. nginx must forward the path unchanged (the body is verified with PayPal).
4. **Prices:** in the billing admin, add the standard plan's prices per currency (`POST /api/v1/admin/billing/plans/:planId/prices`), the token packs, and the token costs (STATUS.md open item 11).
5. **Sandbox test** (when Mohit says so), with a sandbox buyer account:
   - subscribe (checkout → approve → return → `POST /billing/sync`)
   - check the webhook deliveries in the dashboard and the first invoice
   - add a location beyond the paid quantity (slot order → capture)
   - buy a token pack (with a coupon)
   - cancel
   - check a renewal. Sandbox renewals happen on the real schedule; check the `billing-renewals` log line for the snapshot and PATCH.
   - **Card without a PayPal account:** use two sandbox personal buyers, one **US** and one **Canadian**. Don't log in to PayPal on the approval page; look for the **"Debit or Credit Card"** (or "Pay with card") option. For each buyer, record yes / no and what the page asked for:

     | Flow | US buyer, card, no login | CA buyer, card, no login |
     |---|---|---|
     | (a) subscription checkout (`POST /billing/checkout` → `approve_url`) | | |
     | (b) token pack (`POST /billing/tokens/checkout` → `approve_url`) | | |
     | (b) extra location slots (`POST /billing/location-slots` → `approve_url`) | | |

     Where a card option appears, finish the payment with a sandbox test card and check the webhook, invoice and entitlement. Do this with "PayPal Account Optional" on (step 0), and note the date and account settings.

   Record the PayPal call counts and results in `docs/LIVE_TEST.md`, and the card table in STATUS.md ("Decide before launch").

## Organizations, plan limits and auth (Phase 8)

- **Limits (Phase 13a):** come from billing: the trial allowances (1 location, 3 users), then the paid location quantity and 3 users per paid location, and the plan's cap (20 locations on the standard plan). There is no organization-wide keyword cap (20 per location). `DEFAULT_LOCATION_LIMIT` / `DEFAULT_KEYWORD_LIMIT` were removed.
- **Team invitations (Phase 11):** links are `${FRONTEND_URL}/invite?token=…`, valid `INVITATION_TTL_DAYS` (7). Sent or logged per `EMAIL_TRANSPORT` (see "Email").
- **Email verification (Phase 8.1):** a link `${FRONTEND_URL}/verify-email?token=…`, valid `EMAIL_VERIFICATION_TTL_HOURS` (24); the token is stored as a SHA-256 hash. The hourly `unverified-cleanup` job deletes signups not verified in time. Sent or logged per `EMAIL_TRANSPORT` (see "Email").
- **One-time links (13b; no codes or OTPs anywhere):** `auth_links` (`src/services/auth/links.ts`), one row per account and purpose (a newer link replaces the older), only the token's SHA-256 stored, kept a week after expiry or use so an old link answers `link_expired` / `link_invalid` (TTL on `purge_at`).
  - Password reset (users and admins): `PASSWORD_RESET_TTL_MINUTES` (60). Users: `${FRONTEND_URL}/reset-password?token=…`; admins: `${ADMIN_FRONTEND_URL}/reset-password?token=…`.
  - A new admin's first password: the same admin page, valid `ADMIN_SET_PASSWORD_TTL_HOURS` (72); the account has no password until then.
  - Rate-limit counters are in `rate_limits` (TTL); IP-based limits need `trust proxy` (Phase 10).

## Ranking jobs

| Job | When | What |
|---|---|---|
| `rank-run` | Queued by a refresh (`POST /locations/:id/refresh`, "run now"), onboarding completion, or the monthly refresh. Job data is `{ run_id }` only. Concurrency 2 per process, 35-minute lock. | Runs one RankRun: center, then tracker and grid searches, then the map list, metrics, change, and save. Logs `rank-run <id>: <status> ids_only=… pro=… details=…`. |
| `gbp-sync` (7b) | Queued by a refresh, onboarding completion, or the monthly refresh. Job data `{ sync_id }`. Concurrency 2 per process, 20-minute lock. | Fetches performance, keywords, profile (+ attributes, Google edits), verification, and (with `GBP_V4_ENABLED`) reviews, media, posts; each type independently; upserts; one dated profile snapshot. Logs `gbp-sync <id>: <status> calls=… performance=ok …`. |
| `gbp-report` (7c) | Requested after a rank run (done/partial) or a GBP sync finishes, after a change of tracked competitors, and after an unbind; runs `REPORT_DEBOUNCE_SECONDS` (120) later. Job data `{ location_id, trigger }`. Concurrency 2, 10-minute lock. | Regenerates the location's single GBP report from stored data. Requests are claimed with a compare-and-set on `Location.gbp_report.scheduled_for`, so close triggers give one job; the job skips while a rank run or sync is still active (its finish requests again), so a monthly refresh gives one report. Fetches competitor Place Details only when stale (below). Logs `gbp-report: location <id> generated (<trigger>) … places_details=…`. |
| `monthly-refresh` (7b) | Every 15 minutes (`agenda.every`), one process at a time. Replaces the Phase 5 `rank-scheduler`, whose old job document is cancelled at startup. | Fails rank runs and GBP syncs stuck for more than 30 minutes. For each due `auto_monthly` location with keywords (`refresh.next_refresh_at <= now`, claimed with a compare-and-set): queues a rank run and, if GBP-connected, a GBP sync, and moves `next_refresh_at` to the next month's anchor day (~03:00 local; zone = `Location.timezone`, else estimated from longitude, else UTC). `manual_only` locations are never scheduled. |

**Limits**
- One queued or running run per location, enforced by a unique index.
- A run is rejected (422) when its estimated maximum IDs-only calls exceed `RANK_MAX_CALLS_PER_RUN` (default 40,000).
- In development, runs use at most `RANK_DEV_MAX_KEYWORDS` (2) keywords and a 3×3 grid.
- `STORE_PLACE_NAMES` (default `true`) controls whether Map Ranking business names are stored.
- **Manual refresh:** at most once per `REFRESH_MIN_INTERVAL_HOURS` (24) per location per type (rankings, gbp); "run now" shares the rankings limit.

**GBP report (7c):**
- **Place Details for the competitor comparison** (Enterprise SKU; client + up to 5 competitors): a business is fetched when it has no stored facts, when its facts predate the location's last automatic refresh (so at most once per monthly cycle), or after a manual `POST /refresh` when its facts are older than 24 h. So about 6 calls per location per month, plus at most 6 per manual refresh. The count is stored on the report (`api_calls.places_details`).
- `COMPETITOR_DETAILS_ATMOSPHERE` (default false) also requests `editorialSummary`, which moves the call to the more expensive Atmosphere tier.
- The report is one document per location (`gbp_reports`), overwritten each time; weights and thresholds are in `src/gbp/scoring.config.ts`.

**GBP sync settings:** `GBP_V4_ENABLED` (false until Google approves v4: reviews, media and posts are then `not_available`), `GBP_BACKFILL_MONTHS` (18), `GBP_ROLLING_DAYS` (40), `GBP_KEYWORD_BACKFILL_MONTHS` (6), `GBP_KEYWORD_ROLLING_MONTHS` (2), `REFRESH_LOCAL_HOUR` (3). **Going live with v4:** set `GBP_V4_ENABLED=true` and restart; no code changes.

## Smoke scripts

| Command | What it does | API cost | Who runs it |
|---|---|---|---|
| `npm run smoke:agenda` | Defines a throwaway `agenda-self-test` job (only inside the script), schedules it 10 s ahead against the configured database (`mps_rebuild`), waits for it to run, removes it and prints how many are left (expected 0). Safe while `npm run dev` is running. | **None** (MongoDB only) | Anyone |
| `npm run smoke:places -- "<keyword>" <lat> <lng> [place_id] [--region=us\|ca]` | Makes **one** IDs-only Text Search call (page 1, up to 20 results) and prints the result count, whether `place_id` was found and at what rank, and the API call count. Refuses to run without `GOOGLE_PLACE_API_KEY` and never prints the key. | 1 call on the free "Text Search Essentials (IDs Only)" SKU (2 if the one retry fires) | **Mohit only**, with a restricted, budget-capped Places API (New) key. There are no real Google calls until he says so. |

Example:

```sh
npm run smoke:places -- "emergency plumber" 43.6629 -79.3347 ChIJ... --region=ca
```

## Google Business Profile (Phase 6)

Setup and connection walkthrough: [GBP_CONNECT.md](GBP_CONNECT.md).

| Command | What it does | Google calls | Who runs it |
|---|---|---|---|
| `npm run gbp:preflight -- <userId>` | Lists the user's GBP accounts and locations (names and IDs only). Reports "GBP API access not approved (quota 0)", "API not enabled", "Reconnect needed" or "Server not configured" clearly. Development + `mps_rebuild` only. | 1 per page of accounts + 1 per page of locations per account (+1 token refresh), ≤ 5/s | **Mohit** |
| `npm run setup:live-test -- --token-only --token-file <path>` | Fresh login token for the live-test user; prints its user id and locations. | None | Anyone (development) |

- **`TOKEN_ENCRYPTION_KEY`** (`openssl rand -hex 32`) is required in production. Losing or changing it means users must reconnect GBP.
- **`PLACES_USER_DAILY_LIMIT`** (default 50, Phase 7a) caps user-triggered Places calls (competitor suggestions + manual search) per user per UTC day. It is counted in the `places_usage` collection (TTL), so it holds across pm2 processes.
- **`GBP_MAX_RPS`** (default 5) caps GBP calls per process. Under pm2 cluster mode each process has its own limiter, so the cluster-wide rate can be higher. Phase 7 sync jobs run through agenda, where a job runs on one process at a time.

## Build

```sh
npm run build
```

This runs `tsc -p .` into `build/` and copies `package.json` and `package-lock.json` into `build/`. It does **not** copy `.env`.

## Production start (pm2)

pm2 is installed globally on the server (`npm install -g pm2`); it is not a project dependency. `ecosystem.config.json` runs `build/index.js` as `mps-backend`:

| Setting | Why |
|---|---|
| `exec_mode: cluster`, `instances: max` | One process per CPU core behind one port |
| `node_args: --enable-source-maps` | Stack traces point at the `.ts` lines (`tsconfig` emits source maps) |
| `max_memory_restart: 1G` | A process that leaks is restarted instead of taking the server down |
| `exp_backoff_restart_delay: 200` | A crash loop (e.g. a bad `.env`) backs off instead of restarting instantly |
| `kill_timeout: 10000` | On stop/restart pm2 sends SIGINT; `src/server.ts` stops agenda (releasing job locks) and closes the server, and gets 10 s before SIGKILL |
| `merge_logs`, `time` | One log stream for all instances, with timestamps |
| `NODE_ENV=production` | Production validation and defaults |

pm2 uses the directory `pm2 start` is run from as the working directory, so run it from the repo root (where `.env` lives):

```sh
cd /path/to/repo
npm ci && npm run build
pm2 start ecosystem.config.json    # first time
pm2 save && pm2 startup            # run the command pm2 startup prints: start on boot
pm2 install pm2-logrotate          # rotate ~/.pm2/logs (10 MB, 30 files by default)
```

Later deploys: `git pull && npm ci && npm run build && pm2 reload mps-backend` (reload restarts the instances one by one, without downtime). `npm start` (`--no-daemon`) keeps pm2 in the foreground: only for containers, not on the server.

To keep `.env` elsewhere, set `ENV_FILE` in the pm2 environment instead, e.g. `ENV_FILE=/etc/mps/backend.env pm2 start ecosystem.config.json`.

Static files (`public/`) and request logs (`logs/`) are resolved relative to the compiled files (`build/src/...` → repo root), not the working directory. They are unaffected by where the app is started from.

Cluster-mode caveats, since every instance runs these:
- the agenda poller (Mongo-locked, so each job runs on one process)
- `node-cache` (a per-process cache)
- rate limits and the Places throttle are MongoDB counters, so they hold across processes

### nginx and HTTPS

The app speaks **plain HTTP on `127.0.0.1:PORT`** (`HOST`, default `127.0.0.1`); it has no TLS code. nginx terminates HTTPS and proxies to it, so the app is never reachable around nginx. Domains: the API at `api.mypageseo.com`, the web app at `app.mypageseo.com` (in `ACCESSDOMAINS`, `FRONTEND_URL`).

```nginx
# /etc/nginx/sites-available/api.mypageseo.com
server {
    server_name api.mypageseo.com;
    client_max_body_size 100m;          # uploads: up to 10 files of 10 MB

    location / {
        proxy_pass http://127.0.0.1:5055;   # = PORT
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
```

```sh
ln -s /etc/nginx/sites-available/api.mypageseo.com /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d api.mypageseo.com     # certificate + HTTP→HTTPS redirect, auto-renewed
```

`TRUST_PROXY_HOPS=1` (one nginx) makes `req.ip` the client. The PayPal webhook path must be forwarded unchanged (the body is verified with PayPal).

## Deploy checklist (fresh database)

**The launch uses a fresh, empty database (Mohit, 2026-09-28). Nothing is migrated from the old system**, so there are no migration steps. In this order:

1. **Server:** MongoDB, nginx and pm2 installed (Phase 14 details the server). Create `REPORTS_STORAGE_DIR` (default `storage/reports` under the repo root), writable by the pm2 user and **not** under `public/`; include it in backups.
2. **`.env`** (see `.env.example`). The app refuses to start in production without the security settings:
   - `JWT_SECRET` and `ADMIN_JWT_SECRET`: each at least 32 characters (`openssl rand -hex 32`), different from each other.
   - `TOKEN_ENCRYPTION_KEY` (`openssl rand -hex 32`); losing or changing it forces every user to reconnect GBP.
   - `PORT`, `HOST=127.0.0.1` (the default; nginx terminates HTTPS, section "nginx and HTTPS"), `TRUST_PROXY_HOPS=1` behind nginx; `ACCESSDOMAINS` lists every frontend origin; `FRONTEND_URL` (verification, reset and invitation links, PayPal return pages); `ADMIN_FRONTEND_URL` (admin password links); `SHARE_BASE_URL` (public API origin; nginx forwards `/r/` to the app).
   - Email (13b): `EMAIL_TRANSPORT=smtp` (the production default) with the `SMTP_*` settings and `EMAIL_FROM`; `SUPPORT_EMAIL` (support inbox).
   - Google OAuth (13b): the redirect-fallback URI moved to `<API>/api/v1/gbp/connect/callback`: set `GOOGLE_GBP_REDIRECT_URI` to it and add it to the OAuth client's authorised redirect URIs in Google Cloud.
   - Google: `GOOGLE_PLACE_API_KEY`, the GBP OAuth client, `GBP_V4_ENABLED` (false until v4 access).
   - Ranking: `RANK_MAX_CALLS_PER_RUN=40000`, `PLACES_MAX_QPS=8`, `MAP_RANKING_POINTS=all`, `RANK_SAMPLES_PER_POINT=3`, `RANK_SAMPLE_SPACING_SEC=60`.
   - PayPal and billing: section "PayPal setup". `PAYPAL_WEBHOOK_ID` may stay empty until the webhook exists (step 5): the app starts with a warning and refuses every PayPal webhook until it is set.
   - First super admin: `SUPER_ADMIN_EMAIL` (and optionally `SUPER_ADMIN_PASSWORD`, at least 12 characters; otherwise a password is generated and shown once).
   - Check it with `npm run config:check`: it lists every missing or invalid variable at once (the app refuses to start with the same list).
3. **Install and build:** `npm ci` (the setup scripts run with ts-node, a dev dependency, so don't use `--omit=dev`), then `npm run build`.
4. **`npm run setup:fresh -- --confirm`**. On the empty database it runs, in order (each step idempotent, so re-running is safe):
   1. `db:sync-indexes`: every model's indexes
   2. `seed:reference-data`: roles (super admin 1, admin 2, editor 4, as in `SUP_ADM_ROLE_ID` / `ADM_ROLE_ID` / `EDTR_ROLE_ID`), countries, states, cities, languages, time zones, business categories from `dumps/`
   3. `billing:setup-plan`: the standard billing plan, without prices
   4. `seed:citation-directories`: the starter directory master list
   5. `admin:create-super`: the first super admin. **A generated password is printed once: store it.**

   It refuses (exit 3) when the database already has organizations; `--force` overrides that. Each step also exists on its own (`npm run <step> -- --confirm`).
5. **PayPal:** `npm run billing:paypal-setup -- --confirm` and the webhook (section "PayPal setup"); put the printed ids and `PAYPAL_WEBHOOK_ID` in `.env`.
6. **Start:** `pm2 start ecosystem.config.json`, then `pm2 save && pm2 startup` (section "Production start (pm2)"), from the repo root. Check the log for `Agenda jobs defined: …` (`post-to-gbp, rank-run, gbp-sync, gbp-report, monthly-refresh, report-generate, report-email, report-schedule-dispatch, report-retention, unverified-cleanup, billing-renewals, billing-reminders`) and the `Recurring job scheduled: …` lines.
7. **After start, in the admin panel:** sign in as the super admin; set the prices, token packs and token costs (billing admin); review the citation directory list; create the other admins.
8. Do the Google Cloud checklist (section "Ranking quality") before the first monthly refresh.

**Later releases:** `npm ci && npm run build`, then `npm run db:sync-indexes -- --confirm` (new or changed indexes), then restart. The standard plan, reference data and citation seed are idempotent and can be re-run.

`--confirm` is required on any database other than the local `mps_rebuild`. Run every script from the repo root with the target `.env` (or `ENV_FILE`). None of them calls Google; only `billing:paypal-setup` calls PayPal.
