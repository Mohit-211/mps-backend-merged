# API: ranking (Phase 5), GBP connection (Phase 6), onboarding (Phase 7a)

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
      "frequency": "auto_monthly",
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
  "frequency": "auto_monthly"
}
```

**Rules**
- **`keywords`:** 1 to `RANK_MAX_KEYWORDS` (20) entries of 2–80 characters each. They are trimmed and de-duplicated case-insensitively, and the first spelling is kept.
- **`keywords_version`:** goes up **only when the set of keywords changes**. Reordering or re-casing does not bump it. Changes are never compared across versions.
- **`competitors`:** up to 5 Google place IDs, never the location's own `place_id`.
- **`grid.size`:** 3, 5 or 7. **`grid.spacing_km`:** 0.25–5.
- **`frequency`** (7b): `auto_monthly` (default: the location refreshes automatically once a month, on the day it completed setup, at about 03:00 local) or `manual_only` (only `POST /refresh` or "run now"). `next_run_at` is no longer accepted (400).

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
      "frequency": "auto_monthly",
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

---

## GBP connection (Phase 6)

Setup and a step-by-step local walkthrough are in [GBP_CONNECT.md](GBP_CONNECT.md). The examples below use the hand-written test fixtures (no live GBP calls have been made yet). All routes need a user token, except the OAuth callback, which Google calls.

GBP errors use the same envelope:

| Status | Meaning |
|---|---|
| 400 | "Please connect with Google Business Profile"; "Reconnect Google Business Profile…" (Google rejected the stored authorisation); invalid input |
| 404 | location not yours, or not bound |
| 409 | the GBP location is already bound to another of your locations |
| 502 | Google failed |
| 503 | GBP API access not approved (quota 0), API not enabled, or server not configured |

"Reconnect" is a 400, not a 401, because a 401 from this API means the MyPageSEO session expired.

### `GET /api/v1/user/auth/google/gbp`

Starts the connection. `data` is Google's consent URL, with scope `business.manage` only, offline access, and a one-time `state` valid for 10 minutes.

### `GET /api/v1/user/auth/google/gbp/callback?code=&state=` (called by Google)

```json
{ "success": true, "status": 200, "message": "Connected with GBP successfully.",
  "data": { "connected": true, "google_email": "owner@example.test", "google_sub": "100000000000000000001" } }
```

Since Phase 7a, both connect flows request `openid email business.manage` and verify the id_token. The redirect flow also sends `prompt=select_account consent`. A user can connect **several Google accounts** (agencies): each is a *connection*, identified by `google_sub`. Connecting the same account again updates it; a new account is added. The popup flow is in the onboarding section below.

**400** is returned for an unknown, expired or reused `state` ("This connection link is invalid or has expired. Start the connection again."), and for `error=access_denied` ("Google Business Profile access was not granted.").

### `GET /api/v1/gbp`

Every profile from **every connected Google account**, grouped by account. The data comes from Business Information only: no Places calls.

> **Changed in 7a:** `data` is `{ connections: [...] }`, one group per Google account. (It was `{ accounts, locations, errors }` in Phase 6, and a bare array before that.) Each location keeps the old fields and adds `google_sub`, `accountName`, `place_id`, `latlng`, `region_code` and `bound_location_id`.

```json
{
  "connections": [
    {
      "google_sub": "100000000000000000001",
      "google_email": "owner@example.test",
      "label": "Connected as owner@example.test",
      "status": "ok",
      "error": null,
      "accounts": 2,
      "locations": [
        {
          "google_sub": "100000000000000000001",
          "gbpAccountId": "accounts/100000000000000000001",
          "accountName": "Example Owner",
          "gbpLocationId": "locations/200000000000000000001",
          "title": "Example Plumbing Co",
          "websiteUri": "https://example-plumbing.test/",
          "languageCode": "en",
          "metadata": { "placeId": "ChIJfakeGbpPlace000000001", "mapsUri": "https://maps.google.com/maps?cid=1" },
          "profile": { "description": "Family-run plumbers." },
          "mobile": "(214) 555-0100",
          "business_category": "Plumber",
          "country": "United States",
          "state": "TX",
          "city": "Dallas",
          "zip_code": "75201",
          "address": "100 Example St, Suite 5, Dallas, TX 75201",
          "region_code": "US",
          "place_id": "ChIJfakeGbpPlace000000001",
          "latlng": { "latitude": 32.7801, "longitude": -96.8005 },
          "bound_location_id": null
        }
      ],
      "errors": []
    }
  ]
}
```

- **`status`** per group: `ok`; `revoked` (reconnect that Google account); or `error` (see `error`, e.g. "GBP API access not approved (quota 0)"). One failing account does not stop the others.
- **`errors`** lists business accounts inside that Google account whose locations could not be listed.
- A service-area business with no storefront has `address: null`. A missing website shows as `"NA"` (legacy value).
- **400** "Please connect with Google Business Profile" when no Google account is connected.

### `POST /api/v1/gbp/bind-with-user`

Body: `{ "location_id", "gbpAccountId": "accounts/…", "gbpLocationId": "locations/…", "google_sub"?: "…" }`. `google_sub` (from the `GET /gbp` group) is **required when several Google accounts are connected** (otherwise 400 "google_sub is required"), and the binding remembers which account it was made with. Other fields the old frontend sent (`title`, `metadata`, …) are accepted and ignored: the server reads the profile from Google, which also checks that the connected account can access it.

```json
{
  "binding": {
    "location_id": "66f5…",
    "gbpAccountId": "accounts/100000000000000000001",
    "gbpLocationId": "locations/200000000000000000001",
    "title": "Example Plumbing Co",
    "place_id": "ChIJfakeGbpPlace000000001"
  },
  "place_id": { "location": "ChIJfakeGbpPlace000000001", "gbp": "ChIJfakeGbpPlace000000001", "status": "set" },
  "coordinates": "set"
}
```

**`place_id.status`:**

| Value | Meaning |
|---|---|
| `set` | Our location had none, so it was filled from GBP. |
| `match` | Our location already had the same place ID. |
| `conflict` | Our location has a different place ID. It is kept and never overwritten. |
| `none` | GBP has no place ID. |

**`coordinates`:**

| Value | Meaning |
|---|---|
| `set` | lat/lng were empty and were filled from GBP. |
| `kept` | Our location already had lat/lng. |
| `none` | GBP has no coordinates. |

### `POST /api/v1/gbp/unbind` (new)

Body: `{ "location_id" }`.

```json
{ "unbound": true, "jobs_cancelled": { "gbp_sync": 0, "scheduled_posts": 1 }, "tokens_deleted": true }
```

- Cancelled scheduled posts are marked `REJECTED` with `last_error: "GBP location unbound"`.
- `tokens_deleted` is true only when this was the **last bound location of that Google account**. That account then has to be connected again to bind another of its profiles. Other connected accounts are untouched.

### `POST /api/v1/user/auth/google/gbp/revoke` (disconnect one Google account)

Body: `{ "google_sub"?: "…" }`. It is required when several Google accounts are connected.

```json
{ "revoked": true, "bindings_removed": 1, "google_email": "a@client.test" }
```

- Revokes that account at Google (best effort), unbinds **only that account's** profiles (cancelling their scheduled jobs) and deletes its tokens. Other connected accounts keep working.
- `revoked: false` means Google could not be reached; the local cleanup still happened.
- `is_gbp_connected` on the user stays true while another usable connection remains.

---

## Onboarding (Phase 7a)

The first-run flow. The examples use test fixtures; no live calls have been made. The frontend walkthrough, including the Google Identity Services popup code, is in [GBP_CONNECT.md](GBP_CONNECT.md#3-connect-with-the-account-chooser-popup-phase-7a-recommended).

**Screens → endpoints:**

| # | Screen | Endpoint(s) |
|---|---|---|
| 1 | Connect Google (popup; any account, and more accounts later) | `GET /user/auth/google/gbp/popup` → GIS popup → `POST /user/auth/google/gbp/code` |
| 2 | Pick your business | `GET /onboarding/gbp-profiles` (grouped per Google account) → `POST /onboarding/select-profile` |
| 2b | Business center (only when `center_needed`: service-area businesses) | `PUT /locations/:id/center { query: "city or ZIP" }` |
| 3 | Keywords | `PUT /locations/:id/tracking { keywords }` |
| 4 | Competitors | `GET /locations/:id/competitor-suggestions`, optional `GET /places/search?q=&locationId=`, then `PUT /locations/:id/tracking { competitors }` (an empty list is fine) |
| 5 | Done | `POST /onboarding/complete` |
| – | Resume | `GET /onboarding/state` |

### `GET /api/v1/user/auth/google/gbp/popup`

Config for `google.accounts.oauth2.initCodeClient`. The `state` is valid for 10 minutes and works once. `select_account: true` shows the account chooser. The GIS code client has no `prompt` or `access_type` options: the code flow returns a refresh token on first consent, and a reconnect of the same account without one reuses the stored refresh token.

```json
{ "client_id": "….apps.googleusercontent.com", "scope": "openid email https://www.googleapis.com/auth/business.manage",
  "state": "b6ZQ…43 chars", "ux_mode": "popup", "select_account": true }
```

### `POST /api/v1/user/auth/google/gbp/code`

Body: `{ "code", "state" }` from the popup callback.

```json
{ "connected": true, "google_email": "owner@example.test", "google_sub": "100000000000000000001" }
```

- The same Google account again updates its connection; another account is **added** as a new connection (no 409).
- **400:** bad, expired or reused state, or another user's state; the Google account could not be verified; a new account without a refresh token.

### `GET /api/v1/onboarding/state`

```json
{
  "gbp": { "connected": true,
           "connections": [{ "google_sub": "100000000000000000001", "google_email": "owner@example.test", "status": "active" }] },
  "locations": [
    { "location_id": "66f5…", "name": "Example Plumbing Co",
      "onboarding": { "step": "keywords_set", "started_at": "2026-09-26T10:00:00.000Z", "completed_at": null } }
  ]
}
```

- `gbp.connections` lists every connected Google account; `status` is `active` or `revoked` (reconnect that account). `connected` is true while any is active.
- `locations` holds only locations created or linked through onboarding, unfinished ones first.
- `step` is one of `profile_selected` → (`center_needed` → `center_set`, service-area businesses only) → `keywords_set` → `competitors_set` → `completed`.

### `GET /api/v1/onboarding/gbp-profiles`

The same shape as `GET /api/v1/gbp`: grouped per connected Google account ("Connected as …"), no Places calls. Each location adds:
- `region_code` (`"US"`, `"CA"`, … from the storefront, or the service area for businesses without one)
- `supported` (US/CA only)

### `POST /api/v1/onboarding/select-profile`

Body: `{ "gbpAccountId": "accounts/…", "gbpLocationId": "locations/…", "location_id"?: "…", "google_sub"?: "…" }`. Pass the profile's `google_sub` from `gbp-profiles`; it is required when several Google accounts are connected.

- With `location_id`, that location is linked.
- Otherwise a location of yours with the same place ID is linked.
- Otherwise a new one is created from the profile: name, address, city, state, zip, country, phone, website, category, `place_id`, lat/lng. Missing text fields become `"n/a"`.
- In every case it binds, with the Phase 6 `place_id` rules. It makes 1 GBP call.

```json
{
  "location": { "location_id": "66f5…", "name": "Example Plumbing Co", "address": "100 Example St, Suite 5, Dallas, TX 75201",
                "place_id": "ChIJfakeGbpPlace000000001", "lat": 32.7801, "lng": -96.8005 },
  "created": true,
  "center_needed": false,
  "binding": { "binding": { "…": "…" }, "place_id": { "location": "ChIJfake…", "gbp": "ChIJfake…", "status": "match" }, "coordinates": "kept" }
}
```

`center_needed: true` means the profile has no coordinates (a service-area business): the step is `center_needed`, and the next screen asks for a city or ZIP (`PUT /locations/:id/center`).

**400:** "Only US and Canadian businesses are supported.", or the connected account cannot access the profile. **404:** `location_id` is not yours.

### `PUT /api/v1/locations/:locationId/center` (service-area businesses)

Body: `{ "query": "Fredericton, NB" }`: a city or ZIP / postal code, 2–100 characters.

- It is resolved once with **1 Places Text Search (IDs-only, free SKU)** in the location's country (no location bias) and **1 Place Details call for `location` only**.
- The result is saved as the location's lat/lng with `center_source: "manual"`. Rank runs and competitor suggestions use it. Old cached suggestions are dropped.
- The 2 calls count against the daily Places limit.

```json
{ "lat": 45.9635895, "lng": -66.6431151, "center_source": "manual", "center_label": "Fredericton, NB", "api_calls": 2, "onboarding_step": "center_set" }
```

| Status | When |
|---|---|
| 400 | Invalid `query`, or the location's country is not US/CA |
| 404 | Nothing found for the query, or the location is not yours |
| 429 | Daily search limit reached |
| 502 | Google failed |

### `PUT /api/v1/locations/:locationId/tracking` (Phase 5, extended)

- Unchanged for normal locations.
- On an onboarding location the response adds `onboarding_step`:
  - Setting keywords moves it to `keywords_set`, except while the step is `center_needed`: keywords are saved but the step waits for the center.
  - Sending `competitors` (even `[]`) moves it to `competitors_set`.
- Steps never go backwards.

### `GET /api/v1/locations/:locationId/competitor-suggestions[?refresh=true]`

- One Places search per tracking keyword at the location's center: 2 keywords max in development. It uses the Text Search Enterprise SKU (for rating and review count).
- Results are merged; your own business is excluded (also under an old moved listing).
- Ranked by best position across keywords, then number of keywords, then review count. Top 10.
- Cached for 24 hours per keyword set; `refresh=true` searches again.

```json
{
  "generated_at": "2026-09-26T10:00:00.000Z", "cached": false,
  "keywords_used": ["emergency plumber", "drain cleaning"], "api_calls": 2,
  "suggestions": [
    { "place_id": "ChIJsuggestTest0000000005", "name": "Danforth Pipe Works", "address": "105 Pape Ave, Toronto, ON M4M 1A5, Canada",
      "rating": 4.4, "userRatingCount": 75, "best_position": 1,
      "keywords": [{ "keyword": "emergency plumber", "position": 6 }, { "keyword": "drain cleaning", "position": 1 }],
      "already_selected": false }
  ]
}
```

**Errors:**

| Status | When |
|---|---|
| 400 | No keywords, or no coordinates yet (a service-area business gets them after its first ranking run) |
| 429 | Daily search limit reached |
| 502 | Every search failed |

### `GET /api/v1/places/search?q=&locationId=`

- Manual competitor search: 1 Pro call, up to 10 results, near the location.
- `q` is 2–100 characters. `locationId` is required and must be yours (404 otherwise).
- The location itself is excluded.

```json
{ "results": [{ "place_id": "ChIJ…", "name": "Rival Plumbing", "address": "5 King St, Toronto, ON" }], "api_calls": 1 }
```

**Daily limit:** suggestions and manual search share `PLACES_USER_DAILY_LIMIT` (default 50) Places calls per user per UTC day. Over the limit returns **429** "Daily search limit reached".

### `POST /api/v1/onboarding/complete`

Body: `{ "location_id" }`. It requires a bound profile, a center (lat/lng; 400 "Set the business center first (city or ZIP)." otherwise) and at least 1 keyword.

```json
{ "completed": true, "completed_at": "2026-09-26T10:05:00.000Z",
  "rank_run": { "run_id": "66f5…", "status": "queued", "existing": false },
  "gbp_sync": { "requested_at": "2026-09-26T10:05:00.000Z" } }
```

- It queues the first rank run (dev limits apply) and records a GBP sync request. The sync job arrives in Phase 7b and picks up requested locations.
- Calling it again returns the same state without queuing another run.
- **422:** the run would exceed `RANK_MAX_CALLS_PER_RUN`.

---

## Refresh and GBP sync (Phase 7b)

The data cadence (Mohit, 2026-09-26):
- **Monthly automatic refresh** per location: a rank run and, if the location is GBP-connected, a GBP sync. It is staggered on the day of the month the location completed setup (clamped to 28), at about 03:00 local.
- **Manual refresh** at most once per 24 h per type (`REFRESH_MIN_INTERVAL_HOURS`).
- **Pages never call Google.** Rankings come from `RankRun`; GBP data from the stored sync (the GBP report arrives in 7c).

### `POST /api/v1/locations/:locationId/refresh`

Body: `{ "types"?: ["rankings", "gbp"] }`. By default: rankings, plus gbp when the location is connected.

```json
{
  "rankings": { "run_id": "66f6…", "status": "queued", "existing": false, "estimate": { "idsOnly": { "min": 26, "max": 78, "maxWithRetries": 156 }, "…": "…" },
                "dev_capped": true, "next_allowed_at": "2026-09-27T13:00:00.000Z" },
  "gbp": { "sync_id": "66f6…", "status": "queued", "existing": false, "estimated_calls": 8, "next_allowed_at": "2026-09-27T13:00:00.000Z" }
}
```

- **Inside the 24 h window a type is skipped:** `{ "skipped": "rate_limited", "next_allowed_at": "…" }`.
- An unconnected location gets `"gbp": { "skipped": "gbp_not_connected", "next_allowed_at": null }` (only when gbp was requested explicitly).
- **429** when every requested type is rate-limited (the same body shape). **202** otherwise.
- `estimated_calls` counts GBP API calls (free, quota-limited): performance 1, keywords 1 per month (6 on the first sync, 2 later), profile + attributes + Google edits + verification 4, one possible token refresh; with v4 also reviews, media, customer media, posts. Extra pages add more.

`POST /locations/:id/rank-runs` ("run now") is the same as a rankings refresh: it shares the limit and returns **429** `{ next_allowed_at }` inside the window.

### `GET /api/v1/locations/:locationId/refresh`

```json
{ "frequency": "auto_monthly", "gbp_connected": true,
  "next_refresh_at": "2026-10-26T09:00:00.000Z", "last_auto_refresh_at": null,
  "rankings": { "next_allowed_at": "2026-09-27T13:00:00.000Z", "active_run": { "run_id": "66f6…", "status": "running" } },
  "gbp": { "next_allowed_at": null, "active_sync": null, "last_synced_at": "2026-09-26T09:02:11.000Z" } }
```

`next_allowed_at: null` means the type can be refreshed now.

### `GET /api/v1/locations/:locationId/gbp/sync[?syncId=]`

The latest (or the given) GBP sync:

```json
{
  "gbp_connected": true,
  "sync": {
    "sync_id": "66f6…", "status": "done", "trigger": "onboarding", "backfill": true,
    "run_at": "2026-09-26T09:00:00.000Z", "started_at": "…", "finished_at": "…", "duration_ms": 4210,
    "types": {
      "performance":  { "status": "ok", "message": null, "rows": 6039, "range": { "from": "2025-03-26", "to": "2026-09-25" } },
      "keywords":     { "status": "ok", "message": null, "rows": 214, "range": { "from": "2026-03", "to": "2026-08" } },
      "profile":      { "status": "ok", "message": null, "rows": 1, "range": null },
      "verification": { "status": "ok", "message": null, "rows": 1, "range": null },
      "reviews":      { "status": "not_available", "message": "v4_access_pending", "rows": 0, "range": null },
      "media":        { "status": "not_available", "message": "v4_access_pending", "rows": 0, "range": null },
      "posts":        { "status": "not_available", "message": "v4_access_pending", "rows": 0, "range": null }
    },
    "api_calls": { "total": 11, "by_endpoint": { "performance.dailyMetrics": 1, "performance.searchKeywords": 6, "…": "…" } },
    "failure_reason": null
  },
  "last_synced_at": "2026-09-26T09:00:04.000Z"
}
```

- **Windows:** the first sync backfills 18 months of daily performance and 6 months of search keywords. Later (monthly) syncs fetch a rolling 40 days of performance and the last 2 complete months of keywords. Everything is upserted.
- **Per type:** one failing type makes the sync `partial`; the others are still stored. "Reconnect needed" or "API access not approved (quota 0)" stops the remaining calls and marks them `error` with that message.
- **Before any sync:** `{ "gbp_connected": false, "sync": null, "last_synced_at": null }`.

