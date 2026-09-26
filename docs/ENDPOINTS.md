# Endpoints (rebuilt or new)

Every endpoint built or fixed in the rebuild so far (Phases 5, 6 and 7a). Legacy endpoints that haven't been rebuilt are not listed; they are in [ROUTES.md](ROUTES.md). Full request and response examples are in [API.md](API.md).

## Conventions

**Base URL:** `/api/v1`. Local: `http://localhost:5055/api/v1`.

**Auth:**
- `user`: header `Authorization: Bearer <access token>`. A missing or invalid token gives **401**.
- `owner`: `:locationId` must be one of the caller's own active locations. Otherwise **404**; a malformed id gives **400**.
- `none`: no MyPageSEO login (the Google OAuth callback only).

**Response envelope:** every response is `{ "success": bool, "status": number, "message": string, "data": … }`.

**Common errors:**

| Status | Meaning |
|---|---|
| 400 | Invalid input, or a missing precondition |
| 401 | No or invalid login |
| 404 | Not found, or not yours |
| 409 | Conflict |
| 422 | Run over the call cap |
| 429 | Daily search limit |
| 502 | Google failed |
| 503 | Not configured / GBP access not approved |

---

## Ranking: tracking settings and runs (Phase 5)

| # | Method | Path | Auth | Path params | Query params | Body | Returns |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/locations/:locationId/tracking` | user, owner | `locationId` | – | – | Tracking settings (defaults filled) + the API-call estimate for a run |
| 2 | PUT | `/locations/:locationId/tracking` | user, owner | `locationId` | – | At least one of the fields below | Saved settings, estimate, `keywords_version_bumped`, `onboarding_step` (onboarding locations only) |
| 3 | POST | `/locations/:locationId/rank-runs` | user, owner | `locationId` | – | – | **202** `{ run_id, status, existing, estimate, dev_capped }` |
| 4 | GET | `/locations/:locationId/rank-runs` | user, owner | `locationId` | `page` (default 1), `limit` (default 15, max 100) | – | Run history: `{ runs, page, limit, total }` |
| 5 | GET | `/locations/:locationId/rank-runs/:runId` | user, owner | `locationId`, `runId` | – | – | Run status, timings, `api_calls`, estimate, `errors_count`, `failure_reason` |

**Body fields for #2** (all optional; send at least one):

| Field | Rule |
|---|---|
| `keywords` | string[]: 1–20 keywords, each 2–80 characters. Duplicates are merged ignoring case. Changing the set bumps `keywords_version`. |
| `competitors` | string[]: up to 5 place IDs, not your own. `[]` means none. |
| `grid` | `{ size: 3 \| 5 \| 7, spacing_km: 0.25–5 }` |
| `frequency` | `'auto_monthly'` (default: refreshed monthly) \| `'manual_only'` (only on demand). Sending `next_run_at` is rejected (400). |

**Notes:**
- **#3:** "run now" is a rankings refresh: it shares the **24 h manual-refresh limit** with #25 and returns **429** `{ next_allowed_at }` inside the window. Returns **400** without a `place_id`, without keywords, or when the country is not US/CA; **422** when over `RANK_MAX_CALLS_PER_RUN`. If a run is already active it returns that run with `existing: true` (no limit used). In development the run is capped at 2 keywords and a 3×3 grid.
- **#5:** returns **404** for an unknown run.

## Ranking: report pages (Phase 5)

All three read the latest `done` or `partial` run, or the run given by `runId`.

| # | Method | Path | Auth | Path params | Query params | Returns |
|---|---|---|---|---|---|---|
| 6 | GET | `/locations/:locationId/rank-tracker` | user, owner | `locationId` | `runId` (optional, 24-hex) | **Rank Tracker page:** per keyword, the summary (`avgRank`, `foundRate`, `top3Rate`, `change`, `changeLabel`) and the 5 tracker points; `overall`; `trend` (last 12 runs) |
| 7 | GET | `/locations/:locationId/grid` | user, owner | `locationId` | `runId` (optional), `keyword` (optional, 1–80 chars) | **Local Search Grid page:** grid size and spacing; per keyword, the summary and every point (`row`, `col`, `lat`, `lng`, rank display) |
| 8 | GET | `/locations/:locationId/map-ranking` | user, owner | `locationId` | `runId` (optional), `keyword` (optional), `resolveNames` (optional boolean; only when `STORE_PLACE_NAMES=false`) | **Local Map Ranking page:** per keyword, the top 20 at the location (`rank`, `place_id`, `name`, `is_self`, `target_key`) |

**404** means there is no completed run yet, an unknown `runId`, or a keyword not in the run. **409** means the `runId` isn't finished.

## GBP connection (Phase 6, updated in 7a)

| # | Method | Path | Auth | Query params | Body | Returns |
|---|---|---|---|---|---|---|
| 9 | GET | `/user/auth/google/gbp` | user | – | – | Google consent URL (**redirect flow**, the fallback). One-time `state`, valid 10 minutes. |
| 10 | GET | `/user/auth/google/gbp/callback` | none (Google calls it) | `code`, `state`, `error` (from Google) | – | `{ connected: true, google_email, google_sub }` |
| 11 | GET | `/user/auth/google/gbp/popup` | user | – | – | **Popup flow** config for Google Identity Services: `{ client_id, scope, state, ux_mode: "popup", select_account: true }` |
| 12 | POST | `/user/auth/google/gbp/code` | user | – | `{ code, state }` (from the popup callback) | `{ connected: true, google_email, google_sub }` |
| 13 | POST | `/user/auth/google/gbp/revoke` | user | – | `{ google_sub? }` | **Disconnect one Google account:** `{ revoked, bindings_removed, google_email }` |
| 14 | GET | `/gbp` | user | – | – | Every GBP profile from every connected Google account, grouped: `{ connections: [{ google_sub, google_email, label, status, error, accounts, locations, errors }] }` |
| 15 | POST | `/gbp/bind-with-user` | user | – | `{ location_id, gbpAccountId: "accounts/…", gbpLocationId: "locations/…", google_sub? }` | `{ binding, place_id: { location, gbp, status }, coordinates }` |
| 16 | POST | `/gbp/unbind` | user | – | `{ location_id }` | `{ unbound, jobs_cancelled: { gbp_sync, scheduled_posts }, tokens_deleted }` |

**Notes:**
- **#9:** scopes `openid email business.manage`, with `prompt=select_account consent`.
- **#10:** returns **400** for an unknown, expired or reused state, `error=access_denied`, or an unverifiable Google account. A user can connect **several Google accounts**: a new account is added as its own connection (`google_sub`), and the same account again updates it.
- **#11:** the `state` is valid 10 minutes and works once. Scopes are the same as #9. There is no `prompt` / `access_type` in the popup settings (GIS doesn't support them).
- **#12:** the code is exchanged with `redirect_uri=postmessage`. The state must be a popup state belonging to the caller. Errors as #10.
- **#13:** revokes that Google account at Google (best effort), then removes only its bindings, their scheduled jobs and its tokens. Other connected accounts are untouched. `google_sub` is required when several accounts are connected.
- **#14:** read from Business Information only (no Places calls). Each location includes `address`, `place_id`, `latlng`, `region_code` and `bound_location_id`. Returns **400** if not connected, **503** if GBP access is not approved (quota 0).
- **#15:** you must own the location, and it needs 1 GBP call. `google_sub` is required when several Google accounts are connected. `place_id` is set only if empty (never overwritten; a conflict is reported). lat/lng are filled only if both are empty. Returns **409** if that GBP location is bound to another of your locations.
- **#16:** cancels the location's sync jobs and pending scheduled posts. Deletes that Google account's tokens only if it was that account's last binding. Returns **404** if the location is not bound.

## Onboarding (Phase 7a)

| # | Method | Path | Auth | Path / query params | Body | Returns |
|---|---|---|---|---|---|---|
| 17 | GET | `/onboarding/state` | user | – | – | `{ gbp: { connected, connections: [{ google_sub, google_email, status }] }, locations: [{ location_id, name, onboarding: { step, started_at, completed_at } }] }` |
| 18 | GET | `/onboarding/gbp-profiles` | user | – | – | Same as #14 (grouped per Google account), plus `supported` (US/CA) per location |
| 19 | POST | `/onboarding/select-profile` | user | – | `{ gbpAccountId, gbpLocationId, location_id?, google_sub? }` | `{ location: { location_id, name, address, place_id, lat, lng }, created, center_needed, binding }` |
| 19b | PUT | `/locations/:locationId/center` | user, owner | `locationId` | `{ query }` (city or ZIP, 2–100 chars) | `{ lat, lng, center_source: "manual", center_label, api_calls, onboarding_step? }` |
| 20 | GET | `/locations/:locationId/competitor-suggestions` | user, owner | `locationId`; query `refresh` (optional boolean) | – | `{ generated_at, cached, keywords_used, api_calls, suggestions: [{ place_id, name, address, rating, userRatingCount, best_position, keywords, already_selected }] }` |
| 21 | GET | `/places/search` | user, owner (via `locationId`) | query `q` (required, 2–100 chars), `locationId` (required, 24-hex) | – | `{ results: [{ place_id, name, address }], api_calls }` |
| 22 | POST | `/onboarding/complete` | user | – | `{ location_id }` | `{ completed, completed_at, rank_run: { run_id, status, existing }, gbp_sync: { sync_id, status, existing } \| { error }, refresh: { anchor_day, next_refresh_at } }` |

**Notes:**
- **#17:** use it to resume. Each connection's `status` is `active` or `revoked` (reconnect). `step` goes `profile_selected` → (`center_needed` → `center_set`, service-area only) → `keywords_set` → `competitors_set` → `completed`.
- **#19:** links `location_id` if given, else your location with the same place ID, else creates a new Location from the profile. Then it binds (1 GBP call). `google_sub` is required with several Google accounts. `center_needed: true` means the profile has no coordinates (service-area business), so #19b comes next. Returns **400** for a non-US/CA profile or one the account can't access, **404** if `location_id` is not yours.
- **#19b:** resolves a city or ZIP once: 1 Places Text Search (IDs-only, free SKU) + 1 Place Details (`location` only), counted against the daily Places limit. It saves the location's lat/lng with `center_source: "manual"`. Rank runs and suggestions then use it. Returns **404** if nothing is found, **429** at the daily limit, **502** if Google failed.
- **#20:** top 10 competitors across your keywords. 1 Places Enterprise search per keyword (2 in development). Cached 24 hours per keyword set. Returns **400** with no keywords or no coordinates, **429** at the daily limit, **502** if every search failed.
- **#21:** 1 Places Pro call, up to 10 results near the location, excluding the location itself. Returns **404** if `locationId` is not yours, **429** at the daily limit.
- **#22:** needs a bound profile, a center (lat/lng) and at least 1 keyword. It queues the first rank run **and the first GBP sync**, and sets the monthly refresh (the setup day of the month, clamped to 28, at about 03:00 local). Calling it again returns the same state. Returns **422** if the run is over the call cap.

**Onboarding keywords and competitors** use the ranking endpoint #2 (`PUT /locations/:locationId/tracking`). Sending `keywords` moves the step to `keywords_set` (except while it is `center_needed`); sending `competitors` (even `[]`) moves it to `competitors_set`.

**Daily Places limit:** #19b, #20 and #21 share `PLACES_USER_DAILY_LIMIT` (default 50) calls per user per UTC day.

---

## Refresh and GBP sync (Phase 7b)

Every location refreshes **automatically once a month** (rankings, then the GBP sync if connected). Users can also refresh on demand, at most once per 24 h per type.

| # | Method | Path | Auth | Params / body | Returns |
|---|---|---|---|---|---|
| 25 | POST | `/locations/:locationId/refresh` | user, owner | body `{ types?: ["rankings","gbp"] }` (default: rankings, plus gbp when connected) | **202** `{ rankings: { run_id, status, existing, estimate, next_allowed_at } \| { skipped: 'rate_limited', next_allowed_at }, gbp: { sync_id, status, existing, estimated_calls, next_allowed_at } \| { skipped: 'gbp_not_connected' \| 'rate_limited', next_allowed_at } }` |
| 26 | GET | `/locations/:locationId/refresh` | user, owner | – | Button state: `{ frequency, gbp_connected, next_refresh_at, last_auto_refresh_at, rankings: { next_allowed_at, active_run }, gbp: { next_allowed_at, active_sync, last_synced_at } \| null }` |
| 27 | GET | `/locations/:locationId/gbp/sync` | user, owner | query `syncId?` (24-hex) | `{ gbp_connected, sync: { sync_id, status, trigger, backfill, run_at, started_at, finished_at, duration_ms, types, api_calls, failure_reason } \| null, last_synced_at }` |

**Notes:**
- **#25:** **429** only when every requested type is rate-limited; the body still has `next_allowed_at` per type, so the button can say when it's available again. An in-progress run or sync is returned (`existing: true`) without using the limit. **400** for an unknown type; **422** if the rank run is over the call cap.
- **#26:** `next_allowed_at` is `null` when the type can be refreshed now.
- **#27:** `types` has one entry per data type (`performance`, `keywords`, `profile`, `verification`, `reviews`, `media`, `posts`), each `{ status: pending | ok | error | not_available | skipped, message, rows, range }`. Reviews, media and posts are `not_available` (`v4_access_pending`) until Google approves v4 access. Sync `status`: `queued`, `running`, `done`, `partial` (some types failed) or `failed`.

## Not listed here

- **GBP posting** (`/gbp/post/*`): still legacy. Only its token lookup changed (it now uses the binding's Google account); it is rebuilt in Phase 8.
- **Removed** in the legacy cleanup: the old ranking routes (`/rank-tracker`, `/local-search-grid`, `/local-map-ranking`), `/gbp-audit`, `/reputation-manager`, the white-label report links and the Search Console connect. See [LEGACY_FEATURES.md](LEGACY_FEATURES.md).
- **Everything else** (auth, locations CRUD, payments, citations, …): unchanged. See [ROUTES.md](ROUTES.md).
