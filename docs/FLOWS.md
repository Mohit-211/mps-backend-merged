# Core flows (API call sequences)

For the frontend developer. Each flow is the exact order of API calls the app makes, with the fields that matter. These sequences are run end to end by `tests/flows/flows.test.ts` (in-memory database; Google, PayPal and email mocked), so they are known to work as written.

- Every path is under `/api/v1`. Signed-in calls send `Authorization: Bearer <access token>`.
- Full request and response shapes: [API.md](API.md). Every endpoint: [ENDPOINTS.md](ENDPOINTS.md). Which screen uses what: [FRONTEND_BACKEND_MAP.md](FRONTEND_BACKEND_MAP.md).
- Errors carry `data.reason` (e.g. `agency_only`, `subscription_required`); build UI states on the reason, not on the message.
- Emails: locally (`EMAIL_TRANSPORT=log`) nothing is sent; the backend log shows each email's link (verify, reset, invitation), so you can open it by hand.

## 0. Sign up, verify, sign in (Business and Agency)

| # | Call | Send | Get |
|---|---|---|---|
| 1 | `POST /auth/signup` | `{ account_type: "business" \| "agency", name, email, password, organization_name, country: "US" \| "CA", accept_terms: true }` | **201** `{ user_id, organization_id, email_verification: "sent", verify_before }` |
| 2 | (the user opens the email link `FRONTEND_URL/verify-email?token=…`) | | |
| 3 | `POST /auth/verify-email` | `{ token }` | `{ verified: true, already_verified: false, tokens: { access, refresh }, user, organizations, current_organization_id, onboarding }`: **signed in**, continue to onboarding |
| – | `POST /auth/login` before verifying | `{ email, password }` | **403** `{ reason: "email_not_verified", resend }` → offer `POST /auth/resend-verification { email }` |
| 4 | `POST /auth/login` (any later visit) | `{ email, password }` | the same session shape as 3 |

Keep both tokens. On a 401 call `POST /auth/refresh { refresh_token }` once and store both returned tokens (the refresh token rotates). Forgot password: `POST /auth/forgot-password { email }` → the link opens `/reset-password?token=…` → `POST /auth/reset-password { token, password, confirm_password }` (errors `link_expired`, `link_invalid`, `passwords_do_not_match`).

## 1. Business: first location to first report

| # | Call | Send | Get |
|---|---|---|---|
| 1 | `GET /onboarding/state` | | which step to show |
| 2 | `GET /places/search?q=<name city>&country=US` | | `{ results: [{ place_id, name, address, already_added }] }` (one Places call; daily cap per user) |
| 3 | `POST /locations` | `{ place_id }` | **201** `{ location: { location_id, name, source: "places_search", gbp_connected: false, … }, api_calls }`; **409** `duplicate_place` (with its `location_id`) |
| 4 | `PUT /locations/:locationId/tracking` | `{ keywords: ["plumber", "emergency plumber"] }` | tracking + `onboarding_step: "keywords_set"` |
| 5 | `GET /locations/:locationId/competitor-suggestions` (optional) | | up to 10 nearby businesses |
| 6 | `PUT /locations/:locationId/tracking` | `{ competitors: ["<place_id>", …] }` (max 5) | `onboarding_step: "competitors_set"` |
| 7 | `POST /onboarding/complete` | `{ location_id }` | `{ completed: true, rank_run: { run_id, status: "queued" }, refresh: { anchor_day, next_refresh_at } }` |
| 8 | poll `GET /locations/:locationId/rank-runs/:runId` | | until `status` is `done` or `partial` (a run takes minutes; the pages answer **404** "no run yet" until the first run is done) |
| 9 | `GET /locations/:locationId/rank-tracker`, `/grid`, `/map-ranking`, `/overview` | | the three ranking pages and the location overview |
| 10 | `GET /locations/:locationId/gbp/report?range=28d` | | the GBP report; without GBP the private sections are `{ available: false, reason: "gbp_not_connected" }` and the public competitor comparison is filled |
| 11 | `GET /dashboard` | | the Business dashboard |

A Business account has no clients: `POST /clients` → **403** `{ reason: "agency_only" }` (hide the Clients menu for `type: "business"`).

To connect GBP later for this location, use the Google connect of flow 2 and `POST /onboarding/select-profile { gbpAccountId, gbpLocationId, location_id }` (the profile's `place_id` must match, else **409** `place_id_mismatch`).

## 2. Agency: clients and locations

| # | Call | Send | Get |
|---|---|---|---|
| 1 | `POST /clients` (twice) | `{ name: "Client A" }`, `{ name: "Client B" }` | **201** `{ client_id, name, locations_count: 0, avg_rank: null, … }` |
| 2 | **Places search path** (as flow 1, steps 2–3) with the client | `POST /locations { place_id, client_id }` | `location.client: { client_id, name }` |
| 3 | **GBP path: connect Google** | `GET /gbp/connect/popup` | `{ client_id, scope, state, ux_mode: "popup", select_account: true }` → open the Google Identity Services code client with these |
| 4 | | `POST /gbp/connect/code { code, state }` (from the popup callback) | `{ connected: true, google_email, google_sub }` |
| 5 | | `GET /onboarding/gbp-profiles` | `{ connections: [{ google_sub, google_email, label, status: "ok" \| "revoked" \| "error", locations: [{ gbpAccountId, gbpLocationId, title, address, place_id, region_code, supported, bound_location_id, … }] }] }` (show `supported: false` profiles greyed out: only US and CA) |
| 6 | | `POST /onboarding/select-profile { gbpAccountId, gbpLocationId, client_id, google_sub? }` (the values of the chosen profile) | `{ location: { location_id, … }, created: true, center_needed, binding }` (`google_sub` only when several Google accounts are connected). If `center_needed`, `PUT /locations/:id/center { query: "<city or ZIP>" }` first. |
| 7 | Keywords, competitors, complete | as flow 1, steps 4–8, for each location | |
| 8 | **Reassign** a location to the other client | `PATCH /locations/:locationId { client_id }` | the location header with the new `client` |
| 9 | **Unassign** | `DELETE /clients/:clientId/locations/:locationId` | `{ unassigned: true }`; the location stays in the organization with `client: null` |
| 10 | **Assign** (e.g. from the client page) | `POST /clients/:clientId/locations { location_id }` | `{ assigned: true, client_id, location_id }` |
| 11 | Client page | `GET /clients/:clientId` | `{ client, locations: [row], summary: { locations, avg_rank, avg_gbp_score, gbp_connected } }` (averages over the client's locations with data) |
| 12 | Lists | `GET /clients`, `GET /locations?client_id=…` | |

## 3. Agency: a client user for one client

| # | Who | Call | Send | Get |
|---|---|---|---|---|
| 1 | owner | `POST /organization/invitations` | `{ email, role: "client_user", client_ids: ["<client A>"] }` | **201**; the invitee gets `FRONTEND_URL/invite?token=…` |
| 2 | invitee | `POST /auth/invitations/inspect` | `{ token }` | `{ organization, email, role, status, expires_at, account_exists }` |
| 3 | invitee | `POST /auth/invitations/accept` | new account: `{ token, name, password }`; existing account: `{ token }` | new account: a session (signed in, email verified); existing: `login_required: true` |
| 4 | client user | `GET /locations`, `GET /clients`, `GET /reports`, `GET /dashboard` | | only client A's locations, reports and client |

A client user is **read-only** and sees only its clients: another client's location is **404**; every change (`PUT …/tracking`, `POST /locations`, `POST /reports`, `POST …/refresh`, `POST /clients`, invitations) is **403**. It can open the ranking pages, the GBP report and report PDFs of its clients.

## 4. Limits and billing

| # | Call | Send | Get |
|---|---|---|---|
| 1 | `GET /billing` | | `{ state: "trialing", locations: { allowed: 1, … }, users, tokens, trial_ends_at, … }` |
| 2 | `POST /locations` beyond the trial allowance | | **402** `{ reason: "subscription_required" }` → the billing page |
| 3 | `POST /billing/checkout` | | **201** `{ approve_url, quantity, currency, monthly_amount }` → redirect to PayPal (quantity = the active locations, at least 1) |
| 4 | (return page) `POST /billing/sync` | | the subscription as PayPal reports it; PayPal's webhooks make it `active` |
| 5 | `POST /locations` at the paid quantity | | **402** `{ reason: "location_payment_required", quote: { quantity, amount, currency, period_end, … } }`; above 20 locations **403** `enterprise_required` |
| 6 | `POST /billing/location-slots` | `{ quantity: 1 }` | **201** `{ approve_url, provider_order_id, amount }` → PayPal |
| 7 | (return page) `POST /billing/orders/:orderId/capture` | | `{ status: "captured", billing: { locations: { allowed } } }` (idempotent) |
| 8 | retry `POST /locations` | | **201** |
| 9 | `POST /organization/invitations` over the user limit | | **403** `{ reason: "user_limit_reached", used, limit }`: 3 users per paid location, pooled, owner included; existing members keep access |

**After the trial without a subscription** the organization is read-only: money-costing actions (add location, tracking changes, refresh, run now, new reports, Places search, GBP connect) answer **402** `{ reason: "subscription_required" }`; reads (locations, pages, reports, dashboard, billing, invoices) keep working. Show the billing call to action on a 402.

**Manual refresh costs tokens:** `POST /locations/:id/refresh` → **402** `{ reason: "insufficient_tokens", balance, cost }`; token packs: `GET /billing/token-packs`, `POST /billing/tokens/checkout`.

**Known awkward step (open, 2026-09-29):** a trial user who already wants two locations subscribes for one (checkout uses the active count) and then pays a prorated slot for the second. See STATUS.md "Open items".
