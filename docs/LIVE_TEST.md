# Live test checklist: first real Places API run

For Mohit, once a `GOOGLE_PLACE_API_KEY` exists. Until then, everything runs offline: tests and `seed:rank-demo` make **no** Google calls. Follow the steps in order, and stop at the first surprise.

## Before you start

- **The key:** a Places API **(New)** key.
  - Google Cloud Console → APIs & Services → Credentials. Set **API restrictions** to *Places API (New)* only.
  - Add a **budget alert** and **per-day quotas** (for example 500 Text Search requests per day) before using it.
- **Local `.env`:**
  - `GOOGLE_PLACE_API_KEY=<key>`
  - `NODE_ENV=development`, which caps every run to **2 keywords and a 3×3 grid**
  - `MONGODB_*` pointing at `mps_rebuild`
- **Never** commit `.env` or paste the key anywhere. The code never logs it.
- **Terminal 1:** `npm run dev`. Check that the log shows "Agenda has started and is processing jobs".
- **Terminal 2:** everything below.

## Step 1: `smoke:places` (1 call)

Pick a real business you can check on Google Maps.
- Get its **place ID** with Google's free [Place ID Finder](https://developers.google.com/maps/documentation/places/web-service/place-id). It runs in your browser and makes no call from our side.
- Note its latitude and longitude from Google Maps: right-click the pin, then click the coordinates.

```sh
npm run smoke:places -- "<keyword>" <lat> <lng> <place_id> --region=ca   # or --region=us
```

**Cost:** 1 IDs-only Text Search call on the free Essentials SKU (2 if the one retry fires).

**Expected output**

```
Keyword:        emergency plumber
Center:         43.6629, -79.3347 (region ca)
Results:        20 (page 1 only)
Target:         ChIJ... found at rank 4          (or "not found on page 1 (rank > 20)")
API calls:      1 (IDs-only SKU, retries included)
```

**Check**
- `Results` is 20.
- The rank roughly matches a manual Maps search (see "Compare with Google Maps" below).

**If it fails**
- `status=403 PERMISSION_DENIED`: the key is not enabled for Places API (New), or its restrictions block it.
- `status=429`: a quota or budget cap was hit.
- `GOOGLE_PLACE_API_KEY not set`: the key isn't in `.env`.

## Step 2: one location, 2 keywords, 3×3 grid

**Expected cost: 26–78 IDs-only calls, plus 2 Pro calls, plus 0–1 Place Details calls.**
- **IDs-only (26–78):** 13 unique points × 2 keywords, 1–3 pages each. It is fewer when the business is found on page 1. The worst case with every retry is 156.
- **Pro (2):** the Map Ranking list, one names search per keyword.
- **Place Details (0 or 1):** only if the location has no lat/lng, for a single `location` field.

### 2a. Log in and create the location

1. Use the demo login. `npm run seed:rank-demo` prints a login and an access token (re-running it creates a fresh demo user). Then:

   ```sh
   export TOKEN='<access token from seed:rank-demo>'
   API=http://localhost:5055/api/v1
   ```

2. Create the real business as a location. **Do not send `place_id` here.** The legacy create endpoint would make an expensive Place Details call (AUDIT C23).

   ```sh
   curl -s -X POST $API/locations -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
     -d '{"name":"<business name>","address":"<street>","country":"Canada","state":"Ontario","city":"Toronto","zip_code":"<zip>","mobile":"<phone>","website_URL":"<site>","business_category":"<category>"}'
   curl -s $API/locations -H "Authorization: Bearer $TOKEN"     # copy the new location's _id
   ```

3. Set its place ID and coordinates directly in the local database. Adding coordinates makes Place Details calls **0**; if you leave them out, the run resolves them with **1** call.

   ```sh
   mongosh "mongodb://mps_local:<local-db-password>@127.0.0.1:27017/mps_rebuild?authSource=mps_rebuild" --quiet --eval \
     'db.locations.updateOne({_id: ObjectId("<locationId>")}, {$set: {place_id: "<place_id>", lat: <lat>, lng: <lng>}})'
   ```

### 2b. Tracking settings and the estimate

```sh
LOC=$API/locations/<locationId>
curl -s -X PUT $LOC/tracking -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"keywords":["<keyword 1>","<keyword 2>"],"grid":{"size":3,"spacing_km":1},"frequency":"manual"}'
```

Check the response:
- `data.estimate.idsOnly` is `{ "min": 26, "max": 78, "maxWithRetries": 156 }`
- `data.estimate.pro.min` is 2
- `data.estimate.details.min` is 0 (or 1 without lat/lng)

Keep `frequency` as `manual`, so the scheduler never runs this location by itself.

### 2c. Run it

```sh
curl -s -X POST $LOC/rank-runs -H "Authorization: Bearer $TOKEN"                   # 202, note data.run_id
curl -s $LOC/rank-runs/<run_id> -H "Authorization: Bearer $TOKEN"                   # repeat until status is done/partial/failed
```

A 2-keyword 3×3 run should finish in well under a minute. Terminal 1 logs one line, for example `rank-run <id>: done keywords=2 ids_only=31 pro=2 details=0`.

**Check**
- `status` is `done`. `partial` means some points failed; see `errors_count` and the error cells.
- `api_calls.ids_only` is within 26–78, `api_calls.pro` is 2, and `api_calls.details` is 0 or 1.
- Write the real counts into PROGRESS.md: that is the first measured cost.

## How to read the results

```sh
curl -s $LOC/rank-tracker -H "Authorization: Bearer $TOKEN"
curl -s "$LOC/grid?keyword=<keyword 1>" -H "Authorization: Bearer $TOKEN"
curl -s "$LOC/map-ranking?keyword=<keyword 1>" -H "Authorization: Bearer $TOKEN"
```

- **Rank Tracker:** 5 points per keyword: `C` (the location), plus `N`, `S`, `E` and `W` at 1.5 km. `summary.self.avgRank` is the average, with not-found counted as 61.
- **Grid:** 9 points (3×3, 1 km apart), with row 0 north. `display` is the number shown in the heatmap.
  - `"60+"` means the search worked but the business is not in the top 60.
  - `"error"` means the search failed twice. It is excluded from averages.
- **Map Ranking:** the top 20 at the center. `is_self: true` marks the business.
- **Change** fields are `null` on the first run. A second run with the same keywords shows `change` and `changeLabel`.

## Compare with Google Maps

For the center and one corner point:
1. Open an **incognito** window. Logged-in results are personalised.
2. Go to `https://www.google.com/maps/search/<keyword>/@<lat>,<lng>,14z`, using the point's `lat`/`lng` from the response.
3. Count the business's position in the results list, **ignoring "Sponsored" results**.

**What to expect**
- Within a few positions of our rank near the center.
- The top 3 ("pack") usually match.
- Differences grow with distance and on crowded keywords. Text Search is a proxy for the Maps list, not an exact copy.

**Investigate if**
- The business is `60+` with us but top 10 on Maps. Check the `place_id`: the place may have moved, so compare with the Place ID Finder.
- Every point shows the same rank. Check `lat`/`lng` and the region (`US` vs `Canada`).

## Rollback

Everything is local, and nothing is sent to Google other than the searches.

```sh
mongosh "mongodb://mps_local:<local-db-password>@127.0.0.1:27017/mps_rebuild?authSource=mps_rebuild" --quiet --eval '
  db.rank_runs.deleteMany({ location_id: ObjectId("<locationId>") });
  db.locations.updateOne({ _id: ObjectId("<locationId>") }, { $unset: { tracking: "" } });'
```

- Delete one run only: `db.rank_runs.deleteOne({ _id: ObjectId("<run_id>") })`.
- Remove the test location entirely: `db.locations.deleteOne({ _id: ObjectId("<locationId>") })`.
- **Stop all live calls:** remove `GOOGLE_PLACE_API_KEY` from `.env` and restart `npm run dev`. Any run then fails immediately with "GOOGLE_PLACE_API_KEY not set", before any network call.
- The scheduler only runs locations whose `frequency` is `weekly` or `monthly`. Keep test locations on `manual`.

## After the test

- Record in PROGRESS.md: the real `api_calls` against the estimate, the run duration, and how the results compared with manual Maps searches.
- Only then try larger runs outside development (`NODE_ENV=production` lifts the 2-keyword / 3×3 limits). The hard cap `RANK_MAX_CALLS_PER_RUN` (default 3200) still applies.
