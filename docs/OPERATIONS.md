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

`src/configs/mongoConnection.ts` authenticates with `MONGODB_USER` / `MONGODB_PASSWORD` against `MONGODB_AUTH_SOURCE`. That variable defaults to `mps_db` so existing deployments are unchanged. Locally it is `mps_rebuild`.

**Default: Homebrew** (MongoDB Community 7.0, a brew service on `127.0.0.1:27017`):

```sh
brew tap mongodb/brew
# Homebrew 7 asks you to trust third-party formulae. The install reads these four:
brew trust --formula mongodb/brew/mongodb-community@7.0 mongodb/brew/mongodb-database-tools \
                     mongodb/brew/mongodb-enterprise mongodb/brew/mongodb-community
brew install mongodb-community@7.0
brew services start mongodb/brew/mongodb-community@7.0
mongosh mps_rebuild --quiet --eval \
  'db.createUser({user:"mps_local",pwd:"mps_local_pw",roles:[{role:"readWrite",db:"mps_rebuild"}]})'
```

`.env`:

```
MONGODB_URL=mongodb://127.0.0.1:27017/mps_rebuild
MONGODB_USER=mps_local
MONGODB_PASSWORD=mps_local_pw
MONGODB_AUTH_SOURCE=mps_rebuild
```

**Alternative: Docker**

```sh
docker run -d --name mps-mongo -p 127.0.0.1:27017:27017 mongo:7
docker exec mps-mongo mongosh mps_rebuild --quiet --eval \
  'db.createUser({user:"mps_local",pwd:"mps_local_pw",roles:[{role:"readWrite",db:"mps_rebuild"}]})'
```

Use the same `.env` values.

Mongoose creates the collections and model indexes on first start. Seed reference data (roles, countries, and so on) with `npm run mongo-migrate`.

On a healthy start the log shows:
- "Mongo has connected successfully"
- "Mongoose connection opened successfully"

It should also show "Agenda has started and is processing jobs." **That line currently never appears; see AUDIT C25.**

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
