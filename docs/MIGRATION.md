# Migration

**The launch uses a fresh database; no legacy data is migrated** (Mohit, 2026-09-28). The production database of the old system has no data worth keeping. A new server starts empty and is set up with `npm run setup:fresh -- --confirm` (OPERATIONS.md "Deploy checklist"). Every data-migration script was removed in Phase 13b (list in [LEGACY_FEATURES.md](LEGACY_FEATURES.md)).

## Old collections that won't exist

These belonged to the old system or to removed features. The fresh database never creates them; the old database is not carried over.

| Collection | Was used by |
|---|---|
| `rank_tracker_reports`, `local_search_grid_reports`, `local_map_ranking_reports` | old ranking pages (replaced by `rank_runs`, Phase 5) |
| `gbp_audit_reports` | old GBP audit (replaced by the GBP report, Phase 7c) |
| `citationDirectorys`, `citations`, `campaigns`, `aggregators`, `manualCitatonsCreditInfos`, `citationDuplicateRemoveCredits`, `locationCitations` | old citation module and orders (replaced in Phase 16) |
| `subscription_plans`, `user_subscriptions`, `payments`, `paymentCreditPlans`, `location_credit_payments` | old plans, guest checkout, Square credits (replaced by billing, Phase 13a) |
| `whitelabel_profiles` | old white-label profiles (replaced by organization branding, Phase 12) |
| `supports` | old support tickets (replaced by 13b support tickets) |
| `otps` | old OTP login / reset flows (replaced by `/auth`, Phases 8 and 8.1) |
| `user_attachments` | never used |

## Environment variables no longer read

Leave them out of the new server's `.env`:
- Stripe, Razorpay, Square (`SQUARE_*`), SerpAPI, Moz, the keyword search-volume vendor, Search Console (`GOOGLE_ANALYTICS_*`), `GOOGLE_PLACE_API_URL`
- `DEFAULT_LOCATION_LIMIT`, `DEFAULT_KEYWORD_LIMIT` (limits come from billing)
- Never read by any code: `APPLY_ENCRYPTION`, `SECRET_KEY`, `COMPANY_*`, `COMAPNY_ADDRESS`, `JWT_RESET_PASSWORD_EXPIRATION_MINUTES`, `JWT_VERIFY_EMAIL_EXPIRATION_MINUTES`, `ADMIN_BASE_URL`, `ENG_ROLE_ID`, `FIN_ROLE_ID`, `MRK_ROLE_ID`, `HR_ROLE_ID`, `SALES_ROLE_ID`
