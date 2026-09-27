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

Mongoose creates the collections and model indexes on first start. Seed reference data (roles, countries, and so on) with `npm run mongo-migrate`.

On a healthy start the log shows:
- "Mongo has connected successfully"
- "Mongoose connection opened successfully"

- "Agenda jobs defined: post-to-gbp"
- "✅ Agenda connected and ready."
- "🚀 Agenda has started and is processing jobs."

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
- **Email:** From is `EMAIL_FROM` with the branding's sender name; Reply-To from branding. PDFs above `REPORT_EMAIL_MAX_ATTACHMENT_MB` (10) are sent as a 30-day share link. Nothing is sent in development (logged with masked recipients).
- **Share links:** `SHARE_BASE_URL` (else `API_BASE_URL`) + `/r/<token>`, served by this app outside `/api/v1`. If nginx only proxies `/api`, add a location for `/r/`. The request log redacts the token.
- **Legacy white-label:** `npm run migrate:branding` copies each agency's legacy `/white-label-profiles` profile into organization branding (never overwrites; `--dry-run` prints the plan).

## Ranking quality, Google API usage and cost (Phase 12.5)

**Ranking at full quality** (Mohit, 2026-09-27: quality over cost):
- Every search fetches all pages (up to 60 results) at every point; each point's full ordered list is stored (`rank_result_lists`, one document per run and keyword).
- **Samples: 3 per point, 60 s apart** (`RANK_SAMPLES_PER_POINT=3`, `RANK_SAMPLE_SPACING_SEC=60`; decided by Mohit on 2026-09-27 from the variance test, see `docs/calibration/variance-2026-09-27.md`). The point's rank is the median of its samples.
- **Map Ranking at 5 points** (`MAP_RANKING_POINTS=all`, decided 2026-09-27): the named top 20 (Pro SKU) at the center and N/S/E/W.
- Competitor Place Details include reviews (up to 5), photos (count) and editorial summary: Enterprise + Atmosphere SKU.

**Limits and quota.**
- `PLACES_MAX_QPS=8` (480/min): enforced across **all** pm2 processes by a MongoDB per-second counter (`places_rate`, TTL). It assumes Google's default quota of **600 requests per minute per method** (Text Search, Place Details); Mohit is confirming it in Cloud (2026-09-27). Raise both together only.
- `RANK_SEARCH_CONCURRENCY=4` searches in flight per run.
- `RANK_MAX_CALLS_PER_RUN=16000` IDs-only calls: the largest run, 20 keywords × 7×7 × 3 pages × 5 samples = 15,900, fits.

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

**Post-deploy steps (Phase 12.5):** `npm run db:sync-indexes -- --confirm` (builds `rank_result_lists`, `api_usage` and the `places_rate` TTL index), remove `COMPETITOR_DETAILS_ATMOSPHERE` from `.env` (done locally 2026-09-27), then the Google Cloud checklist below.

**Variance test (rerun a spacing later):** `npm run variance:test -- --confirm-live --spacings=600` reruns only the 10-minute spacing (2 keywords × 5 points × 3 samples × 3 pages = 90 IDs-only calls, about 20 min). Results are written after each spacing, so an interrupted run keeps what finished.

**Usage ledger.** Every Places and GBP HTTP call (retries included) is counted in `api_usage` per organization, location, month and billing SKU: `places.text.ids_only | pro | enterprise`, `places.details.ids_only | essentials | pro | enterprise | enterprise_atmosphere`, `gbp.account_management | business_information | performance | verifications | v4 | oauth`. Requests and jobs are attributed automatically; calls outside both are "unattributed". Counts only, no limits. `GET /organization/usage` → `api_usage` for the organization.

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

`npm run seed:gbp-demo` is an alias. It creates, in `mps_rebuild`:
- **Business** `business-demo@mypageseo.test`: 1 GBP-connected location with 3 monthly rank runs, 18 months of GBP data and a GBP report.
- **Agency** `agency-demo@mypageseo.test`, on a demo plan (`Demo Agency (seed)`: 5 locations, 60 keywords): 2 clients and 3 locations (2 GBP-connected, 1 added from a Places search: `gbp_not_connected`), each with rank runs and a report.
- **Client user** `agency-client@mypageseo.test`: sees one client, read-only.
- **Dashboard data (Phase 11):**
  - Ranks improve (Maple Leaf) and decline (Queen West).
  - GBP Scores have a trend: two reports a month apart.
  - Queen West is unverified and on a revoked Google connection (`reconnect_required`).
  - One team invitation is pending (its token isn't printed).
- **Reports center (Phase 12):** real PDFs rendered offline into `REPORTS_STORAGE_DIR` (business: Rank Tracker + Full; agency: Rank Tracker, GBP Audit and Competitor Analysis for Maple Leaf, a Full report for Danforth without GBP), agency white-label branding with a generated logo, one monthly schedule (client Maple Leaf Group) and one 30-day share link (printed; it uses `SHARE_BASE_URL`, else `API_BASE_URL`, so set it to the port the dev server listens on).

**How:** the real rank-run and report code with **offline** Places clients: **0 Google calls**. The demo Google connection is a placeholder that is never used. **Output:** one password for all demo accounts, three tokens, ids and `curl` examples. Same guards as `seed:rank-demo` (development + `mps_rebuild`; only the demo accounts' data and the demo plan are replaced).

## Organizations, plan limits and auth (Phase 8)

- **Migration:** `npm run migrate:organizations` (idempotent; `mps_rebuild`, or `-- --confirm` for another database after a backup of users, locations and clients). Every existing account gets an organization:
  - AGENCY → agency organization; BUSINESS or no type → business organization; the user is the owner and it becomes the default organization.
  - EMPLOYEE → member of its owner's organization; CLIENT accounts are skipped (reported).
  - Locations and clients get their creator's organization; locations also get `source`, `gbp_connected` and their list summary.
  - Two locations with the same `place_id` in one organization: the second stays unassigned and unchanged, and is reported (exit code 3). Delete one, then re-run. The unique index is synced only when there are none.
  - It prints the mapping (user ids and organization names, no emails). **Run it once when deploying Phase 8**, before the app serves requests: locations without an organization are not reachable.
- **Plan limits:** from the organization owner's active plan (`subscription_plans.location_limit`, `keyword_limit`; set them per plan in the database, the payment code is unchanged). Otherwise `DEFAULT_LOCATION_LIMIT` (1) and `DEFAULT_KEYWORD_LIMIT` (empty = no org-wide cap).
- **Team invitations (Phase 11):** links are `${FRONTEND_URL}/invite?token=…`, valid `INVITATION_TTL_DAYS` (7). Emails use the SMTP settings. In development nothing is sent: the link is logged with the recipient masked.
- **Auth codes:** `AUTH_CODE_TTL_MINUTES` (15). Codes are HMAC-hashed with a key derived from `JWT_SECRET` (changing `JWT_SECRET` invalidates pending codes). Rate-limit counters are in `rate_limits` (TTL); IP-based limits need `trust proxy` (Phase 10).

## Ranking jobs

| Job | When | What |
|---|---|---|
| `rank-run` | Queued by a refresh (`POST /locations/:id/refresh`, "run now"), onboarding completion, or the monthly refresh. Job data is `{ run_id }` only. Concurrency 2 per process, 35-minute lock. | Runs one RankRun: center, then tracker and grid searches, then the map list, metrics, change, and save. Logs `rank-run <id>: <status> ids_only=… pro=… details=…`. |
| `gbp-sync` (7b) | Queued by a refresh, onboarding completion, or the monthly refresh. Job data `{ sync_id }`. Concurrency 2 per process, 20-minute lock. | Fetches performance, keywords, profile (+ attributes, Google edits), verification, and (with `GBP_V4_ENABLED`) reviews, media, posts; each type independently; upserts; one dated profile snapshot. Logs `gbp-sync <id>: <status> calls=… performance=ok …`. |
| `gbp-report` (7c) | Requested after a rank run (done/partial) or a GBP sync finishes, after a change of tracked competitors, and after an unbind; runs `REPORT_DEBOUNCE_SECONDS` (120) later. Job data `{ location_id, trigger }`. Concurrency 2, 10-minute lock. | Regenerates the location's single GBP report from stored data. Requests are claimed with a compare-and-set on `Location.gbp_report.scheduled_for`, so close triggers give one job; the job skips while a rank run or sync is still active (its finish requests again), so a monthly refresh gives one report. Fetches competitor Place Details only when stale (below). Logs `gbp-report: location <id> generated (<trigger>) … places_details=…`. |
| `monthly-refresh` (7b) | Every 15 minutes (`agenda.every`), one process at a time. Replaces the Phase 5 `rank-scheduler`, whose old job document is cancelled at startup. | Fails rank runs and GBP syncs stuck for more than 30 minutes. For each due `auto_monthly` location with keywords (`refresh.next_refresh_at <= now`, claimed with a compare-and-set): queues a rank run and, if GBP-connected, a GBP sync, and moves `next_refresh_at` to the next month's anchor day (~03:00 local; zone = `Location.timezone`, else estimated from longitude, else UTC). `manual_only` locations are never scheduled. |

**Limits**
- One queued or running run per location, enforced by a unique index.
- A run is rejected (422) when its estimated maximum IDs-only calls exceed `RANK_MAX_CALLS_PER_RUN` (default 3200).
- In development, runs use at most `RANK_DEV_MAX_KEYWORDS` (2) keywords and a 3×3 grid.
- `STORE_PLACE_NAMES` (default `true`) controls whether Map Ranking business names are stored.
- **Manual refresh:** at most once per `REFRESH_MIN_INTERVAL_HOURS` (24) per location per type (rankings, gbp); "run now" shares the rankings limit.

**Migration (7b):** `npm run migrate:refresh` maps `tracking.frequency` weekly/monthly → `auto_monthly`, manual → `manual_only`, and gives every set-up location its monthly schedule. It is idempotent and makes no Google calls. It refuses a database other than `mps_rebuild` unless `--confirm` is passed; back up `locations` first. Run it once when deploying 7b.

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
| `npm run gbp:encrypt-tokens` | Encrypts plaintext GBP tokens in `user_auths` (idempotent). Needs `TOKEN_ENCRYPTION_KEY`; back up `user_auths` first. | None | Whoever migrates a server's data |
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

`ecosystem.config.json` runs `build/index.js` in cluster mode (`instances: "max"`). pm2 uses the directory `pm2 start` is run from as the working directory, so run it from the repo root:

```sh
cd /path/to/repo           # repo root, where .env lives
npm ci
npm run build
npm start                  # = pm2 start ecosystem.config.json --no-daemon
```

To keep `.env` elsewhere, set `ENV_FILE` in the pm2 environment instead, e.g. `ENV_FILE=/etc/mps/backend.env npm start`.

Static files (`public/`) and request logs (`logs/`) are resolved relative to the compiled files (`build/src/...` → repo root), not the working directory. They are unaffected by where the app is started from.

Cluster-mode caveats, since every instance runs these:
- the node-cron heartbeat
- the agenda poller (Mongo-locked, so safe)
- the in-memory rate-limit store
- `node-cache`

## Deploy checklist

On any database that already has data, in this order, **before the new version serves requests**:

1. **Back up** `users`, `locations`, `clients`, `organizations` and `user_auths` (and, from Phase 12, `REPORTS_STORAGE_DIR`).
2. **`.env`:** set the new settings (see `.env.example`). In production `TOKEN_ENCRYPTION_KEY` is required; losing or changing it forces every user to reconnect GBP.
   **Phase 10 (security), the app refuses to start in production without these:**
   - **`JWT_SECRET`: rotate it.** At least 32 characters (`openssl rand -hex 32`); the current production secret is 12 characters. **Every user is signed out once** and signs in again.
   - **`ADMIN_JWT_SECRET`:** new, at least 32 characters, different from `JWT_SECRET`. Existing admin tokens stop working; admins sign in again.
   - **`PAYPAL_WEBHOOK_ID`:** from the PayPal developer dashboard (your app → Webhooks). Without it every webhook is refused.
   - **`TRUST_PROXY_HOPS=1`** behind nginx (so rate limits and logs see the client IP); **`ACCESSDOMAINS`** must list every frontend origin (the wildcard CORS header is gone).
   - `JWT_ACCESS_EXPIRATION_DAYS=1` (was 7; refresh tokens stay 30 days).
3. **Install and build:** `npm ci` (the migration scripts run with ts-node, a dev dependency, so don't install with `--omit=dev` / `NODE_ENV=production`), then `npm run build`.
4. **`npm run migrate:refresh -- --confirm`** (7b): tracking frequencies → `auto_monthly | manual_only`, plus the monthly refresh schedule. Idempotent.
5. **`npm run migrate:organizations -- --confirm`** (Phase 8): every account gets an organization; locations and clients get theirs. **Required**: until it has run, existing locations can't be reached. Exit code 3 means duplicate `place_id`s within an organization: delete one of each pair it lists, then run it again (it syncs the unique index only when there are none). Idempotent.
6. **`npm run db:sync-indexes -- --confirm`**: syncs the indexes of the rebuilt collections with their schemas, building new ones and dropping ones no longer defined. **Required on any database from before 7a**: its `user_auths` still has the old one-Google-account-per-user unique index, which blocks connecting a second account.
7. **`npm run summaries:rebuild -- --confirm`** (Phase 11): recomputes every location's list and dashboard summary from its latest runs and report. Idempotent.
8. **`npm run gbp:encrypt-tokens`**, only on a database with GBP connections from before Phase 6. Idempotent.
9. **Reports storage (Phase 12):** create `REPORTS_STORAGE_DIR` (default `storage/reports` under the repo root), writable by the pm2 user and **not** under `public/`; add it to the backups. Set `SHARE_BASE_URL` to the public API origin, and make nginx forward `/r/` to the app. No system packages are needed (no Chromium).
10. **`npm run migrate:branding -- --confirm`** (Phase 12): legacy white-label profiles → organization branding (agencies without branding only; copies logos into the storage directory). Idempotent. Run `db:sync-indexes` (step 6) after this release too: it builds the report indexes (Phase 12.5: also `rank_result_lists`, `api_usage` and the `places_rate` TTL index).
    **Phase 12.5 `.env`:** `RANK_MAX_CALLS_PER_RUN=16000`, `PLACES_MAX_QPS=8`, `MAP_RANKING_POINTS=all`, `RANK_SAMPLES_PER_POINT=3`, `RANK_SAMPLE_SPACING_SEC=60` (decided 2026-09-27); remove `COMPETITOR_DETAILS_ATMOSPHERE`. Do the Google Cloud checklist (Ranking quality section) before the first monthly refresh.
11. **Phase 10 data cleanup:** delete the old Search Console token rows, which may hold plaintext tokens (the feature was removed in 9a): `db.user_auths.deleteMany({ token_type: "ANALYTICS" })` (back up first, step 1). Check the `roles` collection holds role_id 1 (super admin), 2 (admin) and 4 (editor) as in `SUP_ADM_ROLE_ID` / `ADM_ROLE_ID` / `EDTR_ROLE_ID`: admin permissions are derived from them.
12. **`npm run migrate:email-verified -- --confirm`** (Phase 8.1), **before the new code starts** (step 13). It marks every existing user email-verified and moves `PENDING` / `REVIEWING` → `ACCEPTED`. **Required:** without it, existing users are refused at login (403 `email_not_verified`). Idempotent; it sends no email.
    - The hourly `unverified-cleanup` job deletes only accounts created by the Phase 8.1 signup (they carry a `verification_deadline`), so it can never delete an older account, even before this step.
    - Set `FRONTEND_URL` to the web app's origin: verification links go to `FRONTEND_URL/verify-email?token=…`, and the frontend must have that page.
    - The script also builds the `users.verification_deadline` index (add-only); `db:sync-indexes` (step 6) builds the new `auth_codes` hash index.
13. **Start:** `npm start` (pm2), from the repo root. Check the log for `Agenda jobs defined: …` (including `report-generate, report-email, report-schedule-dispatch, report-retention, unverified-cleanup`) and `Recurring job scheduled: monthly-refresh` / `report-retention` / `unverified-cleanup`.

`--confirm` is needed because the scripts refuse any database other than the local `mps_rebuild` without it. Run every script from the repo root with the target `.env` (or `ENV_FILE`). None of them calls Google.
