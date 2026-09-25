# Ranking API (Phase 5)

The endpoints behind the three ranking pages: **Rank Tracker**, **Local Search Grid** and **Local Map Ranking**. The example responses below are real responses from the demo data (`npm run seed:rank-demo`), with long arrays shortened (`"…"`).

**Try it locally:**
1. Run `npm run seed:rank-demo`. It prints a demo login, an access token and the location id.
2. Run `npm run dev`.
3. Call the endpoints with `Authorization: Bearer <token>`.

The demo data comes from an offline client, so it needs no API key.

## Conventions

- **Base URL:** `/api/v1/locations/:locationId`.
- **Auth:** every endpoint needs a user access token (`Authorization: Bearer <token>`), and the location must belong to that user (`created_by`).

**Error statuses**

| Status | When |
|---|---|
| 401 | No token |
| 404 | Someone else's location, or a deleted or inactive one |
| 400 | Malformed `locationId` |

**Envelope:** every response is `{ success, status, message, data }`. For errors, `data` is `""`, except for the 422 on `POST rank-runs`.

**Targets** are keyed `self` (the client) and `competitor_1`…`competitor_5`, in the order of `tracking.competitors`. The mapping for a run is in `targets`.

**Rank cell** (`CellView`): `{ rank, status, bucket, display }`

| Field | Values |
|---|---|
| `status` | `ok` (rank 1–60), `not_found` (not in the top 60, shown as `"60+"`), `error` (the search failed after one retry) |
| `bucket` | `pack` (1–3), `visible` (4–10), `low` (11–20), `invisible` (21–60), `not_found`, `error` |
| `display` | `"1"`…`"60"`, `"60+"` or `"error"`; use it directly in the UI |

**Averages**
- `avgRank` counts `not_found` as **61** and **excludes errors**, rounded to 1 decimal.
- `foundRate` and `top3Rate` are shares of the non-error points, rounded to 2 decimals.
- A metric is `null` when every point failed.

**Change** is `previous − current`, so a positive number means improved.
- `changeLabel` is one of: `improved`, `declined`, `unchanged`, `entered_top_60` or `dropped_out_of_top_60`. For the two "top 60" labels, `change` is `null`.
- Change is `null` when there is no earlier run with the same `keywords_version`, for example after the keywords were edited.
- At keyword level, `entered_top_60` means the business was not found at any point last run and is found somewhere now; `dropped_out_of_top_60` is the reverse (CLAUDE.md §4).

**Run status:** `queued` → `running` → `done` | `partial` (some searches failed) | `failed`. Only `done` and `partial` runs have reports.

**Page endpoints** (`rank-tracker`, `grid`, `map-ranking`) show the **latest done or partial run**. Pass `?runId=` to view an older one.
- 404 `"No completed run yet"` before the first run finishes.
- 409 when `runId` points to a run that is not done or partial.

**`RunMeta`** (the `run` field on page responses): `{ run_id, run_at, status, keywords_version, center: { lat, lng }, config: { grid_size, spacing_km, tracker_offset_km, radius_m, store_place_names } }`.

**Estimate** (`CallEstimate`, returned by several endpoints):
- `idsOnly`: free Text Search IDs-only calls, as `{ min, max, maxWithRetries }`
- `pro`: one names search per keyword
- `details`: 1 if the location's coordinates still need resolving
- In development, runs are limited to `RANK_DEV_MAX_KEYWORDS` keywords and a 3×3 grid, reported as `dev_capped: true`.

---

## Tracking settings

### `GET /tracking`

Returns the location's ranking settings, with defaults filled in, and what a run would cost now.

```json
{
  "success": true,
  "status": 200,
  "message": "Completed Successfully.",
  "data": {
    "tracking": {
      "keywords": [
        {
          "text": "Emergency Plumber",
          "normalized": "emergency plumber"
        },
        {
          "text": "Drain Cleaning",
          "normalized": "drain cleaning"
        },
        {
          "text": "Water Heater Repair",
          "normalized": "water heater repair"
        }
      ],
      "keywords_version": 1,
      "keywords_updated_at": "2026-09-04T20:41:45.960Z",
      "competitors": [
        "ChIJdemoQueenWestPlumbing02",
        "ChIJdemoDanforthDrainPros03"
      ],
      "grid": {
        "size": 5,
        "spacing_km": 1
      },
      "frequency": "weekly",
      "next_run_at": "2026-10-02T20:41:45.960Z",
      "last_run_at": "2026-09-25T20:43:20.960Z",
      "last_error": null
    },
    "estimate": {
      "keywords": 2,
      "gridSize": 3,
      "points": 13,
      "idsOnly": {
        "min": 26,
        "max": 78,
        "maxWithRetries": 156
      },
      "pro": {
        "min": 2,
        "max": 2,
        "maxWithRetries": 4
      },
      "details": {
        "min": 0,
        "max": 0,
        "maxWithRetries": 0
      },
      "total": {
        "min": 28,
        "max": 80,
        "maxWithRetries": 160
      }
    },
    "dev_capped": true
  }
}
```

### `PUT /tracking`

Partial update: only the fields you send change.

```json
{
  "keywords": ["Emergency Plumber", "Drain Cleaning", "Water Heater Repair"],
  "competitors": ["ChIJdemoQueenWestPlumbing02", "ChIJdemoDanforthDrainPros03"],
  "grid": { "size": 5, "spacing_km": 1 },
  "frequency": "weekly",
  "next_run_at": "2026-10-02T20:41:45.960Z"
}
```

**Rules**
- **`keywords`:** 1 to `RANK_MAX_KEYWORDS` (20) entries of 2–80 characters each. They are trimmed and de-duplicated case-insensitively, and the first spelling is kept.
- **`keywords_version`:** goes up **only when the set of keywords changes**. Reordering or re-casing does not bump it. Changes are never compared across versions.
- **`competitors`:** up to 5 Google place IDs, never the location's own `place_id`.
- **`grid.size`:** 3, 5 or 7. **`grid.spacing_km`:** 0.25–5.
- **`frequency`:** `weekly`, `monthly` or `manual`.
  - `weekly` / `monthly`: `next_run_at` becomes now (the next scheduler tick), unless you send it.
  - `manual`: `next_run_at` becomes `null`, and the location is never scheduled.

**Response 200**

`keywords_version_bumped` is `true` only when the version went up.

```json
{
  "success": true,
  "status": 200,
  "message": "Tracking settings saved.",
  "data": {
    "tracking": {
      "keywords": [
        {
          "text": "Emergency Plumber",
          "normalized": "emergency plumber"
        },
        {
          "text": "Drain Cleaning",
          "normalized": "drain cleaning"
        },
        {
          "text": "Water Heater Repair",
          "normalized": "water heater repair"
        }
      ],
      "keywords_version": 1,
      "keywords_updated_at": "2026-09-04T20:41:45.960Z",
      "competitors": [
        "ChIJdemoQueenWestPlumbing02",
        "ChIJdemoDanforthDrainPros03"
      ],
      "grid": {
        "size": 5,
        "spacing_km": 1
      },
      "frequency": "weekly",
      "next_run_at": "2026-10-02T20:41:45.960Z",
      "last_run_at": "2026-09-25T20:43:20.960Z",
      "last_error": null
    },
    "estimate": {
      "keywords": 2,
      "gridSize": 3,
      "points": 13,
      "idsOnly": {
        "min": 26,
        "max": 78,
        "maxWithRetries": 156
      },
      "pro": {
        "min": 2,
        "max": 2,
        "maxWithRetries": 4
      },
      "details": {
        "min": 0,
        "max": 0,
        "maxWithRetries": 0
      },
      "total": {
        "min": 28,
        "max": 80,
        "maxWithRetries": 160
      }
    },
    "dev_capped": true,
    "keywords_version_bumped": false
  }
}
```

**Response 400** (validation):

```json
{
  "success": false,
  "status": 400,
  "message": "\"grid.size\" must be one of [3, 5, 7]",
  "data": ""
}
```

---

## Runs

### `POST /rank-runs`

"Run now". Queues a run and returns immediately. The run takes about a minute in the background, depending on the number of keywords and the grid size.
- If a run is already queued or running for this location, that run is returned with `existing: true`, and no second run is created.
- **400:** the location has no `place_id`, no tracking keywords, or is not in the US or Canada.
- **422:** the estimated maximum IDs-only calls exceed `RANK_MAX_CALLS_PER_RUN` (default 3200). The response includes the estimate.

**Response 202** (a new run; this one is from development, so it is capped to 2 keywords and 3×3):

```json
{
  "success": true,
  "status": 202,
  "message": "Rank run queued.",
  "data": {
    "run_id": "6ab6dc96a50b1131b587027c",
    "status": "queued",
    "existing": false,
    "estimate": {
      "keywords": 2,
      "gridSize": 3,
      "points": 13,
      "idsOnly": {
        "min": 26,
        "max": 78,
        "maxWithRetries": 156
      },
      "pro": {
        "min": 2,
        "max": 2,
        "maxWithRetries": 4
      },
      "details": {
        "min": 0,
        "max": 0,
        "maxWithRetries": 0
      },
      "total": {
        "min": 28,
        "max": 80,
        "maxWithRetries": 160
      }
    },
    "dev_capped": true
  }
}
```

**Response 202** (a run was already in progress):

```json
{
  "success": true,
  "status": 202,
  "message": "A run is already in progress for this location.",
  "data": {
    "run_id": "6ab6dc96a50b1131b587027c",
    "status": "running",
    "existing": true,
    "estimate": {
      "idsOnly": {
        "min": 26,
        "max": 78,
        "maxWithRetries": 156
      },
      "pro": {
        "min": 2,
        "max": 2,
        "maxWithRetries": 4
      },
      "details": {
        "min": 0,
        "max": 0,
        "maxWithRetries": 0
      },
      "total": {
        "min": 28,
        "max": 80,
        "maxWithRetries": 160
      },
      "keywords": 2,
      "gridSize": 3,
      "points": 13
    },
    "dev_capped": true
  }
}
```

**Response 422** (over the cap; illustrative values):

```json
{
  "success": false,
  "status": 422,
  "message": "Estimated up to 3180 IDs-only calls, above RANK_MAX_CALLS_PER_RUN (3000). Reduce keywords or grid size.",
  "data": {
    "estimate": {
      "keywords": 20,
      "gridSize": 7,
      "points": 53,
      "idsOnly": {
        "min": 1060,
        "max": 3180,
        "maxWithRetries": 6360
      },
      "pro": {
        "min": 20,
        "max": 20,
        "maxWithRetries": 40
      },
      "details": {
        "min": 0,
        "max": 0,
        "maxWithRetries": 0
      },
      "total": {
        "min": 1080,
        "max": 3200,
        "maxWithRetries": 6400
      }
    },
    "cap": 3000
  }
}
```

### `GET /rank-runs/:runId`

Status of one run: timings, API calls used, error count and failure reason. Poll this after `POST /rank-runs` until the status is `done`, `partial` or `failed`.

```json
{
  "success": true,
  "status": 200,
  "message": "Completed Successfully.",
  "data": {
    "run_id": "6ab6dc8a10f657b7c9476cff",
    "status": "partial",
    "trigger": "manual",
    "run_at": "2026-09-25T20:41:45.960Z",
    "started_at": "2026-09-25T20:41:50.960Z",
    "finished_at": "2026-09-25T20:43:20.960Z",
    "duration_ms": 90000,
    "keywords_version": 1,
    "keywords": [
      "Emergency Plumber",
      "Drain Cleaning",
      "Water Heater Repair"
    ],
    "api_calls": {
      "ids_only": 168,
      "pro": 3,
      "details": 0
    },
    "estimate": {
      "idsOnly": {
        "min": 87,
        "max": 261,
        "maxWithRetries": 522
      },
      "pro": {
        "min": 3,
        "max": 3,
        "maxWithRetries": 6
      },
      "details": {
        "min": 0,
        "max": 0,
        "maxWithRetries": 0
      },
      "total": {
        "min": 90,
        "max": 264,
        "maxWithRetries": 528
      },
      "keywords": 3,
      "gridSize": 5,
      "points": 29
    },
    "dev_capped": false,
    "errors_count": 1,
    "failure_reason": null
  }
}
```

### `GET /rank-runs?page=&limit=`

Run history, newest first, with each run's overall average per target. The default `limit` is 15, and the maximum is 100.

```json
{
  "success": true,
  "status": 200,
  "message": "Completed Successfully.",
  "data": {
    "runs": [
      {
        "run_id": "6ab6dc8a10f657b7c9476cff",
        "run_at": "2026-09-25T20:41:45.960Z",
        "status": "partial",
        "trigger": "manual",
        "keywords_version": 1,
        "overall": {
          "self": {
            "overallAvgRank": 21.3,
            "change": 12.6
          },
          "competitor_1": {
            "overallAvgRank": 22,
            "change": -0.7
          },
          "competitor_2": {
            "overallAvgRank": 10,
            "change": 0
          }
        }
      },
      {
        "run_id": "6ab6dc8910f657b7c9476cf6",
        "run_at": "2026-09-18T20:41:45.960Z",
        "status": "done",
        "trigger": "scheduled",
        "keywords_version": 1,
        "overall": {
          "self": {
            "overallAvgRank": 33.9,
            "change": -11
          },
          "competitor_1": {
            "overallAvgRank": 21.3,
            "change": 5.7
          },
          "competitor_2": {
            "overallAvgRank": 10,
            "change": 0.3
          }
        }
      },
      {
        "run_id": "6ab6dc8910f657b7c9476ced",
        "run_at": "2026-09-11T20:41:45.960Z",
        "status": "done",
        "trigger": "scheduled",
        "keywords_version": 1,
        "overall": {
          "self": {
            "overallAvgRank": 22.9,
            "change": null
          },
          "competitor_1": {
            "overallAvgRank": 27,
            "change": null
          },
          "competitor_2": {
            "overallAvgRank": 10.3,
            "change": null
          }
        }
      }
    ],
    "page": 1,
    "limit": 15,
    "total": 3
  }
}
```

---

## Rank Tracker page

### `GET /rank-tracker?runId=`

For each keyword: a summary per target (average rank, found rate, top-3 rate, change) and the 5 sample points. The points are the center `C` plus `N`, `S`, `E` and `W` at `tracker_offset_km`. The response also has `overall` per target and `trend`: the overall average of `self` over the last 12 done or partial runs, oldest first.

```json
{
  "success": true,
  "status": 200,
  "message": "Completed Successfully.",
  "data": {
    "run": {
      "run_id": "6ab6dc8a10f657b7c9476cff",
      "run_at": "2026-09-25T20:41:45.960Z",
      "status": "partial",
      "keywords_version": 1,
      "center": {
        "lat": 43.6629,
        "lng": -79.3347
      },
      "config": {
        "grid_size": 5,
        "spacing_km": 1,
        "tracker_offset_km": 1.5,
        "radius_m": 5000,
        "store_place_names": true
      }
    },
    "targets": [
      {
        "key": "self",
        "place_id": "ChIJdemoMapleLeafPlumbing01"
      },
      {
        "key": "competitor_1",
        "place_id": "ChIJdemoQueenWestPlumbing02"
      },
      {
        "key": "competitor_2",
        "place_id": "ChIJdemoDanforthDrainPros03"
      }
    ],
    "keywords": [
      {
        "keyword": "Emergency Plumber",
        "summary": {
          "self": {
            "avgRank": 5.4,
            "foundRate": 1,
            "top3Rate": 0.2,
            "change": 4,
            "changeLabel": "improved"
          },
          "competitor_1": {
            "avgRank": 7.6,
            "foundRate": 1,
            "top3Rate": 0,
            "change": -2,
            "changeLabel": "declined"
          },
          "competitor_2": {
            "avgRank": 10.6,
            "foundRate": 1,
            "top3Rate": 0,
            "change": 0,
            "changeLabel": "unchanged"
          }
        },
        "cells": [
          {
            "point": {
              "label": "C",
              "lat": 43.6629,
              "lng": -79.3347
            },
            "byTarget": {
              "self": {
                "rank": 3,
                "status": "ok",
                "bucket": "pack",
                "display": "3"
              },
              "competitor_1": {
                "rank": 6,
                "status": "ok",
                "bucket": "visible",
                "display": "6"
              },
              "competitor_2": {
                "rank": 9,
                "status": "ok",
                "bucket": "visible",
                "display": "9"
              }
            }
          },
          {
            "point": {
              "label": "N",
              "lat": 43.67638982408878,
              "lng": -79.3347
            },
            "byTarget": {
              "self": {
                "rank": 6,
                "status": "ok",
                "bucket": "visible",
                "display": "6"
              },
              "competitor_1": {
                "rank": 8,
                "status": "ok",
                "bucket": "visible",
                "display": "8"
              },
              "competitor_2": {
                "rank": 11,
                "status": "ok",
                "bucket": "low",
                "display": "11"
              }
            }
          },
          "…3 more points (N, S, E, W)"
        ]
      },
      {
        "keyword": "Drain Cleaning",
        "summary": {
          "self": {
            "avgRank": 28,
            "foundRate": 1,
            "top3Rate": 0,
            "change": null,
            "changeLabel": "entered_top_60"
          },
          "competitor_1": {
            "avgRank": 16.4,
            "foundRate": 1,
            "top3Rate": 0,
            "change": 0,
            "changeLabel": "unchanged"
          },
          "competitor_2": {
            "avgRank": 3.6,
            "foundRate": 1,
            "top3Rate": 0.2,
            "change": 0,
            "changeLabel": "unchanged"
          }
        },
        "cells": [
          {
            "point": {
              "label": "C",
              "lat": 43.6629,
              "lng": -79.3347
            },
            "byTarget": {
              "self": {
                "rank": 24,
                "status": "ok",
                "bucket": "invisible",
                "display": "24"
              },
              "competitor_1": {
                "rank": 14,
                "status": "ok",
                "bucket": "low",
                "display": "14"
              },
              "competitor_2": {
                "rank": 2,
                "status": "ok",
                "bucket": "pack",
                "display": "2"
              }
            }
          },
          {
            "point": {
              "label": "N",
              "lat": 43.67638982408878,
              "lng": -79.3347
            },
            "byTarget": {
              "self": {
                "rank": 29,
                "status": "ok",
                "bucket": "invisible",
                "display": "29"
              },
              "competitor_1": {
                "rank": 17,
                "status": "ok",
                "bucket": "low",
                "display": "17"
              },
              "competitor_2": {
                "rank": 4,
                "status": "ok",
                "bucket": "visible",
                "display": "4"
              }
            }
          },
          "…3 more points (N, S, E, W)"
        ]
      },
      "…1 more keyword"
    ],
    "overall": {
      "self": {
        "overallAvgRank": 21.3,
        "change": 12.6
      },
      "competitor_1": {
        "overallAvgRank": 22,
        "change": -0.7
      },
      "competitor_2": {
        "overallAvgRank": 10,
        "change": 0
      }
    },
    "trend": [
      {
        "run_id": "6ab6dc8910f657b7c9476ced",
        "run_at": "2026-09-11T20:41:45.960Z",
        "overallAvgRank": 22.9,
        "keywords_version": 1
      },
      {
        "run_id": "6ab6dc8910f657b7c9476cf6",
        "run_at": "2026-09-18T20:41:45.960Z",
        "overallAvgRank": 33.9,
        "keywords_version": 1
      },
      {
        "run_id": "6ab6dc8a10f657b7c9476cff",
        "run_at": "2026-09-25T20:41:45.960Z",
        "overallAvgRank": 21.3,
        "keywords_version": 1
      }
    ]
  }
}
```

---

## Local Search Grid page

### `GET /grid?keyword=&runId=`

The heatmap: `size × size` points in row-major order. Row 0 is the northernmost row and col 0 the westernmost column, and the center point is `(size-1)/2, (size-1)/2`.
- Without `keyword`, every keyword is returned.
- An unknown keyword returns 404.
- The example is the demo's "Water Heater Repair": the north-west corner is an `error` cell, and the other corners are `60+`.

```json
{
  "success": true,
  "status": 200,
  "message": "Completed Successfully.",
  "data": {
    "run": {
      "run_id": "6ab6dc8a10f657b7c9476cff",
      "run_at": "2026-09-25T20:41:45.960Z",
      "status": "partial",
      "keywords_version": 1,
      "center": {
        "lat": 43.6629,
        "lng": -79.3347
      },
      "config": {
        "grid_size": 5,
        "spacing_km": 1,
        "tracker_offset_km": 1.5,
        "radius_m": 5000,
        "store_place_names": true
      }
    },
    "targets": [
      {
        "key": "self",
        "place_id": "ChIJdemoMapleLeafPlumbing01"
      },
      {
        "key": "competitor_1",
        "place_id": "ChIJdemoQueenWestPlumbing02"
      },
      {
        "key": "competitor_2",
        "place_id": "ChIJdemoDanforthDrainPros03"
      }
    ],
    "grid": {
      "size": 5,
      "spacing_km": 1
    },
    "keywords": [
      {
        "keyword": "Water Heater Repair",
        "summary": {
          "self": {
            "avgRank": 43.6,
            "foundRate": 0.88,
            "top3Rate": 0
          },
          "competitor_1": {
            "avgRank": 48.2,
            "foundRate": 1,
            "top3Rate": 0
          },
          "competitor_2": {
            "avgRank": 18.4,
            "foundRate": 1,
            "top3Rate": 0
          }
        },
        "points": [
          {
            "row": 0,
            "col": 0,
            "lat": 43.68088643211838,
            "lng": -79.35956325030119,
            "byTarget": {
              "self": {
                "rank": null,
                "status": "error",
                "bucket": "error",
                "display": "error"
              },
              "competitor_1": {
                "rank": null,
                "status": "error",
                "bucket": "error",
                "display": "error"
              },
              "competitor_2": {
                "rank": null,
                "status": "error",
                "bucket": "error",
                "display": "error"
              }
            }
          },
          {
            "row": 0,
            "col": 1,
            "lat": 43.68088643211838,
            "lng": -79.3471316251506,
            "byTarget": {
              "self": {
                "rank": 53,
                "status": "ok",
                "bucket": "invisible",
                "display": "53"
              },
              "competitor_1": {
                "rank": 52,
                "status": "ok",
                "bucket": "invisible",
                "display": "52"
              },
              "competitor_2": {
                "rank": 20,
                "status": "ok",
                "bucket": "low",
                "display": "20"
              }
            }
          },
          {
            "row": 0,
            "col": 2,
            "lat": 43.68088643211838,
            "lng": -79.3347,
            "byTarget": {
              "self": {
                "rank": 48,
                "status": "ok",
                "bucket": "invisible",
                "display": "48"
              },
              "competitor_1": {
                "rank": 50,
                "status": "ok",
                "bucket": "invisible",
                "display": "50"
              },
              "competitor_2": {
                "rank": 19,
                "status": "ok",
                "bucket": "low",
                "display": "19"
              }
            }
          },
          "…21 more points (row-major, row 0 = north)",
          {
            "row": 4,
            "col": 4,
            "lat": 43.64491356788162,
            "lng": -79.3098367496988,
            "byTarget": {
              "self": {
                "rank": null,
                "status": "not_found",
                "bucket": "not_found",
                "display": "60+"
              },
              "competitor_1": {
                "rank": 58,
                "status": "ok",
                "bucket": "invisible",
                "display": "58"
              },
              "competitor_2": {
                "rank": 22,
                "status": "ok",
                "bucket": "invisible",
                "display": "22"
              }
            }
          }
        ]
      }
    ]
  }
}
```

---

## Local Map Ranking page

### `GET /map-ranking?keyword=&runId=&resolveNames=`

"Who ranks at your location": the top 20 at the location center, per keyword. The client is marked `is_self: true`, and tracked competitors have their `target_key`.

**Names**
- **`STORE_PLACE_NAMES=true` (the default):** names are stored with the run and returned here.
- **`STORE_PLACE_NAMES=false`:** `name` is `null` and `names_stored` is `false`.
  - `?resolveNames=true` looks the names up live, costing up to 20 Place Details calls per request, and needs the API key (503 without it).
  - This mode is pending a ToS decision (see STATUS.md).

```json
{
  "success": true,
  "status": 200,
  "message": "Completed Successfully.",
  "data": {
    "run": {
      "run_id": "6ab6dc8a10f657b7c9476cff",
      "run_at": "2026-09-25T20:41:45.960Z",
      "status": "partial",
      "keywords_version": 1,
      "center": {
        "lat": 43.6629,
        "lng": -79.3347
      },
      "config": {
        "grid_size": 5,
        "spacing_km": 1,
        "tracker_offset_km": 1.5,
        "radius_m": 5000,
        "store_place_names": true
      }
    },
    "names_stored": true,
    "keywords": [
      {
        "keyword": "Emergency Plumber",
        "results": [
          {
            "rank": 1,
            "place_id": "ChIJmvIS6dRTiBdjvc1Fdgtdjzj",
            "name": "Riverdale Plumbing",
            "is_self": false,
            "target_key": null
          },
          {
            "rank": 2,
            "place_id": "ChIJiJn_u4YaYyvyAlAYjjO_FuP",
            "name": "Leslieville Drain Service",
            "is_self": false,
            "target_key": null
          },
          {
            "rank": 3,
            "place_id": "ChIJdemoMapleLeafPlumbing01",
            "name": "Maple Leaf Plumbing & Heating",
            "is_self": true,
            "target_key": "self"
          },
          {
            "rank": 4,
            "place_id": "ChIJXbrc_yt-ajCkTaaEuMksJ_O",
            "name": "Junction Plumbers",
            "is_self": false,
            "target_key": null
          },
          {
            "rank": 5,
            "place_id": "ChIJQIUbDcbRlCRTJKmRFzJsto3",
            "name": "Corktown Water Heaters",
            "is_self": false,
            "target_key": null
          },
          "…15 more (ranks 6–20)"
        ]
      }
    ]
  }
}
```

---

## Auth errors

**401** without a token:

```json
{
  "success": false,
  "status": 401,
  "message": "Unauthorized : please authenticate.",
  "data": ""
}
```

**404** is returned for another user's location, on every endpoint.
