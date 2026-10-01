# Changelog: methodology changes

Changes that shift numbers users see over time: ranks, averages, the GBP Score or the Public Score. History charts can mark these dates so a jump isn't mistaken for a real change.

**Rule** (Mohit, 2026-09-27): every change of this kind gets an entry here, in the same commit as the change.

**Dates:**
- *Code date* is when the change was merged.
- *Effective* is the first run or report produced by that code on a given server. Add the production deploy date here when it happens.
- Production has not run the rebuilt code yet. Every production number will already use the rules below, so its charts need no markers for these entries unless an older database is migrated.

For the frontend: use the `key` as the marker id and the effective date as its position.

## 2026-10-02: GBP Score and Public Score version 2 (branch `claude/gbp-audit-no-ranking`)

Mohit's rule: ranking data belongs in the ranking report, not the GBP audit.

| Key | What changed | Effect on history charts |
|---|---|---|
| `gbp_score_v2` | The GBP Score drops the average map rank (8) and top-3 rate (6) checks. Visibility and Engagement merge into **Performance (30)**: impressions trend, actions per 1,000 impressions, actions trend. Pillars: completeness 25, activity 20, reviews 25, performance 30. With v4 off the score is Completeness + Performance. The `map_rank` top fix goes with it. | **One-time shift** in the GBP Score and grade. `score_history[].version` is 1 before and 2 after: draw a marker at the first version-2 entry and don't compare across it. Not recomputed (production starts on a fresh database). |
| `public_score_v2` | The Public Score drops center rank (20) and center top-3 rate (10): rating, review count and profile fields, rescaled to 100. Competitor rows lose `center_rank`; the `rank_gap` insight and the Competitor Analysis report's `ranks` section are removed. | **One-time shift** in every Public Score (client and competitors). Same `version` marker on `score_history`. |

## 2026-10-01: Phase 17 (branch `claude/phase-17-ranking-extras`)

| Key | What changed | Effect on history charts |
|---|---|---|
| `change_across_keyword_edits` | **Changes survive keyword edits.** The previous run is the latest finished run whatever its `keywords_version`; a keyword is compared when both runs have it, and the overall change uses only those shared keywords (`comparable_keywords`, `keywords_total` on `overall`). Competitors are matched by place. Before: every change was `null` after an edit. | No shift in ranks or averages. Change values now appear on the first run after an edit where they used to be `null`. `overallAvgRank` still averages all current keywords, so an edit can move it: mark runs whose `keywords_version` differs from the previous run's. |
| `grid_radius_default` | New locations default to a **7×7 grid reaching 8 km** (was 5×5 at 1 km apart, 2 km out), and the Rank Tracker / Map Ranking points sit at **radius ÷ 2** (was 1.5 km). Grid sizes up to 13×13. | Only when a location's grid changes. A wider grid usually means more `not_found` points at the edge, so grid averages rise (worse) and found rates fall; Rank Tracker averages shift with the new N/S/E/W distance. Mark the first run whose `config.radius_km` / `config.grid_size` differs from the previous run's. |

## 2026-09-27: Phase 12.5 (merged `c5aee43`, follow-ups `ef85421` and `7e0eb9c`)

| Key | What changed | Effect on history charts |
|---|---|---|
| `ranking_median_3x60` | **A point's rank is the median of 3 searches, 60 s apart** (was 1 search). | **One-time shift** in ranks, average rank, top-3 rate and found rate, and through them the GBP Score Visibility pillar. Usually small: in the variance test 80–90 % of points were identical across samples, with a max spread of 2–5 places. Show a marker at the first run on or after the effective date. |
| `public_score_editorial` | Competitor and client Place Details always include the **editorial summary**, which was not requested before. | **One-time shift** in every Public Score: the editorial-summary profile part now counts for every business, so scores move once (up for businesses with a summary). Show a marker at the first GBP report on or after the effective date. |
| `ranking_full_depth` | Every search fetches all pages (up to 60 results); before, paging stopped once every tracked business was found. | Ranks unchanged (the target's position was already exact). `result_count` per point is now complete: counts before this date are lower bounds when `more_results` was true. |
| `map_ranking_5_points` | Map Ranking lists at the center **and** N, S, E, W (was center only). | New data only; no shift in existing numbers. Runs before this date have only the center list. |
| `competitor_reviews_photos` | Competitor rows gain reviews (with authors) and photo counts; new insights `photos_gap` and `review_freshness`. | New data and insights; no shift in scores. |

Not a methodology change (listed for completeness): the Google attribution text is "Google Maps" (Mohit, 2026-09-27).
