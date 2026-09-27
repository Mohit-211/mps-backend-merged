# MyPageSEO: product summary (backend view)

A summary of [docs/product/frontend-roadmap.pdf](product/frontend-roadmap.pdf) (the target product, 25 pages) plus Mohit's product decisions, written for backend work. The PDF describes the UI; **this file says what the backend must provide and what it deliberately won't.** Screen-by-screen status is in [FRONTEND_BACKEND_MAP.md](FRONTEND_BACKEND_MAP.md).

## What the product is

A Local SEO management platform for **businesses and agencies** in the US and Canada, about **Google Maps / Google Business Profile visibility only**. The flow is: collect → understand → recommend → execute → measure. Organic website SEO is out of scope (CLAUDE.md §1).

## Users

| User type | Has |
|---|---|
| **Business** | Its own locations, up to a plan limit (e.g. 3). No clients, no white-label. Team management is limited or plan-dependent. |
| **Agency** | Clients, locations assigned to clients, client users, a team, white-label reports, and plan-based location limits. |
| **Client user** (agency only, later) | Sees only the locations and reports assigned to them, under the agency's white-label. |

Signup asks for **Business or Agency**, user details, organization name, country and terms (PDF §5).

## Core hierarchy

```
Organization (type: business | agency; name; country; plan)
 ├─ Team members (users of the organization)
 ├─ Clients                      (agency only)
 │    └─ assigned Locations
 └─ Locations                    (business: direct; agency: optionally assigned to a client)
      ├─ Rankings    (Rank Tracker, Map Rankings, Local Search Grid: one ranking engine)
      ├─ GBP         (overview, audit/health, reviews, posts: needs a GBP connection)
      ├─ Competitors (public comparison, gaps)
      ├─ Citations   (Phase 16: manual, admin-managed tracking; plan approved, build paused)
      └─ Reports
```

Since Phase 8 the backend keys ownership by **organization**: users act through a membership (`owner`, `member`, `client_user`); `created_by` is kept for audit only.

## The Location (the atomic object)

- **A location is one business on Google Maps (usually a GBP).** Every location has a Google **`place_id`**.
- **It can be added in two ways only. There is no manual entry**, so businesses that aren't on Google Maps can't be added.
  - **(a) Connect GBP, then pick a profile** (7a `select-profile`). `source: "gbp"`, `gbp_connected: true`.
  - **(b) Places search, then pick a result.** One Place Details call with minimal fields stores `place_id`, name, address, lat/lng, phone and website. `source: "places_search"`, `gbp_connected: false`.
- A (b) location can **connect its GBP later**. The bind is matched by `place_id`; a bind whose GBP `place_id` differs is refused with a clear error.
- **Without a GBP connection:** rankings and the public competitor comparison work. The GBP report returns the private sections as `{ available: false, reason: "gbp_not_connected" }`, and the Public Score still shows.
- **Duplicates:** the same `place_id` can't be added twice within one organization.
- **Status** (for the locations list): `active` | `setup_required` | `gbp_not_connected` | `reconnect_required`.

## Onboarding (PDF §5)

- **Business:** create account → organization info → connect Google → select GBP (or search Places) → keywords → competitors → confirm → dashboard.
- **Agency:** create account → agency info → connect Google → add first client → select or assign a location → keywords → competitors → reporting brand → dashboard.
- **Resume anywhere.** The state is kept per organization and per location (the location part exists since 7a: `profile_selected` → (`center_needed` → `center_set`) → `keywords_set` → `competitors_set` → `completed`).
- **Empty states the backend must make detectable:**
  - no locations
  - Google not connected
  - connected but no ranking data yet
  - no keywords
  - no competitors
  - no reports yet

## Data cadence (Mohit, 2026-09-26)

- **Monthly automatic refresh** per location: a rank run, then a GBP sync (if bound), then GBP report generation (after the sync).
- **Staggered**: it runs on the day of the month the location finished setup (clamped to 28), at about 03:00 in the location's timezone (UTC fallback). There is no global burst on the 1st.
- **Manual refresh:** `POST /locations/:id/refresh { types?: ["rankings","gbp"] }`.
  - At most once per 24 h per location per type (`REFRESH_MIN_INTERVAL_HOURS`).
  - It returns `next_allowed_at` so the button can be disabled.
- **`tracking.frequency`:** `auto_monthly` (default) | `manual_only`. This replaces weekly / monthly / manual.
- **Pages never call Google.** Everything is fetched in jobs and read from the database.

## Modules and what feeds them

| Module (PDF) | Backend source |
|---|---|
| Rankings: overview, positions, Map Rankings, Local Search Grid, competitor rankings | `RankRun` (Places API New Text Search, rank 1–60 and "60+") |
| GBP overview, audit (health), search keywords, performance | `gbp-sync` → stored metrics, keywords, profile snapshot, verification (7b) → GBP report (7c) |
| Reviews, media, posts (GBP) | GBP v4 API, behind `GBP_V4_ENABLED` (access pending at Google) |
| Competitors | Places Details for tracked competitors + ranks from the same `RankRun` (7c) |
| Dashboard (business and agency) | Stored per-location summaries (Phase 11, `GET /dashboard`) |
| Reports | Reports center (Phase 12): snapshots, PDF, email, share links, monthly schedules, agency white-label |
| Citations | Phase 16 (decided 2026-09-27): manual, admin-managed tracking, no external citation APIs; plan approved, build paused ([plans/phase-16-citations.md](plans/phase-16-citations.md)) |
| Automations, AI replies, posts calendar | Later (posting is Phase 9, needs v4) |

## Reports (PDF §13)

The mandatory reports are the Rank Tracker Report, GBP Audit Report, Competitor Analysis Report and Citation Report, plus a report center (list, view, download, email, schedule). The first three are **built** (Phase 12: the Reports center with snapshots, PDF, email, share links, schedules and white-label). The **Citation Report** comes with Phase 16 and is required for launch (M5).

## What the backend will not provide

The PDF's benchmark (BrightLocal-style) shows metrics we deliberately don't have. The frontend must not build screens for them:

- **Organic Google rankings** (website / "Google" result type): Maps / Places only. Our "Local Pack coverage" comes from Maps ranks 1–3 (`top3Rate`), not a Google SERP.
- **Search volume** per keyword (the third-party vendor was removed 2026-09-27). GBP's own search-keyword impressions (7b) are available instead.
- **Competitor citations, key citations, links, linking domains, website authority**: no SEO-authority data source.
- **Full competitor photo counts**: Places Details doesn't return photo counts on our field set, and requesting `photos` moves the call to the most expensive tier. Photo counts exist only for the client's own profile (v4 media).
- **Google Q&A**: the API was discontinued on 2025-11-03.
- **Duplicate-listing detection**: no data source; not planned.
- **Google Analytics / Search Console integrations**: removed (organic scope).

## Phase map (backend)

- **Done:** 3–7c (ranking, GBP connection, sync, score and report), 8 (auth, organizations, locations), 11 (dashboards and team), 12 (reports center), 12.5 (ranking quality), 10 (security), 8.1 (email verification by link).
- **Remaining for launch (M5):** 16 citations (plan approved, paused), 13 billing & plans, 14 production readiness, plus the Google approvals and the pre-launch live validation.
- **Later:** 9 GBP posting and reviews (needs v4), 15 notifications & automations, 17 ranking extras, 9b cleanup.
- The authoritative table is the Phase roadmap in [CLAUDE.md](../CLAUDE.md) and [STATUS.md](STATUS.md); the big picture is in [PROJECT_SUMMARY.md](PROJECT_SUMMARY.md).
