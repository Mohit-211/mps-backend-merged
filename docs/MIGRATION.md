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

**Archive example** (run against the right database, after a backup):

```sh
mongodump --uri "<server mongodb uri>" --collection rank_tracker_reports --out ./archive-$(date +%F)
# then, only if wanted:
mongosh "<server mongodb uri>" --eval 'db.rank_tracker_reports.drop()'
```

## Rows and fields no longer used

- **`user_auths` rows with `token_type: 'ANALYTICS'`:** Search Console tokens. The connect flow was removed. They are plaintext; delete them with `db.user_auths.deleteMany({ token_type: 'ANALYTICS' })`.
- **`users.is_analytics_connected`:** still in the schema and still returned by the auth middleware, user responses and location details, but nothing sets it any more. It can be removed together with the frontend.
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
| SerpAPI / Moz / DataForSEO | `SERP_API_KEY`, `SERP_API_TIMEOUT`, `SEO_MOZ_API_USERNAME`, `SEO_MOZ_API_PASSWORD`, `SEO_MOZ_API_KEY`, `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` |
| Search Console | `GOOGLE_ANALYTICS_CLIENT_ID`, `GOOGLE_ANALYTICS_CLIENT_SECRET`, `GOOGLE_ANALYTICS_REDIRECT_URI` |
| Places (legacy) | `GOOGLE_PLACE_API_URL` |
| Square (unused parts) | `SQUARE_APPLICATION_ID`, `SQUARE_ENV` |
| Never read | `APPLY_ENCRYPTION`, `SECRET_KEY`, `COMPANY_SUPPORT_EMAIL`, `COMPANY_NAME`, `COMPANY_CITY`, `COMPANY_STATE`, `COMPANY_COUNTRY`, `COMAPNY_ADDRESS`, `JWT_RESET_PASSWORD_EXPIRATION_MINUTES`, `JWT_VERIFY_EMAIL_EXPIRATION_MINUTES`, `ADMIN_BASE_URL`, `ENG_ROLE_ID`, `FIN_ROLE_ID`, `MRK_ROLE_ID`, `HR_ROLE_ID`, `SALES_ROLE_ID` |

**Kept, because code still uses them:**
- Square: `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID` (payments)
- PayPal: `PAYPAL_*`, `FRONTEND_URL`
- SMTP / email
- JWT (secret and day-based expirations)
- the role IDs that are read: `SUP_ADM_ROLE_ID`, `ADM_ROLE_ID`, `EDTR_ROLE_ID`, `USR_ROLE_ID`

**Still needs a separate decision:** the citation tracker (out of scope) imports the `serpapi` package directly and has never had a key configured (AUDIT C13), so it fails. The package stays until citations are rebuilt or removed.
