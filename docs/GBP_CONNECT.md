# Connecting Google Business Profile (local)

For Mohit and the frontend: how to set up Google Cloud and `.env`, then connect a Business Profile.
- **Phase 7a:** the account-chooser popup and onboarding.
- **Phase 6:** the redirect fallback.

Endpoint shapes are in [API.md](API.md#gbp-connection-phase-6) and [API.md](API.md#onboarding-phase-7a).

**Live-call rules (Phases 6–7):** GBP calls are free but quota-limited. The client keeps them at **5 requests/second or fewer**, only against the account you connect. Nothing runs live until you say so; the first live step is `gbp:preflight`, which you trigger.

## 1. Google Cloud

1. **Enable APIs** (APIs & Services → Library):
   - My Business Account Management API
   - My Business Business Information API
   - For Phase 7 (not needed yet): Business Profile Performance API, My Business Verifications API, Google My Business API
2. **OAuth consent screen:**
   - User type **External**, publishing status **Testing**.
   - Add the Google account that manages MyPageSEO's profile as a **test user**.
   - Scopes: `openid`, `email` and `https://www.googleapis.com/auth/business.manage`.
   - Any Google account may connect.
3. **Credentials** → Create credentials → OAuth client ID → **Web application**.
   - Authorised redirect URI (the redirect fallback): **`http://localhost:5055/api/v1/user/auth/google/gbp/callback`**
   - Authorised JavaScript origin (the popup): the frontend's origin, e.g. `http://localhost:3000`.
   - Copy the client ID and secret.
4. **GBP API access:** Google only allows GBP API calls after the project is approved through its GBP API access request. Until then every call gets a quota of 0, and `gbp:preflight` reports exactly "GBP API access not approved (quota 0)".

## 2. `.env`

| Variable | Value |
|---|---|
| `GOOGLE_GBP_CLIENT_ID` | the OAuth client ID (`….apps.googleusercontent.com`) |
| `GOOGLE_GBP_CLIENT_SECRET` | the OAuth client secret |
| `GOOGLE_GBP_REDIRECT_URI` | `http://localhost:5055/api/v1/user/auth/google/gbp/callback`. Must match Google Cloud exactly, including the port. |
| `TOKEN_ENCRYPTION_KEY` | 64 hex characters. Generate one with `openssl rand -hex 32` |
| `GBP_MAX_RPS` | optional, default `5` |

- `TOKEN_ENCRYPTION_KEY` encrypts stored Google tokens (AES-256-GCM). If it is lost or changed, stored tokens can't be read and users must reconnect. It is required in production.
- Without it in development, the server starts, and GBP endpoints answer "not configured".
- Never commit `.env`.

## 3. Connect with the account-chooser popup (Phase 7a, recommended)

The frontend uses the Google Identity Services **code client** in popup mode. Google shows the browser's signed-in accounts, and the user may pick any of them.

```html
<script src="https://accounts.google.com/gsi/client" async></script>
```

```js
// 1. When the connect screen opens (the state is valid for 10 minutes and works once):
const cfg = (await api.get('/api/v1/user/auth/google/gbp/popup')).data.data;
// cfg = { client_id, scope: "openid email …/business.manage", state, ux_mode: "popup", select_account: true }

const codeClient = google.accounts.oauth2.initCodeClient({
  ...cfg,
  callback: async ({ code, state, error }) => {
    if (error) return showError(error);                 // e.g. the user closed the popup
    const res = await api.post('/api/v1/user/auth/google/gbp/code', { code, state });
    const { google_email, google_sub } = res.data.data;
    showConnected(google_email);                        // "Connected as x@gmail.com"; keep google_sub for bind/disconnect
  },
});

// 2. On the button click (it must be a user gesture, or popup blockers step in):
connectButton.onclick = () => codeClient.requestCode();
```

**Notes for the frontend:**
- Fetch a new config if the screen stays open for more than 10 minutes, or after a failed attempt (each state works once).
- `POST /code` needs the user's MyPageSEO token, and the state must belong to that user.
- **Settings:** `select_account: true` shows the account chooser. GIS's code client has no `prompt` / `access_type` options.
  - The code flow returns a refresh token on the first consent.
  - If Google omits it on a same-account reconnect, the stored one is kept.
  - For a new account without one, the API returns 400 asking the user to remove access at myaccount.google.com/permissions and retry.
- **Several Google accounts** (agencies): the same button connects another account.
  - Each Google account is its own *connection* (`google_sub`, shown as "Connected as …"). Connecting the same account again just updates it.
  - Pass `google_sub` when binding (`select-profile`, `bind-with-user`) or disconnecting once more than one account is connected.
  - Disconnect (`POST /user/auth/google/gbp/revoke { google_sub }`) removes only that account and its bound profiles; the others keep working.

After connecting, the onboarding screens call, in order:
1. `GET /onboarding/gbp-profiles` (grouped per Google account)
2. `POST /onboarding/select-profile` (with the profile's `google_sub`)
   - **If the response says `center_needed: true`** (a service-area business with no address), ask for a city or ZIP: `PUT /locations/:id/center { query }`. That is 2 Places calls, resolved once.
3. `PUT /locations/:id/tracking` (keywords)
4. `GET /locations/:id/competitor-suggestions` (and optionally `GET /places/search`)
5. `PUT /locations/:id/tracking` (competitors)
6. `POST /onboarding/complete`

`GET /onboarding/state` lets the app resume at the right step. See [API.md](API.md#onboarding-phase-7a).

## 3a. Popup connect without the frontend (development test page)

`GET /dev/gbp-connect` is a minimal page that runs the same popup flow as §3. It is mounted **only when `NODE_ENV=development`** (never in test or production) and listed in [ENDPOINTS.md](ENDPOINTS.md) as `dev only`.

**One-time setup:**
- In Google Cloud → the OAuth client → **Authorised JavaScript origins**, add `http://localhost:<PORT>` (e.g. `http://localhost:5055`). Without it the popup shows `origin_mismatch` / `redirect_uri_mismatch`.
- `.env` has `TOKEN_ENCRYPTION_KEY` (64 hex characters, e.g. from `openssl rand -hex 32`); the connect fails without it because tokens are stored encrypted.
- `.env` `ACCESSDOMAINS` includes `http://localhost:<PORT>` (comma-separated, e.g. `http://localhost:3000,http://localhost:5055`). Browsers send an `Origin` header on the page's POST, and an unlisted origin is rejected with "Origin not allowed by CORS".
- The popup flow doesn't use `GOOGLE_GBP_REDIRECT_URI` (the code is exchanged with `postmessage`); only the redirect fallback (§4) does.

**Use:**
1. `npm run dev`, then `npm run setup:live-test -- --token-only --token-file <scratch dir>/live_token`.
2. Open `http://localhost:<PORT>/dev/gbp-connect` and paste the token (kept in the page's memory only).
3. **1. Prepare** calls `GET /user/auth/google/gbp/popup` (no Google calls). **2. Connect** opens Google's account chooser and consent; the page then calls `POST /user/auth/google/gbp/code` and shows `{ connected: true, google_email, google_sub }`.
4. **3. List profiles** (optional) calls `GET /onboarding/gbp-profiles`: 1 accounts call + 1 locations call per account.

Each state works once and lasts 10 minutes: click **Prepare** again before connecting another account.

## 4. Connect MyPageSEO locally (redirect fallback)


1. Start the server: `npm run dev`.
2. Get a login token for the live-test user from Phase 5.5. This refreshes the token only; the location and runs are kept.
   ```sh
   npm run setup:live-test -- --token-only --token-file <scratch dir>/live_token
   TOKEN=$(cat <scratch dir>/live_token)
   ```
   It prints the user id (for preflight) and the MyPageSEO location id.
3. Get the consent URL:
   ```sh
   curl -s http://localhost:5055/api/v1/user/auth/google/gbp -H "Authorization: Bearer $TOKEN"
   ```
   `data` is a `https://accounts.google.com/o/oauth2/v2/auth?...` URL. The link is valid for **10 minutes** and works **once**.
4. **Open the URL in a browser** and sign in with the Google account that manages MyPageSEO.
   - Because the app is in testing mode, Google shows **"Google hasn't verified this app"**. Choose *Continue*.
   - The consent screen asks to **"See, edit, create and delete your Google business listings"**, plus your email address. Allow it.
5. Google redirects to the callback. The browser shows:
   ```json
   {"success":true,"status":200,"message":"Connected with GBP successfully.","data":{"connected":true,"google_email":"you@gmail.com","google_sub":"…"}}
   ```
   The callback stores the tokens (encrypted) and makes no Business Profile calls.
6. **Preflight** (you run it; read-only):
   ```sh
   npm run gbp:preflight -- <userId>
   ```
   Expected output, names and IDs only:
   ```
   User:       live-test@mypageseo.test (is_gbp_connected=true)

   === Connected as you@gmail.com  status=active  expires 2026-…
   Accounts:   1

   accounts/…  <account name>  type=PERSONAL role=PRIMARY_OWNER
      locations/…  Mypageseo  place_id=ChIJneho2koPp0wRIbUtaCCIReA

   Result:     OK: 1 Google account(s), 1 locations
   API calls:  2 {"accounts.list":1,"locations.list":1}
   ```
   Other results:

   | Message | Meaning |
   |---|---|
   | `GBP API access not approved (quota 0)` | The Cloud project is not approved yet (exit code 3). |
   | `API not enabled: …` | Enable the named API in the project. |
   | `Not connected` / `Reconnect needed` | Redo step 3. |
   | `Server not configured: …` | A `.env` value is missing. |

7. **Bind** the GBP location to our MyPageSEO location:
   ```sh
   curl -s http://localhost:5055/api/v1/gbp -H "Authorization: Bearer $TOKEN"        # every location, all accounts
   curl -s -X POST http://localhost:5055/api/v1/gbp/bind-with-user -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' \
     -d '{"location_id":"<MyPageSEO location id>","gbpAccountId":"accounts/…","gbpLocationId":"locations/…"}'
   ```
   `data.place_id.status` should be `match`: the location already has `ChIJneho2koPp0wRIbUtaCCIReA` from Phase 5.5. A `conflict` means Google's place ID differs; it is reported and never overwritten.

## 5. First GBP sync (Phase 7b)

Once a location is bound, its GBP data is fetched in a job (pages never call Google).

**For a new location (onboarding):** `POST /onboarding/complete` queues the first rank run **and** the first GBP sync, and sets the monthly refresh.

**For MyPageSEO (the live-test location, already set up):** to fetch GBP data only (no Places calls), queue a GBP-only refresh:

```sh
curl -s -X POST http://localhost:5055/api/v1/locations/<location id>/refresh -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"types":["gbp"]}'
curl -s http://localhost:5055/api/v1/locations/<location id>/gbp/sync -H "Authorization: Bearer $TOKEN"   # repeat until done / partial / failed
```

**What the first sync fetches** (the backfill):

| Data type | Content | Calls |
|---|---|---|
| performance | 18 months of daily metrics (impressions by surface and device, calls, website clicks, directions, …) | 1 |
| keywords | search keywords for the last 6 complete months (values or "< N" thresholds) | 1 per month (+ pages) |
| profile | full profile, attributes, pending Google edits | 3 |
| verification | Voice of Merchant state | 1 |

- **Total:** about **11 GBP calls** (free, quota-limited, ≤ 5/s), plus 1 token refresh if needed.
- **Reviews, media and posts** show `not_available` (`v4_access_pending`) until Google approves v4 access and `GBP_V4_ENABLED=true` is set.
- **Later syncs** (monthly, or a manual refresh at most once per 24 h) fetch a rolling 40 days of performance and the last 2 months of keywords.
- **"Reconnect needed"** in a type's `message` means the Google authorisation was revoked. **"GBP API access not approved (quota 0)"** means the Cloud project is not approved yet.

The live-test location is `frequency: manual_only`, so it never refreshes by itself.

## Undo

| Action | Endpoint |
|---|---|
| Unbind one location | `POST /api/v1/gbp/unbind {"location_id": "…"}`. Removes the binding and cancels its scheduled jobs. Deletes that Google account's tokens if it was that account's last binding. |
| Disconnect one Google account | `POST /api/v1/user/auth/google/gbp/revoke {"google_sub": "…"}` (`google_sub` is optional with a single account). Revokes that account at Google, then removes only its bindings, their jobs and its tokens. |
| Remove access from the Google side | [myaccount.google.com/permissions](https://myaccount.google.com/permissions) |

## Existing connections (servers with old data)

Connections made before Phase 6 have plaintext tokens. Each is re-encrypted on first use. To encrypt them all at once:
1. Back up `user_auths`.
2. With `TOKEN_ENCRYPTION_KEY` and the target database's `MONGODB_*` set, run `npm run gbp:encrypt-tokens`.

It is idempotent (already-encrypted values are skipped) and never prints tokens.
