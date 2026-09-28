# Data and configuration migration notes

For whoever sets up or cleans a server database. Nothing here runs automatically. **No collection has been dropped by code.**

## Collections no longer used

The legacy cleanup (branch `claude/phase-9a-legacy-cleanup`) removed the code that read and wrote these. Archive or drop them once you're sure nothing else reads them. On the planned fresh server database they won't exist at all.

| Collection | Was used by | Replaced by |
|---|---|---|
| `rank_tracker_reports` | old Rank Tracker | `rank_runs` (Phase 5) |
| `local_search_grid_reports` | old Local Search Grid | `rank_runs` |
| `local_map_ranking_reports` | old Local Map Ranking | `rank_runs` |
| `gbp_audit_reports` | old GBP Audit | the GBP report (Phase 7c) |
| `citationDirectorys` | old citation directory list (Phase 16 retired it) | `directories` + `directory_categories` (Phase 16) |
| `citations` | old citation campaign line items | `location_citations` + `citation_status_logs` (Phase 16) |
| `campaigns` | old citation campaigns | – (the paid campaign flow was retired in Phase 16) |
| `aggregators`, `manualCitatonsCreditInfos`, `citationDuplicateRemoveCredits` | old citation pricing / credit tables | – (retired in Phase 16) |
| `subscription_plans` | legacy plans (guest checkout, Phase 8 `location_limit`) | `billing_plans` (Phase 13a) |
| `user_subscriptions` | legacy per-user subscriptions (unused) | `subscriptions` (Phase 13a) |
| `paymentCreditPlans`, `location_credit_payments` | Square citation credits | – (retired in Phase 13a) |
| `locationCitations` | legacy citation orders, read by the credit payments | – (retired in Phase 13a) |
| `supports` | legacy support tickets (removed in 13b) | 13b support tickets; migrated by the 13b ticket migration |
| `whitelabel_profiles` | legacy white-label profiles (removed in 13b) | organization branding; still read by `npm run migrate:branding` until production has run it |
| `user_attachments` | nothing (the model was never used) | – (removed in Phase 13b) |
| `payments` | legacy guest-checkout PayPal payments | **still read** by `migrate:billing` and the admin legacy-link endpoint (`/admin/billing/legacy-payments`); archive only after every paid row is linked |

**Archive example** (run against the right database, after a backup):

```sh
mongodump --uri "<server mongodb uri>" --collection rank_tracker_reports --out ./archive-$(date +%F)
# then, only if wanted:
mongosh "<server mongodb uri>" --eval 'db.rank_tracker_reports.drop()'
```

## Rows and fields no longer used

- **`user_auths` rows with `token_type: 'ANALYTICS'`:** Search Console tokens. The connect flow was removed. They are plaintext; delete them with `db.user_auths.deleteMany({ token_type: 'ANALYTICS' })`.
- **`whitelabel_profiles.reports`:** still lists report names, including `reputation_manager` and `gbp_audit`, which have no public route now (see [LEGACY_FEATURES.md](LEGACY_FEATURES.md)).

## Token migration (Phase 6)

Existing plaintext GBP tokens are re-encrypted on first use. To do them all at once:
1. Back up `user_auths`.
2. Set `TOKEN_ENCRYPTION_KEY`.
3. Run `npm run gbp:encrypt-tokens`. It is idempotent.

Since Phase 7a, GBP token rows are unique per `user_id + token_type + google_sub`. Rows from before 7a have `google_sub: null`; each keeps working, and is upgraded the next time that user connects.

## Environment variables removed

These can be deleted from server `.env` files. Leaving them does no harm: the config ignores unknown variables.

| Group | Variables |
|---|---|
| Stripe | `STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET_INTENT_CHARGE`, `STRIPE_WEBHOOK_SECRET_CUSTOMER_INVOICE_PRICE` |
| Razorpay | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` |
| SerpAPI / Moz / keyword search-volume vendor (removed 2026-09-27) | `SERP_API_KEY`, `SERP_API_TIMEOUT`, `SEO_MOZ_API_USERNAME`, `SEO_MOZ_API_PASSWORD`, `SEO_MOZ_API_KEY`, and the vendor's login / password vars |
| Search Console | `GOOGLE_ANALYTICS_CLIENT_ID`, `GOOGLE_ANALYTICS_CLIENT_SECRET`, `GOOGLE_ANALYTICS_REDIRECT_URI` |
| Places (legacy) | `GOOGLE_PLACE_API_URL` |
| Square (removed in Phase 13a) | `SQUARE_APPLICATION_ID`, `SQUARE_ENV`, `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID` |
| Plan limits (removed in Phase 13a) | `DEFAULT_LOCATION_LIMIT`, `DEFAULT_KEYWORD_LIMIT` |
| Never read | `APPLY_ENCRYPTION`, `SECRET_KEY`, `COMPANY_SUPPORT_EMAIL`, `COMPANY_NAME`, `COMPANY_CITY`, `COMPANY_STATE`, `COMPANY_COUNTRY`, `COMAPNY_ADDRESS`, `JWT_RESET_PASSWORD_EXPIRATION_MINUTES`, `JWT_VERIFY_EMAIL_EXPIRATION_MINUTES`, `ADMIN_BASE_URL`, `ENG_ROLE_ID`, `FIN_ROLE_ID`, `MRK_ROLE_ID`, `HR_ROLE_ID`, `SALES_ROLE_ID` |

**Kept, because code still uses them:**
- PayPal and billing: `PAYPAL_*`, `TRIAL_DAYS`, `BILLING_*`, `MANUAL_INVOICE_DUE_DAYS`, `FRONTEND_URL` (Phase 13a; OPERATIONS.md "PayPal setup")
- SMTP / email
- JWT (secret and day-based expirations)
- the role IDs that are read: `SUP_ADM_ROLE_ID`, `ADM_ROLE_ID`, `EDTR_ROLE_ID`, `USR_ROLE_ID`

**Decided (Phase 16):** the legacy citation module and the `serpapi` package are removed. **Phase 13a** removed the citation credits too (Square, `payment.service`, `LegacyLocationCitation`), so `locationCitations` is no longer read.

## Fields removed from the schemas (Phase 13b)

Old documents may still carry these; nothing reads or writes them. Remove with `$unset` when convenient (after a backup):
- `users`: `user_name`, `stripe_customer_id`, `socket_id`, `referral_code`, `is_proof_verify`, `is_analytics_connected`, `available_credit`, `square_customer_id`, `trial`, `subscription_status`, `current_plan_id`, `fcm_token`, `notification_status`
- `admins`: `socket_id`
- `user_tokens`: `fcm_token`

```js
db.users.updateMany({}, { $unset: { user_name: 1, stripe_customer_id: 1, socket_id: 1, referral_code: 1, is_proof_verify: 1, is_analytics_connected: 1, available_credit: 1, square_customer_id: 1, trial: 1, subscription_status: 1, current_plan_id: 1, fcm_token: 1, notification_status: 1 } })
```

## Billing (Phase 13a)

- **`coupons`:** same collection, new shape. `migrate:billing` converts the legacy per-plan coupons to `{ discount_type: 'fixed', value: <old discount_amount> }` and deactivates them (coupons now apply to token packs only).
- **Legacy guest-checkout subscriptions** (`payments` with a `paypal_subscription_id`): `migrate:billing` links each paid one to the organization owned by the verified user with the same email. The rest are listed by `GET /api/v1/admin/billing/legacy-payments?unlinked=true` for an admin to link. A linked subscription keeps its legacy PayPal price until its first renewal snapshot re-prices it with the standard formula.
- **Organizations:** every organization without `trial_ends_at` gets a trial from the migration date (the standard trial length).
