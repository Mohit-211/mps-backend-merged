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

- **7c:** a refresh that queues something also marks the competitor Place Details for refetch: the report generated after it refreshes competitor facts older than 24 h.
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
  "gbp": { "next_allowed_at": null, "active_sync": null, "last_synced_at": "2026-09-26T09:02:11.000Z" },
  "report": { "pending": true, "scheduled_for": "2026-09-26T13:04:00.000Z", "last_generated_at": "2026-08-26T09:07:40.000Z" } }
```

- `next_allowed_at: null` means the type can be refreshed now.
- `report` (7c): `pending` while a GBP report generation is scheduled (it runs about 2 minutes after a rank run or sync finishes).

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

## GBP report (Phase 7c)

**Generated in a job, never on a page view.** The `gbp-report` job runs about 2 minutes (`REPORT_DEBOUNCE_SECONDS`) after a rank run or a GBP sync finishes, after a change of tracked competitors, and after an unbind. A rank run and a sync finishing together give one report; while either is still running the report waits for it. The stored report is overwritten each time (no history of competitor data); only the client's own scores are kept in `score_history` (last 24).

Examples below come from `npm run seed:gbp-demo` (offline demo data), trimmed.

### `GET /api/v1/locations/:locationId/gbp/report[?range=28d|90d|12m]`

`range` picks the performance window (default `28d`; `12m` = 365 days). Everything else is range-independent.

```json
{
  "location_id": "6ab800103067c8d0f492949c",
  "generated_at": "2026-09-26T17:25:36.832Z",
  "trigger": "gbp_sync",
  "gbp_connected": true,
  "v4_enabled": true,
  "range": "28d",
  "gbp_score": {
    "available": true, "score": 50, "grade": "D", "partial": false, "excluded_pillars": [],
    "pillars": [
      { "id": "completeness", "weight": 25, "available": true, "earned": 18, "available_max": 25, "score": 18 },
      { "id": "activity",     "weight": 20, "available": true, "earned": 3,  "available_max": 20, "score": 3 },
      { "id": "reviews",      "weight": 25, "available": true, "earned": 16, "available_max": 25, "score": 16 },
      { "id": "visibility",   "weight": 20, "available": true, "earned": 6,  "available_max": 20, "score": 6 },
      { "id": "engagement",   "weight": 10, "available": true, "earned": 7,  "available_max": 10, "score": 7 }
    ],
    "checks": [
      { "id": "verified", "pillar": "completeness", "label": "Profile verified", "status": "scored", "value": true, "points": 5, "max": 5,
        "detail": "Verified: you can manage the profile.", "fix_hint": null },
      { "id": "description", "pillar": "completeness", "label": "Description", "status": "scored", "value": 201, "points": 1, "max": 3,
        "detail": "201 characters.", "fix_hint": "Write a description of at least 250 characters (services, area, what makes you different)." },
      "… 24 more checks"
    ],
    "top_fixes": [
      { "id": "map_rank", "pillar": "visibility", "label": "Average map rank", "status": "scored", "value": 21.3, "points": 1, "max": 8,
        "detail": "Average rank 21.3 across your keywords.", "fix_hint": "Improve relevance and prominence for your keywords (categories, reviews, posts)." },
      "… up to 5"
    ]
  },
  "performance": {
    "available": true, "latest_date": "2026-09-23", "range": "28d", "days": 28, "start": "2026-08-27", "end": "2026-09-23",
    "totals": { "impressions": 6871, "maps": 3823, "search": 3048, "mobile": 5243, "desktop": 1628,
                "calls": 103, "website_clicks": 141, "direction_requests": 68, "conversations": 0, "bookings": 0,
                "food_orders": 0, "food_menu_clicks": 0, "actions": 312 },
    "coverage": { "days_with_data": 28, "days": 28 },
    "previous_period": { "start": "2026-07-30", "end": "2026-08-26", "totals": { "impressions": 6434, "…": "…" },
                         "coverage": { "days_with_data": 27, "days": 28 }, "change": { "impressions": 0.068, "actions": 0.072, "…": "…" } },
    "same_period_last_year": { "start": "2025-08-27", "end": "2025-09-23", "totals": { "…": "…" }, "coverage": { "…": "…" }, "change": { "…": "…" } },
    "by_day": [ { "date": "2026-09-23", "impressions": 235, "maps": 129, "search": 106, "actions": 11, "calls": 4, "website_clicks": 5, "direction_requests": 2 }, "…" ],
    "by_surface": { "maps": 3823, "search": 3048 },
    "by_device": { "mobile": 5243, "desktop": 1628 },
    "actions_per_1000_impressions": 45.4,
    "actions_per_1000_change": 0.004
  },
  "keywords": {
    "available": true, "months": ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"], "latest_month": "2026-08",
    "top": [
      { "keyword": "plumber near me", "value": 504, "threshold": null, "previous_value": 487, "change": 17, "tracked": false },
      { "keyword": "emergency plumber", "value": 144, "threshold": null, "previous_value": 151, "change": -7, "tracked": true },
      { "keyword": "toilet repair", "value": null, "threshold": 15, "previous_value": null, "change": null, "tracked": false }
    ],
    "not_tracked": ["plumber near me", "maple leaf plumbing", "plumber toronto", "sump pump installation", "toilet repair"]
  },
  "reviews": {
    "available": true, "average_rating": 4.6, "total": 64, "new_30d": 3, "new_90d": 7, "reply_rate_90d": 0.43, "median_reply_hours": 38.9,
    "per_month": [ { "month": "2026-08", "count": 3, "average_rating": 5 }, { "month": "2026-09", "count": 2, "average_rating": 3.5 } ],
    "distribution": { "1": 0, "2": 5, "3": 0, "4": 6, "5": 49 },
    "unreplied": [ { "rating": 2, "created_at": "2026-09-26T14:37:03.632Z", "excerpt": "Came out within the hour for a burst pipe. Fair price.", "reviewer": null } ]
  },
  "media": { "available": true, "owner_count": 14, "customer_count": 22, "latest_owner_upload": "2026-08-16T17:25:36.539Z", "owner_uploads_per_month": { "2026-08": 3 } },
  "posts": { "available": true, "total": 9, "last_post_at": "2026-09-14T17:25:36.539Z", "last_30_days": 2, "last_90_days": 5, "per_month": { "2026-09": 2 } },
  "pending_google_edits": { "available": true, "has_pending": true, "diff_fields": ["regularHours"], "pending_fields": ["regularHours"] },
  "verification": { "available": true, "has_voice_of_merchant": true, "has_business_authority": true, "state": "VERIFIED" },
  "competitors": {
    "available": true, "generated_at": "2026-09-26T17:25:36.832Z", "warning": null,
    "rows": [
      { "place_id": "ChIJdemoMapleLeafPlumbing01", "is_self": true, "source": "self", "name": "Maple Leaf Plumbing & Heating",
        "rating": 4.6, "user_rating_count": 64, "primary_type": "plumber", "primary_type_label": "Plumber",
        "has_hours": true, "has_website": true, "has_phone": true, "has_editorial_summary": null, "business_status": "OPERATIONAL",
        "fetched_at": "2026-09-26T17:25:36.832Z", "stale": false, "error": null,
        "center_rank": { "avg": 9.3, "top3_rate": 0.33, "keywords_found": 2, "keywords": 3 },
        "public_score": { "score": 71, "flag": null, "parts": [ { "id": "rating", "points": 21, "max": 25, "available": true }, "…",
                          { "id": "editorial_summary", "points": 0, "max": 5, "available": false } ] } },
      { "place_id": "ChIJdemoDanforthDrainPros03", "is_self": false, "source": "tracking", "name": "Danforth Drain Pros",
        "rating": 4.3, "user_rating_count": 38, "has_hours": false, "…": "…", "public_score": { "score": 55, "…": "…" } },
      "… up to 5 competitors (source tracking or map_list)"
    ],
    "insights": [
      { "id": "review_gap", "impact": 0.71, "place_id": "ChIJXbrc…", "message": "Toronto Plumbing sJ_O has 167 reviews; you have 64 (2.6× more). Ask every happy customer for a review." },
      { "id": "rank_gap", "impact": 0.55, "place_id": "ChIJdemoDanforthDrainPros03", "message": "Danforth Drain Pros ranks higher than you at your location (average 7.3 vs 9.3). Compare their categories, reviews and posts with yours." }
    ]
  },
  "sync": { "last_synced_at": "2026-09-26T17:21:36.539Z", "last_status": "done",
            "types": { "performance": { "status": "ok", "message": null }, "…": "…" } },
  "score_history": [ { "generated_at": "2026-09-26T17:25:36.832Z", "gbp_score": 50, "grade": "D", "public_score": 71 } ],
  "api_calls": { "places_details": 5 },
  "inputs": { "rank_run_id": "6ab8…", "sync_id": "6ab8…", "snapshot_id": "6ab8…" },
  "generation": { "pending": false, "scheduled_for": null, "last_generated_at": "2026-09-26T17:25:36.832Z" }
}
```

**Sections that can't be shown** are `{ "available": false, "reason": "…" }`:

| reason | When |
|---|---|
| `gbp_not_connected` | The location has no GBP binding (added via Places search). Every private section: `gbp_score`, `performance`, `keywords`, `reviews`, `media`, `posts`, `pending_google_edits`, `verification`, `sync`. The competitor comparison still works. |
| `v4_access_pending` | `reviews`, `media`, `posts` until Google approves v4 access (`GBP_V4_ENABLED=false`). The GBP Score then excludes the Activity and Reviews pillars: `partial: true`, `excluded_pillars: ["activity", "reviews"]`, rescaled to 100. |
| `not_synced_yet` | Bound, but the first sync hasn't stored that data yet. |
| `no_place_id` | `competitors` for a location without a place ID. |

**GBP Score:** 5 pillars (completeness 25, activity 20, reviews 25, visibility 20, engagement 10); weights and thresholds in `src/gbp/scoring.config.ts`. A check is `scored` or `not_available`; a pillar with no available check is excluded and the rest rescaled. Grades: A ≥ 85, B ≥ 70, C ≥ 55, D ≥ 40, F.

**Public Score:** the same formula for the client and every competitor, from public data only (Place Details + center ranks from the latest rank run's map list). Rating 25, review count 20, center rank 20, center top-3 rate 10, public profile 25 (category, hours, website, phone, editorial summary: the last is `available: false` unless `COMPETITOR_DETAILS_ATMOSPHERE=true`). Closed businesses score 0 with a `flag`.

**Competitors:** the client, `tracking.competitors`, then the top 3 other businesses of the first keyword's map list (max 5 competitors). Place Details are fetched at most once per monthly cycle per business, or on a manual refresh (older than 24 h). A failed fetch keeps the previous facts with `stale: true` and `error`; without a Places key the section has `warning: "places_not_configured"`.

**Errors:** **404** before the first report (`"No GBP report yet: it is generated after the first rank run or GBP sync."`), **400** for another `range`.

For an unbound location (trimmed):

```json
{ "gbp_connected": false, "gbp_score": { "available": false, "reason": "gbp_not_connected" },
  "performance": { "available": false, "reason": "gbp_not_connected" }, "…": "…",
  "competitors": { "available": true, "rows": [ "… client and competitors with public_score …" ], "insights": [ "…" ] },
  "score_history": [ { "generated_at": "…", "gbp_score": null, "grade": null, "public_score": 71 } ] }
```

## Auth, organizations, locations and clients (Phase 8)

Every location, client and report belongs to an **organization** (Business or Agency). A user acts in an organization through a membership: `owner` (everything), `member` (everything except editing the organization), `client_user` (agency; read-only, only the locations of its assigned clients).

- **Current organization:** the `X-Organization-Id` header (one of the caller's organizations, else **403** `not_a_member`), otherwise the user's default organization. No organization → **403** `{ "reason": "no_organization" }`.
- **Location routes** (`/locations/:locationId/...`, including tracking, rank runs, refresh and the GBP report) check membership of the location's organization: another organization's location is **404**; a `client_user` write is **403** `{ "reason": "read_only" }`.
- **Refusals carry a reason** in `data`: `read_only`, `agency_only`, `owner_only`, `location_limit_reached`, `keyword_limit_reached`, `duplicate_place`, `place_id_mismatch`, `email_not_verified`, `rate_limited`.

Examples come from `npm run seed:demo-orgs` (offline demo data), trimmed.

### Auth (`/api/v1/auth`)

Codes are 6 digits, stored hashed, valid 15 minutes (`AUTH_CODE_TTL_MINUTES`), 5 attempts, single use. Rate limits (per email, and per IP once `trust proxy` is set in Phase 10): signup 5/h per IP, login 10/15 min per email + IP, verify 10/15 min, resend 3/h, forgot 3/h per email and 20/h per IP, reset 10/15 min. Above a limit: **429** `{ "reason": "rate_limited", "retry_after_seconds": 3599 }`.

`POST /auth/signup`

```json
{ "account_type": "agency", "name": "Pat Owner", "email": "pat@agency.example", "password": "secret123",
  "organization_name": "Pat Agency", "country": "US", "accept_terms": true }
```
→ **201** `{ "user_id": "…", "organization_id": "…", "email_verification": "sent" }`. The password needs 8+ characters with a letter and a digit. A taken email → **409** `{ "reason": "email_taken" }`.

`POST /auth/verify-email` `{ "email", "code" }` → the session (logs in directly):

```json
{ "verified": true,
  "tokens": { "access": { "token": "…", "expires": "…" }, "refresh": { "token": "…", "expires": "…" } },
  "user": { "id": "…", "email": "pat@agency.example", "name": "Pat Owner", "user_type": "AGENCY" },
  "organizations": [ { "organization_id": "…", "name": "Pat Agency", "type": "agency", "role": "owner" } ],
  "current_organization_id": "…",
  "onboarding": { "id": "…", "type": "agency", "steps": [ { "id": "agency_info", "status": "done" }, { "id": "google", "status": "pending" }, "…" ],
                  "next_step": "google", "completed": false, "completed_at": null } }
```

A wrong code → **400** `{ "reason": "invalid_code", "attempts_left": 4 }`; expired or used up → **400** `{ "reason": "code_expired", "attempts_left": 0 }`; already verified → **400** `{ "reason": "already_verified" }`.

| Endpoint | Body | Response |
|---|---|---|
| `POST /auth/verify-email/resend` | `{ email }` | **200** `{ "email_verification": "sent_if_pending" }`, the same whether or not the account exists |
| `POST /auth/login` | `{ email, password }` | The session (as above, without `verified`). Unverified → **403** `{ "reason": "email_not_verified" }` (call resend). Wrong email or password → **401** (one message for both). Disabled → **403** `account_disabled`. |
| `POST /auth/forgot-password` | `{ email }` | **200** `{ "reset": "sent_if_account_exists" }` |
| `POST /auth/reset-password` | `{ email, code, password }` | **200** `{ "reset": true }`; every refresh token is revoked (log in again) |

Token refresh and logout stay at `POST /user/auth/refresh-auth` and `POST /user/auth/logout`.

### Organization (`/api/v1/organization`)

`GET /organization`

```json
{ "organization": { "id": "6ab8…7270", "name": "Northern Local SEO", "type": "agency", "country": "CA", "created_at": "…" },
  "role": "owner",
  "memberships": [ { "organization_id": "6ab8…7270", "name": "Northern Local SEO", "type": "agency", "role": "owner" } ] }
```

`GET /organization/usage`

```json
{ "plan": { "id": "6ab8…", "name": "Demo Agency (seed)", "source": "subscription" },
  "locations": { "used": 3, "limit": 5 }, "keywords": { "used": 9, "limit": 60 }, "clients": { "used": 2 } }
```

- The plan is the owner's active subscription plan (`subscription_status: ACTIVE` + `current_plan_id`) with its `location_limit` / `keyword_limit`. Otherwise `source: "default"`: `DEFAULT_LOCATION_LIMIT` (1) and `DEFAULT_KEYWORD_LIMIT` (empty = no org-wide cap; 20 per location always applies). `clients` is `null` for a business.
- Over the location limit, an add answers **403** `{ "reason": "location_limit_reached", "used": 1, "limit": 1, "plan": { … } }`. Deleting a location frees its slot at once.
- `PUT /locations/:id/tracking` over the keyword limit: **403** `{ "reason": "keyword_limit_reached", "used": 2, "requested": 2, "limit": 3, "plan": { … } }`.

`PATCH /organization` (owner) `{ name?, country? }` → as GET. `GET /organization/members` (owner/member) → `[{ user_id, name, email, role, client_ids, status }]`.

### Locations (`/api/v1/locations`)

`GET /locations?search=&client_id=&status=&sort=name|city|rank|gbp_score|rating|last_refreshed&order=asc|desc&page=&limit=` (default `sort=name`, `limit=25`, max 100):

```json
{ "locations": [
    { "location_id": "6ab8…727b", "name": "Maple Leaf Plumbing & Heating", "city": "Toronto", "country": "Canada",
      "client": { "client_id": "6ab8…7275", "name": "Maple Leaf Group" }, "source": "gbp", "gbp_connected": true,
      "status": "active", "rank": { "overall_avg_rank": 21.3, "change": 12.6 }, "gbp": { "score": 50, "grade": "D", "partial": false },
      "reviews": { "rating": 4.6, "count": 64 }, "last_refreshed_at": "2026-09-26T18:23:14.983Z", "next_refresh_at": "2026-10-16T18:27:14.983Z" },
    { "name": "Danforth Drain Pros", "source": "places_search", "gbp_connected": false, "status": "gbp_not_connected",
      "rank": { "overall_avg_rank": 10, "change": 0 }, "gbp": null, "reviews": { "rating": 4.3, "count": 38 }, "…": "…" } ],
  "page": 1, "limit": 25, "total": 3 }
```

- **`status`**, first match wins: `setup_required` (onboarding not completed, or no keywords), `reconnect_required` (GBP bound but its Google connection is revoked or gone), `gbp_not_connected`, `active`.
- `rank`, `gbp` and `reviews` come from the latest rank run and GBP report (`null` before there is one). Without GBP, `reviews` shows the public Place Details rating.

`POST /locations` `{ "place_id": "ChIJ…", "client_id"?: "…" }`: add a location from a `GET /places/search` result (no manual entry). One Place Details call (id, name, address with components, location, phone, website, category). US/CA only.

```json
{ "location": { "location_id": "…", "name": "Fredericton Plumbing Co", "city": "Fredericton", "state": "NB", "country": "Canada",
                "source": "places_search", "gbp_connected": false, "status": "setup_required",
                "onboarding": { "step": "place_selected", "started_at": "…", "completed_at": null }, "…": "…" },
  "api_calls": 1 }
```

→ **201**. The same place already in the organization → **409** `{ "reason": "duplicate_place", "location_id": "…" }`. Over the plan limit → **403** `location_limit_reached` (checked before the Places call). Then set keywords and competitors and call `POST /onboarding/complete`.

`GET /places/search?q=` without `locationId` is the add-location search (the organization's country, or `&country=US|CA`); each result carries `already_added` (a location id or `null`).

`GET /locations/:locationId` → the header: `{ location_id, name, address, city, state, country, zip_code, phone, website, business_category, place_id, source, gbp_connected, status, client, lat, lng, timezone, onboarding, created_at }`.

`GET /locations/:locationId/overview` → the header plus the latest stored summaries:

```json
{ "…header": "…",
  "rankings": { "available": true, "run_id": "…", "run_at": "2026-09-25T18:27:14.983Z", "status": "partial", "overall_avg_rank": 21.3, "change": 12.6,
                "keywords": 3, "trend": [ { "run_at": "2026-08-26T18:27:14.983Z", "overall_avg_rank": 33.9 }, { "run_at": "2026-09-25T18:27:14.983Z", "overall_avg_rank": 21.3 } ] },
  "gbp": { "available": true, "score": 50, "grade": "D", "partial": false,
           "top_fixes": [ { "id": "map_rank", "label": "Average map rank", "fix_hint": "Improve relevance and prominence for your keywords (categories, reviews, posts)." }, "…" ] },
  "performance": { "available": true, "range": "28d", "impressions": 6871, "actions": 312, "impressions_change": 0.068, "actions_change": 0.072 },
  "reviews": { "available": true, "rating": 4.6, "count": 64, "unreplied": 10 },
  "competitors": { "available": true, "tracked": 1, "compared": 4, "public_score": 71,
                   "best_competitor": { "place_id": "ChIJdemoDanforthDrainPros03", "name": "Danforth Drain Pros", "public_score": 55 } },
  "refresh": { "frequency": "auto_monthly", "next_refresh_at": "…", "rankings": { "…": "…" }, "gbp": { "…": "…" }, "report": { "…": "…" } },
  "empty_states": { "no_keywords": false, "no_competitors": false, "no_ranking_data": false, "gbp_not_connected": false, "no_reports": false } }
```

A section without data is `{ "available": false, "reason": … }`: `no_keywords`, `no_ranking_data`, `gbp_not_connected`, `no_report`, `no_competitors`, `v4_access_pending`.

`PATCH /locations/:locationId` (owner/member) `{ name?, timezone? (IANA), client_id? (agency; null to unassign) }` → the header. Business data (address, phone, …) comes from GBP / Places and can't be edited.

`DELETE /locations/:locationId` (owner/member): soft delete.

```json
{ "deleted": true, "gbp_unbound": true, "jobs_cancelled": { "rank_run": 0, "gbp_sync": 0, "gbp_report": 1 }, "usage": { "used": 2, "limit": 5 } }
```

Active runs and syncs are ended, their jobs cancelled, the GBP binding removed (tokens kept unless it was that Google account's last binding), history kept. The place can be added again later.

### Clients (`/api/v1/clients`, agency only)

A business organization gets **403** `{ "reason": "agency_only" }`. A `client_user` sees only its own clients, read-only.

`GET /clients?search=&status=ACTIVE|INACTIVE&page=&limit=` → `{ clients: [client], page, limit, total }`; `POST /clients` `{ name, website?, contact_email? }` → **201** client; `PATCH /clients/:clientId` `{ name?, website?, contact_email?, status? }`.

```json
{ "client_id": "6ab8…7275", "name": "Maple Leaf Group", "website": "https://mapleleafgroup.example", "contact_email": "owner@mapleleafgroup.example",
  "status": "ACTIVE", "locations_count": 2, "avg_rank": 21.7, "avg_gbp_score": 49.5, "created_at": "…" }
```

`GET /clients/:clientId` → `{ client, locations: [rows as in GET /locations], summary: { locations: 2, avg_rank: 21.7, avg_gbp_score: 49.5, gbp_connected: 2 } }`.

| Endpoint | Response |
|---|---|
| `DELETE /clients/:clientId` | `{ "deleted": true, "locations_unassigned": 1 }` (its locations stay in the organization) |
| `POST /clients/:clientId/locations` `{ location_id }` | `{ "assigned": true, "client_id", "location_id" }` (the location must be in the organization, else 404) |
| `DELETE /clients/:clientId/locations/:locationId` | `{ "unassigned": true, … }` |

### Onboarding (Phase 8 changes)

`GET /onboarding/state` now starts with the organization's steps (derived from data, resumable):

```json
{ "organization": { "id": "…", "type": "agency",
    "steps": [ { "id": "agency_info", "status": "done" }, { "id": "google", "status": "done" }, { "id": "first_client", "status": "done" },
               { "id": "first_location", "status": "done" }, { "id": "location_setup", "status": "done" }, { "id": "reporting_brand", "status": "done" } ],
    "next_step": null, "completed": true, "completed_at": "…" },
  "empty_states": { "no_locations": false, "google_not_connected": false, "no_ranking_data": false, "no_keywords": false, "no_competitors": false, "no_reports": false },
  "gbp": { "connected": true, "connections": [ "…" ] },
  "locations": [ { "location_id": "…", "name": "…", "source": "gbp", "client_id": "…", "onboarding": { "step": "completed", "…": "…" } } ] }
```

- **Business steps:** `organization_info` → `google` → `first_location` → `location_setup`. **Agency:** `agency_info` → `google` → `first_client` → `first_location` → `location_setup` → `reporting_brand` (Phase 12: `done` once any branding is saved with `PUT /organization/branding`; skippable). Status: `done | pending | skipped | not_available`.
- `POST /onboarding/skip { "step": "google" | "reporting_brand" }` (owner/member): skip Google to add locations from a Places search.
- **Location steps:** `profile_selected` (GBP) or `place_selected` (Places search) → (`center_needed` → `center_set`) → `keywords_set` → `competitors_set` → `completed`.
- `POST /onboarding/select-profile` accepts `client_id` (agency) and is limit-checked when it creates a location. A location of the organization with the same place is linked (connect GBP later). A location with a **different** place → **409** `{ "reason": "place_id_mismatch", "location_place_id", "gbp_place_id" }` (also for `POST /gbp/bind-with-user`).
- `POST /onboarding/complete` no longer needs a GBP binding: it queues the first rank run, the first GBP sync only when bound, and sets the monthly refresh.

## Dashboard and team (Phase 11)

Examples come from `npm run seed:demo-orgs` (offline demo data), trimmed.

### `GET /api/v1/dashboard[?page=&limit=&sort=name|client|rank|rank_change|gbp_score&order=asc|desc]`

The shape follows the organization type. **It reads only the stored per-location summaries** (`Location.summary`, written after every rank run and GBP report), plus location statuses and client names. No rank-run or report documents are read, and nothing calls Google. A `client_user` gets the agency shape for its assigned clients only.

**Business:**

```json
{ "type": "business", "locations_count": 1,
  "visibility": { "avg_rank": 21.3, "change": 12.6, "top3_rate": 0.07,
                  "trend": [ { "run_at": "2026-07-27T…", "avg_rank": 22.9 }, { "run_at": "2026-08-26T…", "avg_rank": 33.9 }, { "run_at": "2026-09-25T…", "avg_rank": 21.3 } ] },
  "gbp": { "available": true, "score": 50, "grade": "D", "change": -13, "partial": false },
  "reviews": { "available": true, "rating": 4.6, "count": 64, "unreplied": 10 },
  "movement": { "improved": 2, "declined": 0, "unchanged": 0, "entered_top_60": 1, "dropped_out_of_top_60": 0, "not_comparable": 0 },
  "key_competitor": { "place_id": "ChIJdemoDanforthDrainPros03", "name": "Danforth Drain Pros", "avg_rank": 10, "self_avg_rank": 21.3, "ahead": true,
                      "location_id": "…", "location_name": "Maple Leaf Plumbing & Heating" },
  "recommended_actions": [
    { "id": "ranking:competitor_ahead", "source": "ranking", "location_id": "…", "location_name": "Maple Leaf Plumbing & Heating",
      "title": "Danforth Drain Pros ranks ahead of you", "detail": "Average rank 10 vs your 21.3. Compare their reviews, categories and posts.", "impact": 0.57 },
    { "id": "gbp:map_rank", "source": "gbp", "title": "Average map rank", "detail": "Improve relevance and prominence for your keywords (categories, reviews, posts).", "impact": 0.35, "…": "…" } ],
  "refresh": { "last_refreshed_at": "2026-09-26T…", "next_refresh_at": "2026-10-16T…" },
  "status_counts": { "active": 1, "setup_required": 0, "gbp_not_connected": 0, "reconnect_required": 0 },
  "locations": [ { "location_id": "…", "name": "Maple Leaf Plumbing & Heating", "status": "active", "avg_rank": 21.3, "change": 12.6, "gbp_score": 50 } ] }
```

- **`visibility`:** `avg_rank` is the overall average map rank (the lower the better). `change` is the previous run minus the latest (positive = improved). `top3_rate` is the share of tracker points in the top 3. With several locations these are the means over the locations with data, and the trend is averaged from the latest run backwards.
- **`gbp`:** `{ available: false, reason: "gbp_not_connected" | "no_report" }` without data. `change` is the difference from the previous report.
- **`reviews`:** `{ available: false, reason: "v4_access_pending" | "gbp_not_connected", public_rating, public_review_count }` until v4 access. The public numbers come from Place Details.
- **`movement`:** keyword changes of the latest rank run vs the previous one (summed over locations).
- **`key_competitor`:** the tracked competitor furthest ahead (or the best-ranked one when none is ahead), or `null`.
- **`recommended_actions`:** the top 5 by `impact` (0–1) across locations. Sources:
  - `connection` (reconnect Google)
  - `setup` (finish setup)
  - `ranking` (a keyword that dropped out of the top 60, the biggest decline, a competitor ahead)
  - `gbp` (the GBP Score's top fixes)

**Agency:**

```json
{ "type": "agency", "clients_count": 2, "locations_count": 3,
  "portfolio": { "avg_rank": 17.8, "avg_rank_change": 4, "avg_top3_rate": 0.05, "avg_gbp_score": 47, "avg_gbp_score_change": -13 },
  "status_counts": { "active": 1, "setup_required": 0, "gbp_not_connected": 1, "reconnect_required": 1 },
  "declines": [ { "location_id": "…", "name": "Queen West Plumbing Co.", "client": { "client_id": "…", "name": "Maple Leaf Group" },
                  "change": -0.7, "declined_keywords": 1, "dropped_out": 0 } ],
  "gbp_issues": [ { "location_id": "…", "name": "Queen West Plumbing Co.", "client": { "…": "…" },
                    "issues": [ { "id": "reconnect_required", "label": "The Google connection was revoked: reconnect" },
                                { "id": "not_verified", "label": "The profile is not verified" },
                                { "id": "pending_google_edits", "label": "Google has suggested edits waiting for review" },
                                { "id": "holiday_hours", "label": "Holiday hours are missing for upcoming holidays" } ] } ],
  "recommended_actions": [ { "id": "connection:reconnect", "source": "connection", "location_name": "Queen West Plumbing Co.", "title": "Reconnect Google", "impact": 0.95, "…": "…" }, "…" ],
  "table": { "rows": [
      { "location_id": "…", "name": "Danforth Drain Pros", "client": { "client_id": "…", "name": "Danforth Services" }, "status": "gbp_not_connected",
        "visibility": { "avg_rank": 10, "change": 0, "top3_rate": 0.07 }, "gbp": null },
      { "location_id": "…", "name": "Maple Leaf Plumbing & Heating", "client": { "…": "…" }, "status": "active",
        "visibility": { "avg_rank": 21.3, "change": 12.6, "top3_rate": 0.07 }, "gbp": { "score": 50, "grade": "D", "change": -13 } } ],
    "page": 1, "limit": 25, "total": 3 } }
```

- **`declines`:** locations whose average rank got worse, or with a keyword that dropped out of the top 60. Worst first, max 10.
- **`gbp_issues`:** `reconnect_required`, `not_verified`, `pending_google_edits`, `sync_failed`, `holiday_hours`; max 10 locations.
- **`table`:** sorted by `sort` / `order` (default `name`); locations without data sort last.

### Team (owner only)

`POST /organization/invitations` `{ "email": "new-teammate@example.com", "role": "member" }` or `{ …, "role": "client_user", "client_ids": ["…"] }` (agency only):

```json
{ "invitation_id": "…", "email": "new-teammate@example.com", "role": "member", "client_ids": [], "status": "pending",
  "expires_at": "2026-10-04T…", "invited_by": "…", "created_at": "…", "email_sent": true }
```

- **The link** is `${FRONTEND_URL}/invite?token=…`. The token is 32 random bytes, stored only as a SHA-256 hash, valid 7 days (`INVITATION_TTL_DAYS`), single use.
- **Inviting the same email again** while it's pending issues a new link; the old one stops working.
- **Development:** no email is sent; the server log shows `invitation for n***@example.com: <link>`.
- **Refusals:** **409** `already_member`; **403** `agency_only` (a client_user in a business); **400** without valid `client_ids`; **429** above 20 invitations an hour per organization.

| Endpoint | Response |
|---|---|
| `GET /organization/invitations[?status=pending\|accepted\|revoked\|expired]` | `[invitation]`, newest first |
| `DELETE /organization/invitations/:invitationId` | `{ "revoked": true, "invitation_id": "…" }` |
| `PATCH /organization/members/:userId` `{ role, client_ids? }` | `{ "user_id", "role", "client_ids" }` |
| `DELETE /organization/members/:userId` | `{ "removed": true, "user_id": "…" }`; the user's default organization moves to another membership |

The owner can't be changed or removed: **403** `{ "reason": "owner_protected" }`. Ownership transfer is not available. `GET /organization/members` rows now include `invited_by` (null for the owner) and `joined_at`.

### Accepting an invitation (public; the token goes in the body, never in the URL)

`POST /auth/invitations/inspect` `{ "token": "…" }`:

```json
{ "organization": { "name": "Northern Local SEO", "type": "agency" }, "email": "new-teammate@example.com", "role": "member",
  "status": "pending", "expires_at": "…", "account_exists": false }
```

**404** for an unknown token; **410** `{ "reason": "expired" | "revoked" | "accepted" }`.

`POST /auth/invitations/accept`:

| Body | Response |
|---|---|
| `{ token, name, password }` for a **new** email | The account is created (verified: the link proves the mailbox) and logged in: `{ "accepted": true, "organization_id", "login_required": false, "tokens", "user", "organizations", "current_organization_id", "onboarding" }` |
| `{ token }` for an **existing** account | `{ "accepted": true, "organization_id": "…", "login_required": true }`: the membership is added; log in normally (the link alone isn't a login) |

A new email without `name` / `password` → **400** `account_details_required`. Rate limit: 20 per 15 minutes per IP (inspect + accept).

## Reports center (Phase 12)

A report freezes stored data (the rank run, the GBP report, the profile snapshot) and the organization's branding in a **snapshot** when it is generated; the PDF is rendered once from it (PDFKit, no browser) and stored privately (`REPORTS_STORAGE_DIR`). Later rank runs, GBP reports or branding changes never change a generated report. Reports older than `REPORT_RETENTION_MONTHS` (24) lose their PDF and snapshot (`status: "expired"`).

**Types and sections** (`sections` optional; default all, in this order):

| Type | Sections |
|---|---|
| `rank_tracker` | `summary`, `keywords`, `history` (last 12 runs), `grid` (heatmap per keyword), `movers` |
| `gbp_audit` | `score`, `checks` (with top fixes), `performance` (`range` 28d/90d/12m), `keywords`, `profile` (with name/phone/website consistency), `verification`, `pending_edits`, `reviews_media_posts` (needs v4) |
| `competitor_analysis` | `public_scores`, `table`, `ranks`, `insights` |
| `full` | the report types it combines: `rank_tracker`, `gbp_audit`, `competitor_analysis` |

A part that can't be shown is `{ available: false, reason }` in `snapshot.data` and an `unavailable` block in the document: `gbp_not_connected`, `v4_access_pending` ("Not available yet: this needs Google My Business v4 access"), `not_synced_yet`, `no_rank_run`, `no_gbp_report`. **Never sample data.**

### `POST /api/v1/reports`

```json
{ "location_id": "6ab8ad2e7c446457a3999f95", "type": "gbp_audit", "range": "90d" }
```

**202**:

```json
{ "report_id": "6ab8ad550854cb0157d88bdf", "type": "gbp_audit", "sections": ["score", "checks", "performance", "keywords", "profile", "verification", "pending_edits", "reviews_media_posts"],
  "status": "queued", "trigger": "manual", "schedule_id": null,
  "location": { "location_id": "6ab8ad2e7c446457a3999f95", "name": "Maple Leaf Plumbing & Heating" },
  "client": { "client_id": "6ab8ad2e7c446457a3999f8f", "name": null },
  "range": "90d", "run_id": null, "pdf": null, "failure_reason": null,
  "created_at": "2026-09-27T05:44:53.101Z", "generated_at": null, "expires_at": null, "archived_at": null, "existing": false }
```

- One active (queued/generating) report per location and type: a repeat returns the active one with `existing: true`.
- **400** `{ reason }`: `invalid_section` (with `allowed`), `no_rank_run`, `gbp_not_connected`, `no_gbp_report`, `no_data`. **404** for a location outside the organization. **403** `read_only` for a client_user.
- Poll `GET /reports/:id` until `status` is `ready` (or `failed` with `failure_reason`).

### `GET /api/v1/reports[?location_id=&client_id=&type=&status=&page=&limit=]`

`status`: `queued | generating | ready | failed | expired | archived` (archived reports are listed only with `status=archived`).

```json
{ "reports": [ { "report_id": "…", "type": "full", "status": "ready", "trigger": "manual",
                 "location": { "location_id": "…", "name": "Danforth Drain Pros" }, "client": { "client_id": "…", "name": "Danforth Services" },
                 "range": "28d", "run_id": "…", "pdf": { "bytes": 36594, "pages": 5 }, "created_at": "…", "generated_at": "…", "expires_at": "2028-09-27T05:41:18.424Z", "archived_at": null } ],
  "page": 1, "limit": 20, "total": 1 }
```

### `GET /api/v1/reports/:reportId`

```json
{ "report": { "report_id": "…", "type": "rank_tracker", "status": "ready", "…": "as in the list" },
  "snapshot": {
    "location": { "name": "Maple Leaf Plumbing & Heating", "address": "100 Queen St E", "city": "Toronto", "state": "ON", "country": "Canada", "client_name": "Maple Leaf Group" },
    "data": { "rank_tracker": { "available": true, "run": { "run_at": "…", "finished_at": "…", "partial": false, "grid_size": 5, "spacing_km": 1 },
                                 "summary": { "overall_avg_rank": 21.3, "change": -1.4, "top3_rate": 0.07, "found_rate": 0.93, "keywords": 3 },
                                 "keywords": [ { "keyword": "Emergency Plumber", "avg_rank": 11.7, "found_rate": 1, "top3_rate": 0, "change": -2, "label": "declined" } ],
                                 "history": [ { "run_at": "…", "overall_avg_rank": 19.9 } ],
                                 "grid": [ { "keyword": "Emergency Plumber", "size": 5, "spacing_km": 1, "cells": [ { "row": 0, "col": 0, "rank": 13, "status": "ok" } ], "avg_rank": 11.7, "found_rate": 1, "top3_rate": 0 } ],
                                 "movers": { "improved": [], "declined": [ { "keyword": "Emergency Plumber", "change": -2 } ], "entered": [], "dropped": [] } } },
    "sources": { "rank_run_id": "…", "gbp_report_generated_at": "…" } },
  "document": {
    "title": "Rank Tracker Report", "period": "Rank run of 26 Sep 2026", "generated_at": "…",
    "branding": { "name": "Northern Local SEO", "primary_color": "#0f766e", "secondary_color": "#b45309", "footer_text": "…", "contact_text": "…", "hide_mypageseo": true, "logo": { "mime": "image/png" } },
    "blocks": [
      { "kind": "heading", "level": 2, "text": "Summary" },
      { "kind": "kpis", "items": [ { "label": "Average rank", "value": "21.3", "sub": "▼ 1.4 vs previous run", "tone": "bad" }, { "label": "Top-3 rate", "value": "7%" } ] },
      { "kind": "table", "columns": [ { "label": "Keyword", "weight": 3 }, { "label": "Avg rank", "align": "right" } ], "rows": [ ["Emergency Plumber", "11.7"] ] },
      { "kind": "line_chart", "title": "Average rank (lower is better)", "points": [ { "label": "28 Jul 2026", "value": 19.9 } ], "lower_is_better": true },
      { "kind": "heatmap", "title": "Emergency Plumber: average 11.7, top-3 0%", "size": 5, "cells": [ { "row": 0, "col": 0, "text": "13", "bucket": "low" } ] },
      { "kind": "unavailable", "title": "Reviews", "message": "Not available yet: this needs Google My Business v4 access." } ] } }
```

- Block kinds: `heading` (level 1 = a part of a Full report), `paragraph` (`muted`), `kpis`, `table` (`highlight` = row indexes, e.g. your business or a NAP mismatch), `line_chart`, `heatmap` (buckets `pack | visible | low | invisible | not_found | error`; text `60+` = not found, `!` = search failed), `list`, `unavailable`, `page_break`.
- `snapshot` and `document` are `null` until `ready`. The logo bytes are at `GET /organization/branding/logo` (current logo) and inside the PDF (the frozen one).

### `GET /api/v1/reports/:reportId/pdf`

`application/pdf`, `Content-Disposition: attachment; filename="maple-leaf-plumbing-heating-gbp-audit-2026-09-27.pdf"`. **409** `{ reason: "not_ready" | "expired" }`.

### `POST /api/v1/reports/:reportId/email`

```json
{ "recipients": ["owner@mapleleafgroup.example"], "message": "Here is this month's report." }
```

→ `{ "sent": true, "recipients": 1, "delivery": "attachment" }` (`"link"` above `REPORT_EMAIL_MAX_ATTACHMENT_MB`, with a 30-day share link in the email). Sender: `"<email_sender_name>"` or `"<agency name> via MyPageSEO"` from the `EMAIL_FROM` address; `Reply-To` from branding. In development nothing is sent: `sent: false` and the delivery is logged with masked recipients. **429** `rate_limited` above 20 per hour per organization.

### Share links

`POST /api/v1/reports/:reportId/share { "expires_in_days": 30 }` (1–365, or `null` / omitted for no expiry) → **201**:

```json
{ "share_id": "6ab8…", "url": "https://api.mypageseo.com/r/Qm9n…43 characters", "expires_at": "2026-10-27T05:44:53.600Z" }
```

The URL (token) is returned **only here**; only its SHA-256 is stored. `GET /reports/:id/shares` → `[{ share_id, purpose: "share"|"email_link", created_at, expires_at, revoked_at, active, views, last_viewed_at }]`; `DELETE /reports/:id/shares/:shareId` → `{ revoked: true }`.

**Public** `GET /r/<token>`: a branded HTML page (header with logo, KPIs, tables, SVG charts, "Download PDF"); `GET /r/<token>/pdf`: the PDF. `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`, CSP `default-src 'none'` (no scripts), no internal ids. Unknown, revoked, expired or archived links give the same **404** page; **429** above 60 requests per minute per IP. The base URL comes from `SHARE_BASE_URL` (else `API_BASE_URL`).

### Scheduled reports (`/api/v1/report-schedules`)

```json
{ "scope": "client", "client_id": "6ab8ad2e7c446457a3999f8f", "type": "gbp_audit", "range": "28d",
  "recipients": ["owner@mapleleafgroup.example", "marketing@mapleleafgroup.example"] }
```

→ **201**:

```json
{ "schedule_id": "…", "scope": "client", "location_id": null, "client_id": "…", "type": "gbp_audit", "sections": ["score", "…"], "range": "28d",
  "recipients": ["owner@mapleleafgroup.example", "marketing@mapleleafgroup.example"], "frequency": "monthly", "status": "active",
  "locations": [ { "location_id": "…", "name": "Maple Leaf Plumbing & Heating" }, { "location_id": "…", "name": "Queen West Plumbing Co." } ],
  "next_expected": "2026-10-17T07:00:00.000Z", "last_sent_at": null, "last_error": null, "last_report_id": null, "created_at": "…" }
```

- **When:** once per monthly automatic refresh of each covered location, right after that location's GBP report is generated; the report is emailed when ready. A client schedule sends one email per location. Manual refreshes don't send.
- `next_expected`: the next monthly refresh of the covered location(s) (the email follows within minutes).
- **400**: `manual_only` (the location never refreshes automatically), `gbp_not_connected` (a GBP Audit schedule for an unbound location). **403** `agency_only` for client scope in a business organization. A failure later (e.g. a client location without GBP) is kept in `last_error`.
- `PATCH { status: "paused" | "active", recipients?, type?, sections?, range? }`; `DELETE` → `{ deleted: true }`. A client_user can read the schedules of its clients.

### Branding (`/api/v1/organization/branding`, white-label: agency only)

`GET` (any member):

```json
{ "white_label": true, "name": "Northern Local SEO", "agency_name": "Northern Local SEO", "primary_color": "#0f766e", "secondary_color": "#b45309",
  "footer_text": "Northern Local SEO · Toronto, ON", "contact_text": "hello@northernlocalseo.example · (416) 555-0199", "hide_mypageseo": true,
  "email_sender_name": "Northern Local SEO", "email_reply_to": "hello@northernlocalseo.example",
  "logo": { "mime": "image/png", "bytes": 559, "url": "/api/v1/organization/branding/logo" }, "updated_at": "…" }
```

A business organization gets `{ "white_label": false, "name": "MyPageSEO", "primary_color": "#1d4ed8", "secondary_color": "#0f766e", "hide_mypageseo": false, … }`.

- `PUT` (owner, agency): any of the fields above; colours `#rrggbb`; `""` clears a text field. **403** `agency_only` / `owner_only`.
- `PUT /logo { "data": "data:image/png;base64,…" }`: PNG or JPEG (checked by content), ≤ 512 KB. **400** `logo_type`, `logo_too_large`. `GET /logo` returns the image (private, not a public URL); `DELETE /logo` removes it.

## Ranking & data quality (Phase 12.5)

No new endpoints. What changed in the responses:

### Full depth and repeated sampling (rank-tracker, grid)

Every search now fetches all pages (up to 60 results). A point can be searched several times (`RANK_SAMPLES_PER_POINT`, default 1 until the variance test decides); its `rank`/`status` is the median of the samples. Each cell shows every sample:

```json
{ "rank": 4, "status": "ok", "bucket": "visible", "display": "4", "samples": [3, 5, 4], "spread": 2 }
```

`samples`: one value per sample (1–60, **61 = not in the top 60**, `null` = the search failed). `spread` = max − min (null with fewer than 2 values). Runs before Phase 12.5 have neither field. The full ordered list of place IDs at every point is stored (collection `rank_result_lists`) but not exposed by an endpoint yet.

`GET /locations/:id/rank-runs/:runId` adds `config: { samples, sample_spacing_sec, map_points }` and `expected_duration_ms`; `estimate` adds `samples` and `mapPoints`.

### `GET /locations/:locationId/map-ranking?keyword=&point=`

The named top 20 is fetched at the center **and** N, S, E, W (`MAP_RANKING_POINTS=all`). `point`: `C` (default), `N`, `S`, `E`, `W`, or `all`.

```json
{ "run": { "…": "…" }, "names_stored": true, "point": "N", "points_available": ["C", "N", "S", "E", "W"],
  "keywords": [ { "keyword": "Emergency Plumber", "point": "N",
                  "results": [ { "rank": 1, "place_id": "ChIJ…", "name": "Riverdale Plumbing", "is_self": false, "target_key": null } ] } ],
  "attribution": { "provider": "Google", "text": "Google Maps" } }
```

**404** for a point the run doesn't have (runs before 12.5 have the center only). **400** for another value.

### Competitor rows (GBP report `competitors.rows`)

```json
{ "place_id": "ChIJ…", "name": "Riverdale Plumbing", "rating": 4.6, "user_rating_count": 212, "…": "…",
  "has_editorial_summary": true, "photo_count": 10, "photos_capped": true,
  "reviews": [ { "rating": 5, "text": "Came the same day…", "publish_time": "2026-09-12T14:03:00.000Z", "relative_time": "2 weeks ago",
                 "author": { "name": "Jordan T.", "uri": "https://www.google.com/maps/contrib/…" } } ],
  "recent_review_at": "2026-09-12T14:03:00.000Z" }
```

- Place Details now request `reviews`, `photos` and `editorialSummary` (Enterprise + Atmosphere SKU). `photo_count` is capped at 10 by Google: show "10+" when `photos_capped`. Review text is shown with its author (`author.name`, linked to `author.uri`).
- New insights: `photos_gap`, `review_freshness`. The editorial-summary part of the Public Score is now available for every business, so scores shift once.

### Attribution

Responses that carry Google Places content include `"attribution": { "provider": "Google", "text": "Google Maps" }`: map-ranking, competitor-suggestions, places/search, the GBP report, `GET /locations`, `GET /locations/:id/overview`, `GET /dashboard` and `GET /reports/:id`. Show the text near business names, ratings and reviews (wording: Google’s policy text “Google Maps”, Mohit 2026-09-27). PDFs and share pages print it under those tables and in the page footer.

### `GET /organization/usage` → `api_usage`

```json
{ "plan": { "…": "…" }, "locations": { "used": 3, "limit": 5 }, "keywords": { "used": 24, "limit": 60 }, "clients": { "used": 2 },
  "api_usage": { "month": "2026-09",
                 "by_sku": { "places.text.ids_only": 2610, "places.text.pro": 150, "places.details.enterprise_atmosphere": 18 },
                 "estimated_cost_usd": 5.25,
                 "previous_month": { "month": "2026-08", "by_sku": {}, "estimated_cost_usd": 0 },
                 "note": "Counts of Google API calls; cost at list prices before Google’s free monthly allowances." } }
```

Every Places and GBP call is counted per organization, location, month and billing SKU (`places.text.ids_only | pro | enterprise`, `places.details.essentials | pro | enterprise | enterprise_atmosphere`, `gbp.<api>`). These are counts, not limits; per-location detail: `npm run cost:report` (OPERATIONS.md).

### Reports

Rank Tracker reports gain the section `map_ranking` ("Who ranks across the area": the top 5 at the 5 points, with your rank at each). Competitor Analysis gains `reviews` ("What customers say": up to 2 recent reviews per business with the author) and a Photos column.

## Platform admin authentication (Phase 10)

Admin endpoints (`/admin/*`, and the admin-only routes listed with `admin (permission)` in [ENDPOINTS.md](ENDPOINTS.md)) take an **admin session token**:

```http
POST /api/v1/admin/auth/login
{ "email": "admin@example.com", "password": "…" }
→ { "id": "…", "name": "…", "email": "admin@example.com", "role_id": 1, "token": "eyJ…" }
Authorization: Bearer eyJ…
```

- **Token:** HS256, signed with `ADMIN_JWT_SECRET`, audience `mps-admin`, valid 12 hours. User tokens never work on admin routes, and the reverse.
- **Revocation:** a password change (`/admin/auth/resetPassword` returns a fresh token), a forgot-password reset, a role or email change, or deactivation ends all earlier admin sessions.
- **Forgot password:** `sendOTP { email }` (same answer whether or not the email is an admin) → `verifyOTP { email, otp, otp_type: "FORGOT_PASSWORD" }` (10-minute code, 5 attempts) → `{ token }` (15 minutes, single use) → `forgotPassword { email, password, confirm_password, token }`.
- **Permissions:**

| Permission | Roles |
|---|---|
| `admins.manage` | super admin |
| `platform.read` | super admin, admin |
| `platform.write` | super admin, admin |
| `content.manage` | super admin, admin, editor |
| `system.read` | super admin |
| `citations.manage` (Phase 16) | super admin, admin, editor |

- **Errors:** no or invalid token → **401**; a missing permission → **403**: `{ "reason": "forbidden", "permission": "platform.read" }`. Rate limits → **429** `rate_limited`.

**Other Phase 10 changes clients see:**
- A bad, expired or revoked **user** token is **401** (it used to be 500 for a bad signature, 404 for a deleted user). Access tokens last 1 day; use `/user/auth/refresh-auth` (or sign in again).
- Password changes and resets end every session of that user.
- Any request key starting with `$` or containing `.` → **400** `{ "reason": "invalid_input", "field": "body.email.$ne" }`.
- Request bodies are limited to 1 MB (**413**). Multipart requests: files only on the upload routes (blog create/update, legacy white-label create/update, GBP post add); elsewhere a file → **400**.
- 500 responses say "Something went wrong." (details only in development).
