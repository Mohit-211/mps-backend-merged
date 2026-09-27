# Changelog: methodology changes

Changes that shift numbers users see over time: ranks, averages, the GBP Score or the Public Score. History charts can mark these dates so a jump isn't mistaken for a real change.

**Rule** (Mohit, 2026-09-27): every change of this kind gets an entry here, in the same commit as the change.

**Dates:**
- *Code date* is when the change was merged.
- *Effective* is the first run or report produced by that code on a given server. Add the production deploy date here when it happens.
- Production has not run the rebuilt code yet. Every production number will already use the rules below, so its charts need no markers for these entries unless an older database is migrated.

For the frontend: use the `key` as the marker id and the effective date as its position.

## 2026-09-27: Phase 12.5 (merged `c5aee43`, follow-ups `ef85421` and `7e0eb9c`)

| Key | What changed | Effect on history charts |
|---|---|---|
| `ranking_median_3x60` | **A point's rank is the median of 3 searches, 60 s apart** (was 1 search). | **One-time shift** in ranks, average rank, top-3 rate and found rate, and through them the GBP Score Visibility pillar. Usually small: in the variance test 80–90 % of points were identical across samples, with a max spread of 2–5 places. Show a marker at the first run on or after the effective date. |
| `public_score_editorial` | Competitor and client Place Details always include the **editorial summary**, which was not requested before. | **One-time shift** in every Public Score: the editorial-summary profile part now counts for every business, so scores move once (up for businesses with a summary). Show a marker at the first GBP report on or after the effective date. |
| `ranking_full_depth` | Every search fetches all pages (up to 60 results); before, paging stopped once every tracked business was found. | Ranks unchanged (the target's position was already exact). `result_count` per point is now complete: counts before this date are lower bounds when `more_results` was true. |
| `map_ranking_5_points` | Map Ranking lists at the center **and** N, S, E, W (was center only). | New data only; no shift in existing numbers. Runs before this date have only the center list. |
| `competitor_reviews_photos` | Competitor rows gain reviews (with authors) and photo counts; new insights `photos_gap` and `review_freshness`. | New data and insights; no shift in scores. |

Not a methodology change (listed for completeness): the Google attribution text is "Google Maps" (Mohit, 2026-09-27).
