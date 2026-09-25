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

### Local MongoDB (Docker)

```sh
docker run -d --name mps-mongo -p 27017:27017 mongo:7
```

`src/configs/mongoConnection.ts` always authenticates with `MONGODB_USER` and `MONGODB_PASSWORD` against `authSource: 'mps_db'`. After starting the container, create a matching user in `mps_db` once:

```sh
docker exec mps-mongo mongosh mps_db --quiet --eval \
  'db.createUser({user:"mps_local_user",pwd:"change-me",roles:[{role:"readWrite",db:"mps_db"}]})'
```

Then set the following in `.env`:

```
MONGODB_URL=mongodb://127.0.0.1:27017/mps_db
MONGODB_USER=mps_local_user
MONGODB_PASSWORD=change-me
```

This must only ever point at a local database. Seed reference data with `npm run mongo-migrate`.

> Status (Phase 1.6): not yet verified. Docker is not installed on the development machine used so far.

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
