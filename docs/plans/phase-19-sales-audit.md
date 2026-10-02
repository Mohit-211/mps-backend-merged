# Phase 19: Sales audit (staff dashboard)

**Approved by Mohit on 2026-10-02. Built the same day on `claude/phase-19-sales-audit`.** Spec: CLAUDE.md §12k. Endpoints: ENDPOINTS.md #172–#177, API.md "Sales audit (Phase 19)".

## Why

Sales staff run a free audit in a meeting with a prospect. It's a mini version of the ranking + GBP system: no GBP connect, one keyword at a time, public Places data only, and nothing kept afterwards.

## Decisions (Mohit, 2026-10-02)

| Question | Decision |
|---|---|
| Staff accounts | **A role, not a new account system.** The existing "Sales Representative" role (`role_id` 8) gets one permission, `audits.run`. Super admin and admin have it too. Staff sign in through the admin login; the frontend gives it its own staff login page. |
| Grid | **Fixed**: 7×7 within 5 km (49 points, spacing 1.667 km). |
| Depth | Ranks **to 30** (2 pages of 20); deeper is "30+". |
| Samples | **1 per point**, so the result is ready in a meeting (the main product uses 3, 60 s apart). |
| Competitor scores | **Yes**: the top 3 other businesses at the business location get the quick score too. |
| Units | **km** everywhere for now (mostly Canada); miles later. |
| History | **None.** Closing deletes the audit; anything left open is deleted after 24 h. |
| Order | Before Phases 14 and 9 (no dependency on either). |

## Design

**Flow:** autocomplete (businesses, US/CA) → `POST /staff/audits { place_id, session, keyword }` (1 Place Details: public facts, position, country) → job `sales-audit` → poll `GET /staff/audits/:id` → `GET …/pdf` → `DELETE`.

**The job:**
1. The IDs-only grid search over 49 points: one sample, 2 pages. New engine option `maxPages`.
2. The named search at the business (Pro). Page 2 is fetched only when the business isn't on page 1 (new client options `maxPages` + `stopWhenFound`). It gives **who ranks higher** and the business's own rank at its location. That rank replaces the grid's center cell, so the heatmap and the list always agree.
3. Place Details for the top 3 others: their Public Score.
4. The summary:
   - `center_rank`
   - `avg_rank` (30+ counted as 31; failed points left out)
   - `found_rate` (top 30)
   - `top3_rate`

**The quick score** is the existing Public Score (version 2, public Place Details only), with a checklist: each part is `good`, `partial` or `missing`, plus the photo count for information. The PDF adds up to 5 "what to work on first" actions, built from the checklist and the review gap to the leading business.

**Storage:**
- Model `SalesAudit` (`sales_audits`), owned by the staff member who started it (the other staff get 404).
- A TTL index on `expires_at` (`STAFF_AUDIT_TTL_HOURS`).
- MongoDB rather than memory, because pm2 runs several processes.

**PDF:**
- The Reports center PDFKit renderer, with MyPageSEO branding, usually 2 pages.
- Part 1: KPIs, the heatmap (legend cut at 30 by a new `max_rank` on the heatmap block), who ranks higher.
- Part 2: the quick score, the checklist, the top-3 comparison and the actions.
- Rendered on request, never stored.

**Limits and cost:**
- `STAFF_AUDIT_DAILY_LIMIT` (20) per staff member per 24 h; Autocomplete keystrokes are limited to 120/h per staff member.
- About **$0.13–0.17 per audit** at list price: 4 Details (Enterprise + Atmosphere), 1–2 Pro, about 98 free IDs-only searches.
- Counted in the usage ledger with the new `purpose: 'sales_audit'` (`cost:report` shows "(sales audits)").

## Files

- **New:**
  - `src/salesAudit/compute.ts`
  - `src/services/salesAudit/{salesAudit.service,executor,document}.ts`
  - `src/models/salesAudit.model.ts`
  - `src/jobs/salesAudit.job.ts`
  - `src/middlewares/salesAudit/salesAudit.validation.ts`
  - `src/controllers/salesAudit/salesAudit.controller.ts`
  - `src/routes/v1/admin/salesAudit.route.ts`
  - tests `tests/salesAudit/compute.test.ts`, `tests/services/salesAudit/salesAudit.test.ts`, `tests/routes/salesAudit.routes.test.ts`
- **Changed (small, shared):**
  - `configs/{config,adminPermissions}.ts` (role key `sales`, `audits.run`, `STAFF_AUDIT_*`, `SALES_ROLE_ID`)
  - the role lists in `controllers/admin/roles.controller.ts` and `services/admin/adminAuth.service.ts`
  - `ranking/engine.ts` (`maxPages`)
  - `clients/placesClient.ts` + `types/places.ts` (names-search paging)
  - `models/apiUsage.model.ts` + `services/usage/{scope,cost}.ts` + `scripts/costReport.ts` (`purpose`)
  - `services/reports/{types,render/theme,render/pdf,render/html}.ts` (heatmap `max_rank`, `type: 'sales_audit'`)
  - `jobs/{index,jobNames}.ts`, `routes/v1/admin/index.ts`, `models/index.ts`
  - the guard and role tests

## Not in scope

- Audit history or saved audits
- Miles
- Several keywords per audit
- A grid size picker
- Emailing the PDF
- Sharing links
- Any GBP data beyond what Places shows publicly
