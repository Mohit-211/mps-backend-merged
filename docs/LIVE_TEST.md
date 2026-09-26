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

## The flow at a glance

| Step | Command | Google calls |
|---|---|---|
| 1. Find the business | `npm run find:place -- "<name> <city>" <lat> <lng> --region=ca` | 1 IDs-only + 1 Place Details |
| 2. Create the live-test user and location | `npm run setup:live-test -- ...` | 0 |
| 3. Smoke test | `npm run smoke:places -- "<keyword>" <lat> <lng> <place_id> --region=ca` | 1 IDs-only |
| 4. One real run | `POST /locations/:locationId/rank-runs` | 26–78 IDs-only + 2 Pro + 0 Details |
| 5. Calibration sheet | `npm run calibrate -- <locationId> <runId>` | 0 |
| 6. Manual check | fill in `manual_rank` / `manual_top3` from the Maps links | 0 |
| 7. Score | `npm run calibrate:score -- docs/calibration/<file>.csv` | 0 |

## Step 1: find the business (`find:place`, 2 calls)

```sh
npm run find:place -- "MyPageSEO Fredericton NB" 45.9636 -66.6431 --region=ca
```

The coordinates are only a search bias (the city center is fine). The script makes **one** IDs-only Text Search (page 1 only) and **one** Place Details call for the top result, with the fields `id, displayName, formattedAddress, location` (Essentials tier). It prints the place ID, name, address, coordinates and the call count.

**Check** that the name and address are the right business before going on. If the top result is wrong, refine the query rather than guessing a place ID.

**Picking a business from a list** (e.g. "an independent plumber in Dallas"):

```sh
npm run find:place -- "plumber Dallas TX" 32.7767 -96.7970 --names --region=us   # 1 Pro call: up to 20 names + place IDs
npm run find:place -- --id=<place_id>                                             # 1 Place Details call: name, address, coordinates
```

## Step 2: live-test user and location (`setup:live-test`, 0 calls)

```sh
npm run setup:live-test -- --name "MyPageSEO" --city Fredericton --state NB --country Canada \
  --place-id <place_id> --lat <lat> --lng <lng> --address "<formatted address>" \
  --keywords "seo company,digital marketing agency" --token-file <scratch dir>/live_token
```

- Refuses unless `NODE_ENV=development` **and** the database is `mps_rebuild`.
- Creates the user `live-test@mypageseo.test` (separate from the demo seed), and a location with `place_id` and `lat`/`lng` set **directly** (the legacy `POST /locations` would make an all-fields Place Details call, AUDIT C23).
- Tracking: the keywords, a 3×3 grid at 1 km, frequency `manual` (the scheduler never picks it up).
- The access token goes to `--token-file` (mode 600), never to the terminal. Re-running recreates the live-test user and deletes its old runs.

## Step 3: smoke test (`smoke:places`, 1 call)

```sh
npm run smoke:places -- "seo company" <lat> <lng> <place_id> --region=ca
```

**Expected:** `Results: 20`, the target's rank on page 1 (or "not found on page 1"), `API calls: 1`.

**If it fails**
- `status=403 PERMISSION_DENIED`: the key is not enabled for Places API (New), or its restrictions block it.
- `status=429`: a quota or budget cap was hit.
- `GOOGLE_PLACE_API_KEY not set`: the key isn't in `.env`.

## Step 4: one real run

**Expected cost: 26–78 IDs-only calls, plus 2 Pro calls, 0 Place Details** (lat/lng are set).
- **IDs-only:** 13 unique points × 2 keywords, 1–3 pages each; fewer when the business is found on page 1. The worst case with every retry is 156.
- **Pro (2):** the Map Ranking list, one names search per keyword.

With `npm run dev` running in terminal 1:

```sh
TOKEN=$(cat <scratch dir>/live_token)
LOC=http://localhost:5055/api/v1/locations/<locationId>
curl -s $LOC/tracking -H "Authorization: Bearer $TOKEN"                   # check data.estimate
curl -s -X POST $LOC/rank-runs -H "Authorization: Bearer $TOKEN"          # 202, note data.run_id
curl -s $LOC/rank-runs/<run_id> -H "Authorization: Bearer $TOKEN"         # repeat until done/partial/failed
```

Terminal 1 logs one line, for example `rank-run <id>: done keywords=2 ids_only=31 pro=2 details=0`.

**Check**
- `status` is `done`. `partial` means some points failed; see `errors_count` and the error cells.
- `api_calls` is within the estimate. Write the real counts into PROGRESS.md.

## Step 5: calibration sheet (`calibrate`, 0 calls)

```sh
npm run calibrate -- <locationId> <runId>
```

Reads the run from the database only and writes `docs/calibration/<run date>-<location>.csv`, one row per keyword × point (5 tracker + 9 grid per keyword):

| Column | Meaning |
|---|---|
| `keyword`, `point_type` | `tracker` or `grid` |
| `row`, `col` | grid position (row 0 = north); for tracker points `row` is `C`/`N`/`S`/`E`/`W` |
| `lat`, `lng` | the sample point |
| `api_rank` | our rank for the business: a number, `60+` or `error` |
| `api_results` | how many results our search returned at that point: `17` means the whole list had 17 places (a shallow market); `20+` means paging stopped once the business was found, so the list is longer |
| `api_top3` | our top 3 at that point, separated by " \| ". Names come from the run's Map Ranking lists (center, both keywords); a place that never appears there is shown as `(unknown: <id>)`, because naming it would cost an extra paid call |
| `maps_url` | `https://www.google.com/maps/search/<keyword>/@<lat>,<lng>,14z` |
| `manual_rank`, `manual_top3`, `notes` | blank, for you |

It refuses to overwrite an existing sheet (it may hold your entries) unless `--force` is given. `--suffix=r2` writes `<run date>-<location>-r2.csv`, for a second round on the same day.

## Step 6: fill in the manual columns

For each row:
1. Open `maps_url` in an **incognito** window (logged-in results are personalised). Don't pan or zoom the map.
2. `manual_rank`: the business's position in the results list, **ignoring "Sponsored"**. Write `60+` if it isn't in the list.
3. `manual_top3`: the first 3 non-sponsored names, `|`-separated (e.g. `Alpha SEO | Beta Media | Gamma`). Exact spelling isn't needed; names are compared loosely (case, punctuation and "Inc/Ltd/Co" are ignored).
4. `notes`: anything odd.

The tracker `C` row and the grid center are the same search; fill in either (the scorer counts the point once).

## Step 7: score (`calibrate:score`, 0 calls)

```sh
npm run calibrate:score -- docs/calibration/<file>.csv
```

It prints:
- **Within 2:** the share of points where |api_rank − manual_rank| ≤ 2 (both `60+` counts as agreement).
- **Found on Maps but 60+ in the API**, and the reverse.
- **Top-3 overlap:** the average share of our top 3 found in the manual top 3, over rows where our top 3 is fully named.
- **Verdict:** **PASS** if within-2 ≥ 70% **and** top-3 overlap ≥ 60%, otherwise **FAIL** with the reasons and the 5 worst rows (gap with `60+` counted as 61).

Rows without a `manual_rank`, and rows where our search errored, are skipped and counted. The output also shows how many rows were scored per keyword and point type.

`--tracker-only` scores only the tracker rows (C/N/S/E/W), so you can check 5 rows per keyword instead of 13.

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

## Investigate if

- The business is `60+` with us but top 10 on Maps. Check the `place_id`: the place may have moved (re-run `find:place`).
- Every point shows the same rank. Check `lat`/`lng` and the region (`US` vs `Canada`).
- Differences grow with distance and on crowded keywords. Text Search is a proxy for the Maps list, not an exact copy; the calibration verdict says whether the proxy is good enough.

## Rollback

Everything is local, and nothing is sent to Google other than the searches.

```sh
mongosh "mongodb://mps_local:<local-db-password>@127.0.0.1:27017/mps_rebuild?authSource=mps_rebuild" --quiet --eval '
  db.rank_runs.deleteMany({ location_id: ObjectId("<locationId>") });
  db.locations.updateOne({ _id: ObjectId("<locationId>") }, { $unset: { tracking: "" } });'
```

- Delete one run only: `db.rank_runs.deleteOne({ _id: ObjectId("<run_id>") })`.
- Remove the test location entirely: `db.locations.deleteOne({ _id: ObjectId("<locationId>") })`, or re-run `setup:live-test` to start clean.
- **Stop all live calls:** remove `GOOGLE_PLACE_API_KEY` from `.env` and restart `npm run dev`. Any run then fails immediately with "GOOGLE_PLACE_API_KEY not set", before any network call.
- The scheduler only runs locations whose `frequency` is `weekly` or `monthly`. Keep test locations on `manual`.

## After the test

- Record in PROGRESS.md: the real `api_calls` against the estimate, the run duration, and the calibration verdict. Commit the filled-in CSV.
- Only then try larger runs outside development (`NODE_ENV=production` lifts the 2-keyword / 3×3 limits). The hard cap `RANK_MAX_CALLS_PER_RUN` (default 3200) still applies.
