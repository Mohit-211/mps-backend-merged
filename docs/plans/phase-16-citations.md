> **Status: approved by Mohit on 2026-09-27, build paused** (Mohit, 2026-09-27: "we will get back to citation and other stuff later on"). Nothing from this plan is built yet: no branch, no code.
>
> **To resume:**
> 1. Branch `claude/phase-16-citations` from `claude/rebuild`.
> 2. Re-verify the audit facts in §1: grep the citation files, `serpapi` importers, and the payment code that uses `LocationCitation`.
> 3. Build per §9 and verify per "Verification".
>
> The spec is CLAUDE.md §12f; this file is the approved plan. The Phase 10 admin auth it builds on (`adminOnly` / `requireAdminPermission`, the `citations.manage` permission) is already merged.

# Phase 16: Citations (manual, admin-managed tracking)

## Context

Citations are part of M5: the Citation Report is one of the four mandatory reports, and the admin team needs time to build the directory list (Mohit, 2026-09-27).

- **Spec:** CLAUDE.md §12f.
- **Model:** platform admins keep a master list of directories, attach directories to each location, and record what they find (status, listing URL, NAP as seen). Customers see a read-only dashboard, a table and a Citation Health score, and get a Citation Report in the Reports center.
- **No external citation APIs, no Google calls.**
- **Branch:** `claude/phase-16-citations`, from `claude/rebuild` after the 8.1 merge.
- **Build base:**
  - Phase 10 admin auth (`validateAdminJWTToken`, `requireAdminPermission` / `adminOnly` in `src/middlewares/auth/adminAuth.middleware.ts`)
  - Phase 8 org access (`loadOwnedLocation`, `findLocationForUser`)
  - the Phase 12 reports pipeline (`src/services/reports/`: sections → blocks → PDF / HTML)

## 1. Audit of the old citation module

The old module is a **paid "citation campaign" ordering flow**: prices, credits, campaigns and orders. It also has a SerpAPI "tracker" that returns a hardcoded sample response and a "builder" stub. Its per-directory data is order state, not tracking state. The frontend map already says "don't build on it" (AUDIT C13).

| File / route | Decision | Why |
|---|---|---|
| `routes/v1/common/citation.route.ts`: all 13 `/citation/*` routes (manual pricings, aggregators, remove prices, `lists/:location_id`, campaign add / business info / details / all, `locations/campaigns/list/all`, tracker GET / POST, builder, admin `getAllCitatioList`) | **retire** (unmounted, removed from ENDPOINTS) | They are replaced by §4. The campaign flow sells submissions we don't offer in the new model. The tracker returns fixture data from SerpAPI; the builder is a stub. |
| `controllers/common/citation.controller.ts`, `middlewares/common/citation.middleware.ts`, `services/common/citation.service.ts` (805 lines) | **retire** (deleted) | They serve only the retired routes. The service also makes an **old-Places-API Details call** (`maps.googleapis.com/maps/api/place/details`, `fetchDetails`) with our key: a cost and ToS risk, and it goes with them. |
| `helpers/citation.ts` (`searchCitationWithSerpAPI`) | **retire** | Its only caller is the service. |
| **`serpapi` package** | **removed** from `package.json` | Its only importers are `helpers/citation.ts` and the service (verified with `grep`). No env var to remove (it read none in config). |
| `models/citationDirectories.model.ts` (`CitationDirectory`, collection `citationDirectorys`, plus a commented-out 49-row inline array) | **replace** by `Directory`; the file is deleted | It has one category string, one country, no mapping to business categories and no validation. The inline array is mixed UK / IN / Global / US / CA (19 US, 6 CA). **Reused:** its real US / CA rows seed the starter CSV (§8). |
| `models/locationCitations.model.ts` (order header: credits, `orderStatus`, `paymentStatus`) | **kept, renamed** to model `LegacyLocationCitation` (same collection `locationCitations`) | `payment.middleware.ts` / `payment.service.ts` still attach a credit payment to it (`citation_location_id`). Credits are billing → Phase 13 decides. The rename frees the `LocationCitation` name for the new model (a minimal payments edit, called out). |
| `models/citation.model.ts`, `campaign.model.ts`, `aggregator.model.ts`, `manualCitatonsCreditInfo.model.ts`, `citationDuplicateRemoveCredit.model.ts` | **retire** (files deleted after a zero-reference check) | Used only by the retired service. **Collections are not dropped**; they are listed in `docs/MIGRATION.md`. |
| `creditPayment.model.ts`, `paymentCreditPlans.model.ts`, `User.available_credit` | **untouched** | Payments are Phase 13. |
| `constantTypes.ts` citation enums (`citationStatus`, `citationOrderStatus`, `citationDirectoriesArr`…) | only the ones left unreferenced are removed | The rest stay for payments. |
| Tests | `tests/security/tokens.test.ts` (S15 used `/citation/lists/:id`) moves to the new customer endpoint; `adminGuards` expects the new permission set | |

## 2. Data model (new, in `src/models/`)

**`DirectoryCategory`** (`directory_categories`): industry groups for directories. The 4,101 GBP business categories are too fine to map one by one, so groups are mapped to them.
- **Fields:** `name`, `slug` (unique), `business_category_ids: ObjectId[]` (→ `BusinessCategory`, the GBP names from `dumps/businessCategory.json`), `is_active`, timestamps, `created_by`.
- **Indexes:** `{ slug: 1 }` unique, `{ business_category_ids: 1 }`.

**`Directory`** (`directories`):
- **Fields:**
  - `name`, `url`, `domain` (normalised from the URL, unique)
  - `type: general | niche | aggregator | social | government_chamber`
  - `category_ids: ObjectId[]` (→ DirectoryCategory; empty = every industry; required for `niche`)
  - `countries: ('US'|'CA')[]` (≥ 1), `regions: string[]` (optional state / province codes, e.g. a state chamber)
  - `authority: number | null` (0–100), `notes`, `is_active`, timestamps, `created_by` / `updated_by` (admin ids)
- **Indexes:** `{ domain: 1 }` unique, `{ is_active: 1, countries: 1, type: 1 }`, `{ category_ids: 1 }`, and a text-free name search (escaped regex, like `client.service.ts`).

**`LocationCitation`** (`location_citations`): one directory on one location's list.
- **Fields:**
  - `organization_id`, `location_id`, `directory_id`
  - `status: not_checked | live_correct | nap_wrong | not_found | duplicate | submitted | pending | removed` (default `not_checked`)
  - `listing_url`, `nap_found: { name, address, phone, website }`, `mismatch_fields: ('name'|'address'|'phone'|'website')[]` (computed, §3)
  - `notes`, `last_checked_at`, `checked_by` (admin id), `source: suggested | manual`, `added_by`
  - `active` (false = taken off the list; history kept, re-adding restores it), timestamps
- **Indexes:**
  - `{ location_id: 1, directory_id: 1 }` unique
  - `{ active: 1, status: 1, location_id: 1 }` (unchecked queue)
  - `{ active: 1, last_checked_at: 1 }` (stale queue)
  - `{ organization_id: 1, status: 1 }`, `{ directory_id: 1 }`

**`CitationStatusLog`** (`citation_status_logs`): every change, append-only.
- **Fields:**
  - `location_citation_id`, `location_id`, `organization_id`, `directory_id`
  - `action: added | status_changed | checked | updated | removed_from_list | restored`
  - `from`, `to` (statuses), `changed_fields: string[]`, `note`, `by: { admin_id, name }` (snapshot), `at`
- **Indexes:** `{ location_id: 1, at: -1 }`, `{ location_citation_id: 1, at: -1 }`, `{ at: -1 }` (recently changed), `{ organization_id: 1, at: -1 }`.

**`Location.summary`** gains `citation_score`, `citation_grade`, `citation_counts` (by status) and `citation_checked_at`. They are written on every citation change, the same write-path pattern as `updateSummaryFromReport`.

## 3. Suggestions and editing a location's list

`suggestDirectories(location)` in `src/services/citations/suggest.ts` (pure matching plus a loader):
1. **Country:** `regionFromCountry(location.country)` (`src/ranking/region.ts`) → `US` / `CA`. Anything else gets no suggestions (`reason: unsupported_country`).
2. **Location categories:**
   - `location.business_category` (the GBP primary category or the Places `primaryTypeDisplayName`), plus the GBP additional categories from the latest `GbpProfileSnapshot` when bound
   - matched case-insensitively by exact name to `BusinessCategory`, then to the `DirectoryCategory` groups containing them
3. **Matching directories:** active directories with the country, where either:
   - **(a)** `category_ids` is empty (general, aggregator, social, and government / chamber without categories), or
   - **(b)** it shares a category group with the location.

   Plus, for directories with `regions`, the location's state or province must match.
4. **Result:** each match is upserted as `not_checked` with `source: suggested` (never duplicates, never re-adds an entry an admin removed) and logged `added`. When the category matched no group, the response says `category_matched: false` so the admin knows only general directories were added.

**When it runs:**
- automatically at onboarding `/complete` (a hook in `onboarding.service.ts`, after the rank run is queued; failures are logged, never block completion)
- on demand: `POST /admin/citations/locations/:id/suggest` (`dry_run=true` previews)

A directory added to the master list later is picked up by re-running suggest.

**Admin edits per location:**
- add any active directory (`source: manual`), even a non-matching one
- remove one from the list (`active: false`, logged)
- update an entry: status, listing URL, NAP found, notes; or "checked, no change" (`checked: true`, which only sets `last_checked_at` / `checked_by` and logs `checked`)

**`mismatch_fields`:** computed on the server by comparing `nap_found` with the location's name / address / phone / website. It reuses `normaliseName` / `normalisePhone` / `normaliseWebsite` (moved from `src/services/reports/sections/gbpAudit.ts` to `src/utils/nap.ts`), plus a new `normaliseAddress` (street number + street tokens with common abbreviations, ZIP / postal code).
- `live_correct` with mismatches → **409** `{ reason: "nap_mismatch", mismatch_fields }` unless `confirm: true`.
- Changing status, NAP or URL, or checking, sets `last_checked_at` / `checked_by`. Every change writes one log row and recomputes the location summary.

## 4. Endpoints

**New permission:** `citations.view` (super admin, admin, editor), next to Phase 10's `citations.manage` (super admin, admin, editor). They are separate so a future read-only / support role can get view only.

**Admin** (`/api/v1/admin/citations`; `validateAdminJWTToken` + `requireAdminPermission`; ENDPOINTS auth column `admin (citations.view|manage)`, so the guard matrix test covers every one):

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/directories` | view | List: `q`, `type`, `country`, `category_id`, `active`, page / limit |
| GET | `/directories/:id` | view | Detail + usage count |
| POST | `/directories` | manage | Create |
| PATCH | `/directories/:id` | manage | Update |
| DELETE | `/directories/:id` | manage | Deactivate (existing entries stay, marked inactive in lists) |
| GET | `/directories/export` | view | CSV download (§7) |
| POST | `/directories/import?dry_run=` | manage | CSV import, `text/csv` body ≤ 1 MB, all-or-nothing |
| GET | `/categories` | view | Directory categories with directory counts |
| POST / PATCH / DELETE | `/categories[/:id]` | manage | CRUD; delete refused (409 `in_use`) while directories use it |
| GET | `/business-categories?q=` | view | Search the 4,101 GBP categories for mapping (escaped regex, 20 results) |
| GET | `/locations/:locationId` | view | Location NAP + entries + counts + score + `category_matched` |
| POST | `/locations/:locationId/suggest?dry_run=` | manage | Add matching directories |
| POST | `/locations/:locationId/entries` | manage | `{ directory_ids[] }` add manually |
| PATCH | `/entries/:entryId` | manage | `{ status?, listing_url?, nap_found?, notes?, checked?, confirm?, note? }` |
| POST | `/entries/bulk` | manage | `{ entry_ids[] (≤ 200), status, note }`, e.g. mark as submitted |
| DELETE | `/entries/:entryId` | manage | Take off the list (`POST .../restore` brings it back) |
| POST | `/entries/:entryId/restore` | manage | Restore |
| GET | `/entries/:entryId/history` | view | Log rows, newest first |
| GET | `/queue/unchecked` | view | Locations with `not_checked` entries: counts, oldest added; sorted oldest first |
| GET | `/queue/stale?days=` | view | Entries not checked for N days (`CITATION_STALE_DAYS`, default 90; `not_checked` excluded, that's the first queue) |
| GET | `/queue/recent?days=` | view | Log rows of the last N days (default 7) |

**Queue filters** (all three): `organization_id`, `client_id` (resolved to that client's location ids), `status`, `directory_id`, `type`, page / limit (max 100). Deleted locations and inactive entries are excluded.

**Queries:**
- `unchecked` = an aggregate on `location_citations { active: true, status: 'not_checked' }` grouped by `location_id`, joined to `locations` (name, organization, client). Index `{ active, status, location_id }`.
- `stale` = `{ active: true, status: { $ne: 'not_checked' }, last_checked_at: { $lt: now − N days } }`, sorted by `last_checked_at`. Index `{ active, last_checked_at }`.
- `recent` = `citation_status_logs { at: { $gte } }`. Index `{ at: -1 }`.

**Customer** (user auth + `loadOwnedLocation`: organization membership, and a client_user only for its assigned clients; **GET only**, read-only for every organization role):

| Method | Path | Purpose |
|---|---|---|
| GET | `/locations/:locationId/citations?status=` | Dashboard + table: score, grade, coverage, counts by status, the last 10 changes, and rows (directory name, URL, type, status, NAP issues, listing link, last checked) |
| GET | `/locations/:locationId/citations/changes?page=` | Paginated change history |

- Admin identities are not shown to customers: `by` becomes "MyPageSEO team".
- An empty list → `{ available: false, reason: "no_citations_yet" }`.

**Dashboard / list:**
- The Business dashboard's "Citation health" (FRONTEND_BACKEND_MAP: planned 16) and the agency location rows read `summary.citation_*`.
- One recommended action is added in `src/services/dashboard/actions.ts`: "N citations show wrong NAP" (`nap_wrong` > 0).
- `summaries:rebuild` fills the new fields.

## 5. Citation Health score (`src/citations/scoring.config.ts`)

```ts
STATUS_POINTS = { live_correct: 1, nap_wrong: 0.4, duplicate: 0.3, submitted: 0.3, pending: 0.3, not_found: 0 }
EXCLUDED = ['not_checked', 'removed']   // not scored; not_checked lowers coverage
TYPE_WEIGHTS = { aggregator: 1.5, niche: 1.2, general: 1, government_chamber: 1, social: 0.8 }
AUTHORITY = { enabled: true, factor: 0.5 }  // weight × (1 + factor × authority/100); no authority → × 1
GRADES = the GBP Score bands (A ≥ 85, B ≥ 70, C ≥ 55, D ≥ 40, F)
MIN_SCORED = 1                            // fewer scored entries → score null ("not_available")
```

- **Score** = round(100 × Σ wᵢ·pointsᵢ / Σ wᵢ) over scored entries.
- **Coverage** = scored / (active entries − `removed`).
- A pure function `citationHealth(entries)` returns `{ score, grade, coverage, counts, scored, total }`.

**Worked example** (6 entries):

| Directory | Type | Authority | Status | Weight | Points | w × p |
|---|---|---|---|---|---|---|
| Yelp | general | 93 | live_correct | 1 × 1.465 = 1.465 | 1 | 1.465 |
| Data Axle | aggregator | 80 | nap_wrong | 1.5 × 1.40 = 2.100 | 0.4 | 0.840 |
| Avvo | niche | 70 | not_found | 1.2 × 1.35 = 1.620 | 0 | 0 |
| Yellow Pages | general | 85 | submitted | 1 × 1.425 = 1.425 | 0.3 | 0.428 |
| Facebook | social | 96 | live_correct | 0.8 × 1.48 = 1.184 | 1 | 1.184 |
| BBB | general | 90 | not_checked | – | – | excluded |

Σw = 7.794 and Σ(w × p) = 3.917, so the **score is 50 (grade D)**. Coverage is 5/6 = 83 %. Fixing the Data Axle NAP (→ live_correct) raises the score to 66 (C): Σ(w × p) becomes 5.177.

## 6. Citation Report (Reports center)

- **Type:** `citation` joins `REPORT_TYPES` (`src/models/report.model.ts`).
  - Sections: `score` (score, grade, coverage, counts), `table` (every active entry), `nap_issues` (entries with mismatches: found vs expected per field), `changes` (log rows in the report's range: 28d / 90d / 12m, as other reports).
  - `full` gains a `citation` part; existing full-report snapshots stay valid.
- **Pipeline:** `src/services/reports/sections/citations.ts` (`buildCitationData`, like `competitors.ts`) is frozen into the `ReportSnapshot`. `blocks.ts` gets a "Citations" part built from existing block types (KPI, table, list), so the PDFKit and HTML renderers need no new primitives. No run or GBP report is needed; an empty list gives the part `off('no_citations_yet')`.
- **Schedules, email and share links work unchanged** (they are type-agnostic). A scheduled citation report is generated after the monthly refresh like the others.
- `REPORT_SECTIONS` validation, API.md, the `reports` endpoints doc and FRONTEND_BACKEND_MAP ("Citation Report: available") are updated.
- The snapshot holds our own data only (directory names and URLs, statuses, NAP as recorded), with no Places content.

## 7. CSV import / export

- **Columns** (header required, this order on export, any order on import): `name, url, type, countries, categories, regions, authority, notes, active`.
- **Lists** are pipe-separated (`US|CA`, `home-services|legal`, `TX|ON`). **Categories** are directory-category **slugs**. **Upsert key** = the domain normalised from `url` (lowercase, no scheme, no `www.`, no path).
- **Validation per row** (row number + field + message):

| Field | Rule |
|---|---|
| name | 1–120 characters |
| url | http(s) URL ≤ 300 |
| type | one of the 5 types |
| countries | a non-empty subset of `US|CA` |
| categories | existing slugs; required for `niche` |
| regions | 2-letter US state / CA province codes valid for the listed countries |
| authority | empty or an integer 0–100 |
| active | `true|false|` (empty = true) |
| file | domains unique within the file; ≤ 2,000 rows |

- **Import** is all-or-nothing: `dry_run=true` returns `{ created, updated, unchanged, errors[] }`, and any error applies nothing. Directories absent from the file are **not** deleted.
- **Export** protects against CSV injection: cells starting with `= + - @` get a `'` prefix. UTF-8 with BOM for Excel.
- **Library:** `csv-parse` + `csv-stringify` (sync APIs; new dependencies).

## 8. Seed and starter list

- **`src/scripts/data/citation-directories.csv`** (the §7 format, so the seed also exercises the importer): about 40 US / CA directories.
  - **aggregator:** Data Axle, Neustar Localeze, Foursquare
  - **general:** Bing Places, Apple Business Connect, Yelp, Yellow Pages (US), YellowPages.ca, BBB, Superpages, MapQuest, Manta, Hotfrog, Cylex, EZlocal, Brownbook, Chamberofcommerce.com, Canada411, 411.ca
  - **social:** Facebook, Instagram, LinkedIn, Nextdoor
  - **niche:**
    - home services: Angi, HomeAdvisor, Houzz, Thumbtack, Porch, HomeStars (CA)
    - legal: Avvo, Justia, FindLaw, Lawyers.com
    - medical / dental: Healthgrades, Zocdoc, Vitals, RateMDs (CA)
    - restaurants: Tripadvisor, OpenTable
    - automotive: CarGurus, RepairPal
  - **government_chamber:** U.S. Chamber of Commerce directory, Canadian Chamber of Commerce, one region-limited example
  - Authority values are rough placeholders, marked in `notes`. The old inline rows' US / CA entries are merged in.
- **`src/scripts/data/directory-categories.json`:** 5 groups (home-services, legal, medical-dental, restaurants, automotive), each listing GBP category names (e.g. Plumber, Electrician, HVAC contractor…), resolved to `BusinessCategory` ids at seed time. Unknown names are reported, not fatal.
- **`npm run seed:citation-directories [-- --confirm]`:** categories + directories. Idempotent upsert; usable to bootstrap the production master list, which the admin team then edits.
- **`seed:demo-orgs`** additionally:
  - runs that seed
  - gives each demo location a suggested list with mixed statuses: live_correct, nap_wrong (with `nap_found` / mismatches), not_found, submitted, pending, duplicate, not_checked
  - writes 60 days of log history from a demo admin
  - fills the summary
  - generates one Citation Report and one Full Report including citations

## 9. Files

**Create:**
- **Models:** `src/models/{directory,directoryCategory,locationCitation,citationStatusLog}.model.ts`
- **Logic:** `src/citations/{scoring.config.ts, health.ts}` (pure), `src/utils/nap.ts` (moved helpers + `normaliseAddress`)
- **Services:** `src/services/citations/{directory.service, category.service, csv, suggest, entries.service, queue.service, customer.service, summary}.ts`
- **HTTP layer:**
  - `src/middlewares/citations/citations.validation.ts` (Joi)
  - `src/controllers/citations/{admin,customer}.controller.ts`
  - `src/routes/v1/admin/citations.route.ts` (mounted at `/admin/citations`)
  - customer routes added to a new `src/routes/v1/common/citations.route.ts` under `/locations`
- **Reports:** `src/services/reports/sections/citations.ts`
- **Seed:** `src/scripts/seedCitationDirectories.ts`, `src/scripts/data/{citation-directories.csv,directory-categories.json}`
- **Tests:**
  - `tests/citations/{health,suggest,nap,csv}.test.ts` (pure)
  - `tests/routes/citationsAdmin.routes.test.ts`, `tests/routes/citationsCustomer.routes.test.ts`
  - `tests/services/reports/citationReport.test.ts`

**Modify:**
- **Config and access:** `src/configs/adminPermissions.ts` (`citations.view`), `src/configs/config.ts` + `.env.example` (`CITATION_STALE_DAYS`)
- **Models:** `src/models/index.ts`; `src/models/location.model.ts` (summary fields); `src/models/report.model.ts` (type `citation`, full part)
- **Reports:** `src/services/reports/{report.service,blocks,types}.ts`
- **Onboarding and dashboard:** `src/services/onboarding/onboarding.service.ts` (suggest hook), `src/services/dashboard/{actions,…}.ts`, the summary rebuild script
- **Moved helpers:** `src/services/reports/sections/gbpAudit.ts` (imports from `utils/nap`)
- **Payments:** `src/models/locationCitations.model.ts` → `LegacyLocationCitation`, with its two payment imports (minimal payments edit, flagged)
- **Retirement:** `src/routes/v1/common/index.ts` (unmount `/citation`), the controllers / middlewares / services barrels, `package.json` (−`serpapi`, +`csv-parse`, +`csv-stringify`, +`seed:citation-directories`), `src/scripts/syncIndexes.ts` (new models)
- **Tests:** `tests/security/tokens.test.ts`, `tests/routes/adminGuards.routes.test.ts`
- **Docs:** ENDPOINTS.md, API.md (admin + customer sections, CSV format, score formula), FRONTEND_BACKEND_MAP.md (citation rows → available), AUDIT (C13 closed), MIGRATION.md (retired collections), OPERATIONS.md (deploy: `db:sync-indexes`, `seed:citation-directories -- --confirm`), CLAUDE.md §12f as built + roadmap, STATUS, PROGRESS

**Delete:** the retired citation controller / middleware / service / helper and the five retired model files (after zero-reference checks).

## Verification

- **Checks:** `npm run build` (0 errors), lint (stays 32), `npm test` offline (includes `check:endpoints` and the admin guard matrix over every new `admin (citations.*)` row).
- **Unit tests:**
  - the §5 worked example exactly (50 / D, coverage 0.83), plus all-excluded → null
  - suggest: country, category group, regions, removed entries not re-added, unsupported country
  - NAP normalisation and mismatch fields
  - CSV: every validation rule, dry run, all-or-nothing, upsert by domain, injection-safe export, round trip export → import = unchanged
- **Route tests:**
  - editor can view and manage; a user token → 401; another organization's location → 404 for customers; a client_user only sees its clients
  - status change → a log row + the summary updated
  - `nap_mismatch` 409 / `confirm`; bulk update
  - the three queues with filters
  - customer view hides admin names
  - retired `/citation/*` → 404
- **Reports:** a citation report snapshot + PDF render (page count > 0), a full report with a citation part, a scheduled citation report, a share-link HTML with the citation part.
- **Dev server:**
  - `seed:citation-directories`, `seed:demo-orgs`
  - admin login → directories, CSV export / import dry run, the location list, update an entry, the queues
  - user → `/locations/:id/citations`, the dashboard citation block, generate a Citation Report PDF
  - 0 Google calls; kill all three dev processes
- **End:** docs per the standing rule; merge + push commands.

## Decisions for approval

1. **Retire the whole legacy `/citation/*` module** (13 routes, controller, middleware, service, helper, 5 models) and **remove `serpapi`**. Keep the old order model as `LegacyLocationCitation` for the credit-payment code until Phase 13 decides about citation credits. Collections are kept.
2. **Permissions:** `citations.view` and `citations.manage` both go to super admin, admin and editor for now (the split allows a future read-only role).
3. **Directory categories are industry groups** mapped to many GBP business categories. Directories with no category apply to every business. Suggestions run automatically at onboarding completion and on demand; they never remove anything.
4. **Score defaults** as in §5. `removed` and `not_checked` are excluded from the score (coverage shows unchecked); `nap_wrong` earns 0.4; authority weighting is on with factor 0.5. Everything is tunable in the config file.
5. **`live_correct` with a computed NAP mismatch is refused** unless the admin confirms.
6. **New dependencies** `csv-parse` + `csv-stringify` (instead of a hand-written CSV parser).
7. **Customers see "MyPageSEO team"**, never the admin's name, in change history.
