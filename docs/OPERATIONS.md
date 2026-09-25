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

`src/configs/mongoConnection.ts` always authenticates with `MONGODB_USER` and `MONGODB_PASSWORD` against `authSource: 'mps_db'`, so the user must exist in the `mps_db` database. Local development must only ever point at a local database.

**Default: Homebrew** (MongoDB Community 7.0, runs as a brew service on `localhost:27017`):

```sh
brew tap mongodb/brew
brew install mongodb-community@7.0
brew services start mongodb-community@7.0
mongosh mps_db --quiet --eval \
  'db.createUser({user:"mps_local",pwd:"mps_local_pw",roles:[{role:"readWrite",db:"mps_db"}]})'
```

`.env`:

```
MONGODB_URL=mongodb://127.0.0.1:27017/mps_db
MONGODB_USER=mps_local
MONGODB_PASSWORD=mps_local_pw
```

**Alternative: Docker**

```sh
docker run -d --name mps-mongo -p 27017:27017 mongo:7
docker exec mps-mongo mongosh mps_db --quiet --eval \
  'db.createUser({user:"mps_local",pwd:"mps_local_pw",roles:[{role:"readWrite",db:"mps_db"}]})'
```

Use the same `.env` values.

Seed reference data with `npm run mongo-migrate`. On a healthy start the log shows "Mongo has connected successfully" and "Agenda has started and is processing jobs."

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
