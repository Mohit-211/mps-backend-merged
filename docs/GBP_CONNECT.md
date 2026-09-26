# Connecting Google Business Profile (local)

For Mohit: how to set up Google Cloud and `.env`, then connect MyPageSEO's Business Profile to the local backend (Phase 6). Endpoint shapes are in [API.md](API.md#gbp-connection-phase-6).

**Live-call rules (Phases 6–7):** GBP calls are free but quota-limited. The client keeps them at **5 requests/second or fewer**, only against the account you connect. Nothing runs live until you say so; the first live step is `gbp:preflight`, which you trigger.

## 1. Google Cloud

1. **Enable APIs** (APIs & Services → Library):
   - My Business Account Management API
   - My Business Business Information API
   - For Phase 7 (not needed yet): Business Profile Performance API, My Business Verifications API, Google My Business API
2. **OAuth consent screen:**
   - User type **External**, publishing status **Testing**.
   - Add the Google account that manages MyPageSEO's profile as a **test user**.
   - Scope: `https://www.googleapis.com/auth/business.manage` (the only one the app asks for).
3. **Credentials** → Create credentials → OAuth client ID → **Web application**.
   - Authorised redirect URI: **`http://localhost:5055/api/v1/user/auth/google/gbp/callback`**
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

## 3. Connect MyPageSEO

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
   - The consent screen asks to **"See, edit, create and delete your Google business listings"**. That is the only permission requested. Allow it.
5. Google redirects to the callback. The browser shows:
   ```json
   {"success":true,"status":200,"message":"Connected with GBP successfully.","data":{"connected":true}}
   ```
   The callback stores the tokens (encrypted) and makes no Business Profile calls.
6. **Preflight** (you run it; read-only):
   ```sh
   npm run gbp:preflight -- <userId>
   ```
   Expected output, names and IDs only:
   ```
   User:       live-test@mypageseo.test (is_gbp_connected=true)
   Token:      stored, status=active, expires 2026-…
   Accounts:   1
   accounts/…  <account name>  type=PERSONAL role=PRIMARY_OWNER
      locations/…  Mypageseo  place_id=ChIJneho2koPp0wRIbUtaCCIReA
   Result:     OK: 1 accounts, 1 locations
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

## Undo

| Action | Endpoint |
|---|---|
| Unbind one location | `POST /api/v1/gbp/unbind {"location_id": "…"}`. Removes the binding and cancels its scheduled jobs. Deletes the tokens if it was your last binding. |
| Disconnect entirely | `POST /api/v1/user/auth/google/gbp/revoke`. Revokes at Google, then removes all bindings and tokens. |
| Remove access from the Google side | [myaccount.google.com/permissions](https://myaccount.google.com/permissions) |

## Existing connections (servers with old data)

Connections made before Phase 6 have plaintext tokens. Each is re-encrypted on first use. To encrypt them all at once:
1. Back up `user_auths`.
2. With `TOKEN_ENCRYPTION_KEY` and the target database's `MONGODB_*` set, run `npm run gbp:encrypt-tokens`.

It is idempotent (already-encrypted values are skipped) and never prints tokens.
