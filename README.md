# MyPageSEO backend

The backend of MyPageSEO: a local SEO platform for US and Canadian businesses and agencies, focused on Google Maps / Google Business Profile visibility. It covers rank tracking (Rank Tracker, Local Search Grid, Local Map Ranking), the GBP report, citations, a reports center, organizations and teams, and billing.

Node.js + TypeScript + Express + MongoDB (Mongoose), background jobs on agenda, run with pm2.

## Start here

1. [docs/STATUS.md](docs/STATUS.md): the current state and the next step.
2. [docs/PROJECT_SUMMARY.md](docs/PROJECT_SUMMARY.md): what's built, what works, what doesn't, what's left.
3. [CLAUDE.md](CLAUDE.md): the rules and every phase's spec.

Reference: [docs/ENDPOINTS.md](docs/ENDPOINTS.md) (every endpoint), [docs/API.md](docs/API.md) (examples), [docs/FRONTEND_BACKEND_MAP.md](docs/FRONTEND_BACKEND_MAP.md) (screens → endpoints), [docs/OPERATIONS.md](docs/OPERATIONS.md) (setup, jobs, deploy checklist).

## Quick start

```sh
cp .env.example .env   # fill in local values (local MongoDB database mps_rebuild)
npm ci
npm run build          # TypeScript → build/
npm test               # offline: no API keys, in-memory MongoDB
npm run dev            # http://localhost:<PORT>/api/healthcheck
```

Demo data without any API key: `npm run seed:demo-orgs`. Full setup and every script: [docs/OPERATIONS.md](docs/OPERATIONS.md).
