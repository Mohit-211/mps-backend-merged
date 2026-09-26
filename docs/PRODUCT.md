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
      ├─ Citations   (legacy module, out of scope for now)
      └─ Reports
```

The backend today still keys ownership by `user` (`created_by`); the **Organization** model arrives in Phase 8.

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
| Dashboard (business and agency) | Aggregates of the above (after Phase 8) |
| Reports | Report center / scheduling: after Phase 8, to be decided |
| Citations | Legacy module (out of scope); citation intelligence is to be decided |
| Automations, AI replies, posts calendar | Later (posting is Phase 9, needs v4) |

## Reports (PDF §13)

The mandatory reports are the Rank Tracker Report, GBP Audit Report, Competitor Analysis Report and Citation Report, plus a report center (list, view, download, email, schedule). The **data** for the first three comes from 7b/7c. The **report center** (PDF export, email, scheduling, white-label rendering) is not planned yet (to pick after Phase 8). The Citation Report depends on the citation decision.

## What the backend will not provide

The PDF's benchmark (BrightLocal-style) shows metrics we deliberately don't have. The frontend must not build screens for them:

- **Organic Google rankings** (website / "Google" result type): Maps / Places only. Our "Local Pack coverage" comes from Maps ranks 1–3 (`top3Rate`), not a Google SERP.
- **Search volume** per keyword (DataForSEO was removed). GBP's own search-keyword impressions (7b) are available instead.
- **Competitor citations, key citations, links, linking domains, website authority**: no SEO-authority data source.
- **Full competitor photo counts**: Places Details doesn't return photo counts on our field set, and requesting `photos` moves the call to the most expensive tier. Photo counts exist only for the client's own profile (v4 media).
- **Google Q&A**: the API was discontinued on 2025-11-03.
- **Duplicate-listing detection**: no data source; not planned.
- **Google Analytics / Search Console integrations**: removed (organic scope).

## Phase map (backend)

- **7b:** GBP sync (monthly).
- **7c:** scoring, report and competitors (**M3**).
- **8:** Auth, Organization, Onboarding & Locations.
- **9:** GBP posting (needs v4).
- **9b:** remaining cleanup.
- **10:** security.
- **After 8:** the next feature is picked with Mohit (reports center, dashboards or citations).
