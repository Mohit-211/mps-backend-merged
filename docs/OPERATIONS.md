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

## Ranking jobs

| Job | When | What |
|---|---|---|
| `rank-run` | Queued by "run now" (`POST /locations/:id/rank-runs`) or by the scheduler. Job data is `{ run_id }` only. Concurrency 2 per process, 35-minute lock. | Runs one RankRun: center, then tracker and grid searches, then the map list, metrics, change, and save. Logs `rank-run <id>: <status> ids_only=… pro=… details=…`. |
| `rank-scheduler` | Every 15 minutes (`agenda.every`), one process at a time | Fails runs that have been `running` for more than 30 minutes, or `queued` for more than 30 minutes. Enqueues due `weekly` / `monthly` locations that have at least one keyword, and advances their `next_run_at`. `manual` locations are never scheduled. |

**Limits**
- One queued or running run per location, enforced by a unique index.
- A run is rejected (422) when its estimated maximum IDs-only calls exceed `RANK_MAX_CALLS_PER_RUN` (default 3200).
- In development, runs use at most `RANK_DEV_MAX_KEYWORDS` (2) keywords and a 3×3 grid.
- `STORE_PLACE_NAMES` (default `true`) controls whether Map Ranking business names are stored.

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

## Optional third-party credentials

| Variable | Used by | If unset |
|---|---|---|
| `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` | legacy rank tracker search volume (`helpers/rankTrackerReport.ts`) | `getKeywordSearchVolume` returns `null` and keyword volumes are reported as 0 |
