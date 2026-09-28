> **Status: 13a in progress** on `claude/phase-13a-billing` (2026-09-28). 13a was revised for the per-location + tokens pricing model (Mohit, 2026-09-28; first location priced higher, additional locations lower, 20-location cap, enterprise above). 13b is as approved on 2026-09-27. Spec: CLAUDE.md §12h.

# Phase 13: Billing & plans (13a, revised) + the admin panel backend (13b, as approved)

## Context

Launch (M5) needs customers to pay, and the admin team to run the platform. Today billing is disconnected from organizations: a guest PayPal checkout writes `Payment` rows with no user or organization; nothing sets `User.current_plan_id`, so every organization gets default limits (`src/services/org/limits.ts`). Coupons are parsed from code prefixes; Square only sold citation credits (retired in Phase 16).

On 2026-09-28 Mohit replaced the tiered-plan model of the first approved Phase 13 plan with a **per-location model plus tokens**. He then refined it the same day: **the first location costs more** (it covers base costs), **each additional location has a lower fixed price**, and **beyond 20 locations is enterprise** (a custom plan). 13a below is rewritten for it. 13b (admin panel + support) stays as approved, with only the billing-related admin items adjusted.

**Kept from the approved plan (decisions of 2026-09-27):**
- trial, then read-only; in-app checkout (account first); the guest checkout retired and legacy paid subscriptions linked by verified email
- Square, credits and `LegacyLocationCitation` removed; our own numbered PDF invoices, no tax
- a 7-day grace on failed payments; billing admin; `migrate:billing`; two sub-phases, each merged and pushed
- no live PayPal calls until Mohit gives sandbox credentials and says so

## 13a.0 PayPal mechanics (verified 2026-09-28 against PayPal's current docs)

Sources:
- Subscriptions v1 schema: `developer.paypal.com/api/subscriptions/v1/schema.json` (PayPal marks it "the preferred, authoritative source")
- Orders v2 schema: `developer.paypal.com/api/orders/v2/schema.json`
- webhook event names: `developer.paypal.com/api/rest/webhooks/event-names/`
- integration guide: `developer.paypal.com/docs/subscriptions/integrate/`

| Question | Evidence (quoted) | Consequence |
|---|---|---|
| Quantity-based plans | plan `quantity_supported`: *"Indicates whether you can subscribe to this plan by providing a quantity"*; create-subscription has `quantity` | Possible, but see the next row |
| Changing the quantity | `POST /v1/billing/subscriptions/{id}/revise`: *"Updates the quantity … You can also use this method to switch the plan … **This type of update requires the buyer's consent.**"* | Every location change would send the customer to a PayPal approval page. **We don't use PayPal quantity.** |
| Changing the price without consent | `PATCH /v1/billing/subscriptions/{id}`: *"You can override plan level default attributes … Following are the fields eligible for patch: … `plan.billing_cycles[@sequence==n].pricing_scheme.fixed_price` add, replace"*. No consent is mentioned for PATCH. | **The subscription's own price override = locations × price per location**, patched by us when the count or the price changes |
| When a price change applies | PATCH: *"**Any price update will not impact billing cycles within next 10 days** (Applicable only for subscriptions funded by PayPal account)"*; `fixed_price`: *"For existing subscriptions, payments within 10 days of price change are not affected."* | We fix each renewal amount **11 days before the renewal** (the renewal snapshot, §13a.4) |
| Per-subscription prices | create-subscription `plan`: *"An inline plan object to customise the subscription. You can override plan level default attributes"* (`billing_cycles`, `payment_preferences`, `taxes`); *"Once overridden, changes to plan resource will not impact subscription."* | **One PayPal plan per currency** (USD, CAD) for everyone. Custom prices (enterprise) are just a different override; no PayPal plan per price. |
| Proration | The Subscriptions schema never mentions proration (0 matches for "prorat") | **PayPal does not prorate.** We compute prorated amounts and charge them ourselves. |
| Charging an extra amount on the subscription | outstanding balance: *"The new outstanding balance cannot be greater than the current outstanding balance."* `/capture` only takes `capture_type: OUTSTANDING_BALANCE` | Can't add a charge to the subscription → prorated charges are **one-time Orders** |
| One-time payments | Orders v2: `POST /v2/checkout/orders` (`intent: CAPTURE`, `purchase_units[].custom_id` / `invoice_id`); *"the buyer must first approve the order … upon being redirected to the rel:approve URL"*; then `POST /v2/checkout/orders/{id}/capture` | Token packs and prorated location charges: create → approve → capture |
| Webhooks | Orders: `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.PENDING`, `PAYMENT.CAPTURE.REFUNDED`. Subscriptions: `BILLING.SUBSCRIPTION.{CREATED, ACTIVATED, UPDATED, EXPIRED, CANCELLED, SUSPENDED, PAYMENT.FAILED}`, `PAYMENT.SALE.{COMPLETED, REFUNDED, REVERSED}` | Handlers for all of these |
| Account | *"Use your sandbox business account credentials to log in to …/billing/plans"*; needs *"Client ID, … Business account credentials"*; APIs: Catalog Products, Subscriptions, Orders | **A PayPal Business account** + a REST app (client id / secret) with its webhook |
| Deprecated fields | create-subscription `application_context` and the order's `application_context` are marked *DEPRECATED*, replaced by `experience_context` under `payment_source` | The client uses the current fields; the sandbox test confirms |

**To confirm in the sandbox test (Mohit triggers it):**
- that the account can receive both USD and CAD
- that the REST app has the subscription and checkout features enabled
- the exact return and approve behaviour

## 13a.1 The model (Mohit, 2026-09-28)

- **Per location, first location priced higher.** For `n` paid locations (1 ≤ `n` ≤ `max_locations`):

  monthly amount = `first_location_price` + (`n` − 1) × `additional_location_price`

  No other recurring items; all features included.
  - **Standard plan:** `max_locations` = **20**. Adding a 21st location → **403 `enterprise_required`** ("contact us"); an admin then gives the organization a custom plan.
  - **Custom plans:** set their own two prices and `max_locations` (null = no cap).
- **Plans and entitlements.** One **standard plan** record. Custom plans are records scoped to one organization. A plan holds:
  - an `entitlements` map (all features on now)
  - `users_per_location` (3)
  - trial settings (7 days, 1 location, 3 users, 0 tokens)
  - token costs per refresh type
  - optionally a monthly free-token grant and token pack prices / a discount
  - `max_locations` (20 on the standard plan)
  - **dated prices** per currency: `[{ currency, first_location_price, additional_location_price, effective_from }]`

  Every feature check goes through `hasFeature(entitlement, key)`, so tiers can be added later as data.
- **Prices:**
  - Set by an admin at any time with an effective date. Each renewal uses the price in effect at that renewal (organizations switch at their next renewal).
  - Invoices store the unit price and the amount actually charged.
  - Until Mohit sets prices, checkout answers 409 `price_not_set` (STATUS.md open item 11).
- **Users** = `users_per_location` × paid locations, pooled per organization, the owner included.
  - Counted: active memberships of every role + pending invitations.
  - Over the limit (e.g. after locations are removed), existing users keep access and new invitations get **403 `user_limit_reached`**.
- **Trial:** 7 days from organization creation, no payment details. Allowances are admin-configurable on the plan (defaults 1 location, 3 users, 0 tokens). Afterwards, without a subscription, the organization is read-only (402 on money-costing actions; the monthly refresh skips it).
- **Adding a location beyond the paid quantity:**
  1. `POST /locations` (and onboarding `select-profile`) → **402** `{ reason: "location_payment_required", quote }`.
  2. The customer pays a prorated one-time charge (`POST /billing/location-slots`, PayPal order).
  3. The paid quantity for the current period goes up, and the subscription price is patched for the next renewal.
  4. The client retries the add.
- **Removing a location:** no refund. The freed slot is reusable at no charge until the period ends. At renewal the quantity follows the active locations (minimum 1).
- **Tokens:** one-time purchases of admin-defined packs (PayPal order), never a subscription.
  - The **monthly automatic refresh stays free.** Manual refreshes (`POST /locations/:id/refresh`, and "run now" `POST /locations/:id/rank-runs`, which shares the rankings type) cost `tokens_per_refresh[type]`, admin-configurable. The 24 h guard per type stays.
  - Tokens never expire by default (`expires_after_days` on a pack is optional, off).
  - A ledger records every change. A refresh that fails entirely (rank run `failed`, or GBP sync `failed`) is refunded automatically.
- **Custom plans (enterprise):** per organization, with its own first-location and additional-location prices, `max_locations` (e.g. above 20, or none), users per location, trial length, entitlements, a monthly free-token grant, and token pack prices or a discount.
  - **Billing method** `paypal` (default) or `manual`.
    - With `manual`, we still issue invoices each renewal (`open`, due in `MANUAL_INVOICE_DUE_DAYS` = 14), and an admin records payments.
    - An invoice unpaid past its due date + 7-day grace makes the organization read-only.
    - Location additions beyond the paid quantity are added as a prorated line on the next invoice (no online payment).
  - Every override is logged (who, when, before → after) in `AuditLog`.
- **No tax:** invoices carry an empty `tax_lines: []` for the future.
- **Coupons apply to token packs only** (percent or fixed, pack scope, max redemptions, expiry). Subscription discounts are done with custom plans (lower prices), which PayPal price overrides already support.

## 13a.2 Data model

- **`BillingPlan`** (new, `billing_plans`; replaces the legacy `SubscriptionPlan` in code):
  - identity: `name`, `kind: standard | custom`, `organization_id` (custom only)
  - `entitlements: { rank_tracker, grid, map_ranking, gbp_report, citations, reports, white_label, … }` (all true)
  - `users_per_location` (3), `trial: { days: 7, locations: 1, users: 3, tokens: 0 }`, `tokens_per_refresh: { rankings, gbp }`
  - `monthly_token_grant` (0), `token_pack_discount_percent` (0) / `token_pack_prices[]`
  - `max_locations` (20; null = unlimited, custom only)
  - `prices: [{ currency: USD | CAD, first_location_price, additional_location_price, effective_from, set_by }]`
  - `paypal: { product_id, plan_ids: { USD, CAD } }`, `is_active`
- **`Subscription`** (new, `subscriptions`): one open per organization.
  - `organization_id`, `plan_id`, `billing_method: paypal | manual`, `provider_subscription_id`, `currency`
  - `status: approval_pending | active | past_due | suspended | cancelled | expired`
  - `current_period_start` / `current_period_end` (PayPal `next_billing_time`), `paid_quantity` (locations paid for this period), `price` (this period: `{ first, additional }`)
  - `next_renewal: { quantity, price: { first, additional }, amount, fixed_at }` (the snapshot)
  - `cancel_at_period_end`, `failed_payments`, `last_payment_at`, `events[]` (last 50)
- **`Invoice`** (new, `invoices`):
  - `number` (`INV-YYYY-NNNNNN`, from a counter), `organization_id`, `subscription_id`
  - `kind: subscription | location_slots | token_pack | manual`, `status: open | paid | refunded | void`
  - `lines: [{ label, quantity, unit_price, amount }]` (e.g. "First location" 1 × first price, "Additional locations" (n−1) × additional price), `tax_lines: []`, `total`, `currency`, `period`, `due_at`, `paid_at`
  - `provider_ref` (sale / capture id, unique), `customer` + `seller` (frozen), `pdf`
- **`PaymentOrder`** (new, `payment_orders`): one-time PayPal orders.
  - `organization_id`, `purpose: token_pack | location_slots`, `provider_order_id`, `amount`, `currency`
  - `payload` (pack id / slot quantity + the quote), `status: created | approved | captured | failed | expired`
  - Captured exactly once (compare-and-set).
- **`TokenLedger`** (new, `token_ledger`):
  - `organization_id`, `type: purchase | spend | refund | grant | monthly_grant | adjustment | expiry`
  - `amount` (±), `balance_after`, `ref` (order / run / sync / invoice id), `actor` (user / admin / system), `note`, `at`, `expires_at?`
  - `Organization.token_balance` is updated with atomic `$inc`; a spend is conditional on `token_balance ≥ cost`.
- **`TokenPack`** (new): `name`, `tokens`, `prices: [{ currency, price }]`, `expires_after_days` (null), `is_active`, `sort_order`.
- **`Coupon`** (reworked): `code`, `discount_type: percent | fixed`, `value`, `pack_ids[]` (empty = all), `max_redemptions`, `redemptions`, `expires_at`, `is_active`. The migration converts legacy prefix coupons and marks the subscription-only ones inactive.
- **`BillingEvent`** (new): webhook event ids, unique, TTL 90 days (idempotency).
- **`AuditLog`** (new, `audit_logs`; 13b reuses it): `actor`, `organization_id`, `action`, `field`, `before`, `after`, `note`, `at`.
- **`Organization`** gains:
  - `trial_ends_at`, `plan_id` (standard or custom), `billing_method`
  - `billing_details` (invoice address), `token_balance`
  - `suspended_at` / `suspended_reason` (13b)

## 13a.3 Entitlement, limits and gating

`entitlementFor(org, now)` (pure, in `src/services/billing/entitlement.ts`) returns:
- `state: trialing | active | past_due | inactive | suspended_by_admin`, `read_only`
- `plan`, `features`, `locations: { paid | allowed, used }`, `users: { limit, used }`, `tokens: { balance, cost_per_refresh }`
- `trial_ends_at`, `current_period_end`

**States:**
- **trialing:** before `trial_ends_at` with no subscription. Allowed = the plan's trial allowances.
- **active:** a PayPal subscription `active` (or cancelled until `current_period_end`), or manual with no invoice overdue beyond grace. Allowed locations = `paid_quantity`; adding more is payable up to the plan's `max_locations` (20 standard), and beyond it → 403 `enterprise_required`.
- **past_due:** a failed payment within `BILLING_GRACE_DAYS` (7), or a manual invoice overdue within grace. Full access plus a warning.
- **inactive:** otherwise → read-only.

**Where it applies:**
- `limitsFor` / `assertCanAddLocation` / the invite check read it. The legacy `keyword_limit` / `DEFAULT_LOCATION_LIMIT` are removed; the per-location keyword cap (20) stays.
- **Gate** `requireBilling` → **402** `{ reason: "subscription_required", billing: { state, trial_ends_at } }` on:
  - location add, `onboarding/complete`, center set
  - Places search, competitor suggestions
  - rank-runs, refresh, tracking changes
  - `POST /reports`, report email, schedule create / resume
  - GBP connect / bind

  Reads, billing and support stay open.
- **`requireFeature(key)`** on the feature route groups (rankings, GBP report, citations, reports, white-label). All features are on now.
- **Jobs:** `monthly-refresh` skips `inactive` organizations (`refresh.skipped_reason: "billing"`, schedule still advanced); report-schedule dispatch skips them too.

## 13a.4 Flows

- **Checkout** (owner): `POST /billing/checkout`.
  - `quantity = max(1, active locations)`; prices in effect now for the organization's currency (US → USD, CA → CAD) under its plan.
  - PayPal subscription on that currency's plan with the inline override `fixed_price = first + (quantity − 1) × additional` and `custom_id` = our subscription id → `{ approve_url }`.
  - After approval: `POST /billing/sync` (a PayPal read), with the webhooks authoritative. Trial days left are not carried over (it starts when paid).
- **Renewal snapshot** (daily job `billing-renewals`), for each active PayPal subscription whose `current_period_end` is within 11 days and has no snapshot for that cycle:
  - `quantity = max(1, active locations now)`, prices effective at the renewal date → `amount = first + (quantity − 1) × additional`
  - PATCH `fixed_price` if it changed
  - store `next_renewal` and log it
- **Renewal payment** (`PAYMENT.SALE.COMPLETED`): `paid_quantity` / `price` from the snapshot, new period; **Invoice** (lines from the snapshot, `total` = the amount PayPal actually charged; a mismatch is flagged for the admin) + PDF + receipt email; the monthly token grant (custom plans).
- **Location slots:**
  1. `GET /billing/location-slots/quote?quantity=1` gives the quote.
     - Extra slots are always *additional* locations: quote = `additional_price × quantity × remaining_days / period_days`, rounded to cents.
     - Beyond `max_locations` → 403 `enterprise_required`. If the renewal snapshot is already fixed (under 11 days to renewal), a full next period for the new slots is added, because the next charge can't change any more.
  2. `POST /billing/location-slots { quantity }` → a PayPal order → `approve_url`.
  3. Capture (`POST /billing/orders/:id/capture` from the return page, or the `CHECKOUT.ORDER.APPROVED` webhook) → `paid_quantity += n`, PATCH the renewal price (when before the snapshot), invoice (kind `location_slots`).
  4. Manual billing: the proration goes on the next invoice and the slot is granted at once.
- **Removing a location:** nothing is charged or refunded; the slot stays paid until period end, and the next snapshot counts the active locations.
- **Tokens:**
  - **Buy:** `POST /billing/tokens/checkout { pack_id, coupon_code? }` → an order → capture → ledger `purchase` + invoice (kind `token_pack`).
  - **Spend:** `POST /locations/:id/refresh`:
    - before enqueueing, each requested type checks the 24 h guard, then spends atomically → ledger `spend` (ref = run / sync id)
    - not enough tokens → **402** `{ reason: "insufficient_tokens", balance, cost, costs_by_type }`
    - `GET /locations/:id/refresh` adds `token_cost` per type and `token_balance`
  - **Refund:** on a rank run `failed` / GBP sync `failed` of a paid refresh → ledger `refund` (idempotent per ref).
- **Cancel:** `POST /billing/cancel` → PayPal cancel; access continues until `current_period_end`.
- **Failed payments** (`BILLING.SUBSCRIPTION.PAYMENT.FAILED` / `PAYMENT.SALE.DENIED`): `past_due`, 7-day grace, emails.
- **Other webhooks:**
  - `SUSPENDED` / `CANCELLED` / `EXPIRED` → final
  - `PAYMENT.SALE.REFUNDED` / `REVERSED` and `PAYMENT.CAPTURE.REFUNDED` → invoice `refunded` (plus a token `adjustment` when a pack was refunded)
- **Emails** (dev: logged, masked): receipts, payment failed, trial ending (3 days and 1 day before; job `billing-reminders`), cancellation, manual invoice issued / overdue.

## 13a.5 Endpoints

**Customer** (`/api/v1/billing`; read: owner + member; write: owner; client_user 403). One billing page's worth:

| Method | Path | Purpose |
|---|---|---|
| GET | `/billing` | State, plan, `locations: { active, paid, max }`, prices (first / additional), next renewal date + amount, trial end, users used / limit, token balance, costs per refresh, billing details |
| POST | `/billing/checkout` | Start the subscription → `approve_url` (409 `price_not_set`, `already_subscribed`) |
| POST | `/billing/sync` | Re-read the subscription after the return |
| POST | `/billing/cancel` | Cancel at period end |
| GET | `/billing/location-slots/quote` | The prorated quote (`quantity`) |
| POST | `/billing/location-slots` | Pay for extra slots → `approve_url` |
| GET | `/billing/token-packs` | Packs with the organization's prices |
| POST | `/billing/tokens/checkout` | Buy a pack → `approve_url` (coupon optional) |
| POST | `/billing/coupon/validate` | Pack price preview |
| POST | `/billing/orders/:orderId/capture` | Capture after the PayPal return (idempotent) |
| GET | `/billing/tokens/ledger` | Ledger, paginated |
| PATCH | `/billing/details` | Invoice name / email / address |
| GET | `/billing/invoices`, `/billing/invoices/:invoiceId/pdf` | Invoices |

**Also:**
- **Changed:** `POST /locations`, `POST /onboarding/select-profile` (402 `location_payment_required` + quote; 403 `enterprise_required` above `max_locations`); `POST` / `GET /locations/:id/refresh` and `POST …/rank-runs` (tokens); `POST /organization/invitations` (403 `user_limit_reached`).
- **Public:** `GET /pricing?country=US|CA` (the standard first- and additional-location prices, the 20-location cap, and the token packs, for the marketing site).
- **Webhook:** `POST /subscription/paypal/webhook` keeps its path (registered at PayPal) and the Phase 10 verification. Its handlers are new, and it covers the order events too.

**Billing admin** (`/api/v1/admin/billing`; `billing.read` / `billing.manage`, super admin + admin; every write → `AuditLog`):
- **Standard plan:** entitlements, `users_per_location`, trial allowances, token costs, `max_locations`, **new prices (first / additional) with an effective date** (history kept).
- **Custom plans:** create for an organization / edit / remove (the organization falls back to standard at its next renewal); `billing_method`.
- **Token packs:** CRUD with prices per currency. **Coupons:** CRUD, redemptions.
- **Subscriptions:** list / filter, detail (events, snapshot, invoices), `sync`, `cancel`, comp subscription (`billing_method: manual`, free until a date).
- **Invoices:** list / search, PDF; manual invoices: record payment, void.
- **Tokens:** grant / adjust (with note) and per-organization ledger.
- **Trial:** extend for an organization.
- **Legacy:** link an unmatched legacy payment to an organization.

Every row has `admin (permission)` in ENDPOINTS.md, so the guard-matrix test covers it.

## 13a.6 Retired (as approved)

- **Guest checkout:** `/subscription/create-subscription`, `/subscription/payment-status`.
- **Legacy plans, coupons and payment lists:** plan CRUD `/subscription`, `/subscription/coupon*`, `/subscription/coupons`, `/subscription/payments/all`, `/subscription/send-subscription-welcome-mail`, `/subscription/plans/country/:country` (→ `/pricing`).
- **Square and credits:** `/payments/*` (3), `payment.service`, `paypal.service` (→ `paypalClient`), `configs/square.ts` + the `square` dependency, `PaymentCreditPlan`, `CreditPayment`, `LegacyLocationCitation`, `UserSubscription`.
- **Legacy user fields:** `User.current_plan_id` / `subscription_status` reads.
- Collections are kept (MIGRATION.md).

## 13a.7 PayPal client, config, migration

- **`src/clients/paypalClient.ts`:** typed, mockable (fake transport + `tests/fixtures/paypal/`), token cache, 15 s timeout, 1 retry, safe errors (`debug_id`), usage logged. Methods:
  - `products.create`, `plans.create` / `get`
  - `subscriptions.create` / `get` / `patchPrice` / `cancel` / `transactions`
  - `orders.create` / `get` / `capture`
  - webhook verification (existing)
- **Env:**
  - existing: `PAYPAL_MODE` (sandbox | live), `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`
  - new: `PAYPAL_PRODUCT_ID`, `PAYPAL_PLAN_ID_USD`, `PAYPAL_PLAN_ID_CAD` (written by `npm run billing:paypal-setup`, a one-off that creates the product and the two monthly plans in the configured mode, printing ids; **Mohit runs it**)
  - `TRIAL_DAYS` (7, the default of the plan setting), `BILLING_GRACE_DAYS` (7), `MANUAL_INVOICE_DUE_DAYS` (14), `BILLING_RENEWAL_LEAD_DAYS` (11)
  - `BILLING_SELLER_NAME`, `BILLING_SELLER_ADDRESS`, `BILLING_SELLER_EMAIL`, `BILLING_SELLER_TAX_ID` (optional)
- **OPERATIONS.md, PayPal setup:**
  - Business account; a REST app per environment; client id / secret
  - `billing:paypal-setup`; the webhook URL `<API>/api/v1/subscription/paypal/webhook` with the events listed in 13a.0 → `PAYPAL_WEBHOOK_ID`
  - return URLs under `FRONTEND_URL/settings/billing`
  - the sandbox test steps; USD and CAD receiving
- **`npm run migrate:billing [-- --confirm]`**, dry-run by default, idempotent. It:
  1. creates the standard plan (prices empty until Mohit sets them)
  2. links paid legacy guest subscriptions by verified email to the organization the user owns → `Subscription` (`paid_quantity` = active locations; its PayPal price is re-patched at the next renewal snapshot)
  3. gives every other organization `trial_ends_at` = now + 7 days
  4. converts the coupons
  5. reports unmatched payments (for the admin link endpoint)

## 13a.8 Files (representative)

- **Client:** `src/clients/paypalClient.ts`
- **Services** `src/services/billing/`: `entitlement` (pure), `pricing` (dated prices, proration, pure), `checkout`, `renewals`, `slots`, `tokens` (ledger), `webhook`, `orders`, `invoices`, `invoicePdf`, `coupons`, `plans`, `reminders`, `audit`, `migrate`
- **Models:** `billingPlan`, `subscription`, `invoice`, `paymentOrder`, `tokenLedger`, `tokenPack`, `billingEvent`, `auditLog`, `counter`; `organization` + `coupon` changed
- **HTTP layer:** middlewares `requireBilling`, `requireFeature`, validation; controllers `billing/`, `admin/billing`; routes `common/billing.route.ts`, `common/pricing.route.ts`, `admin/billing.route.ts`
- **Jobs:** `billing-renewals`, `billing-reminders`; scripts `migrateBilling.ts`, `paypalSetup.ts`
- **Edits:** `org/limits.ts`, `refresh/refresh.service.ts` (tokens), `ranking/rankRunExecutor.ts` + `gbp/sync.executor.ts` (refund hooks), `refresh/scheduler.service.ts`, `reports/schedule.service.ts`, `team/invitation.service.ts`, `locations/add.service.ts`, `onboarding.service.ts`, the gated routes, `adminPermissions.ts`, `email.service.ts`
- **Deletions** per 13a.6.
- **Docs:** ENDPOINTS, API ("Billing"), FRONTEND_BACKEND_MAP (Billing → available, with the one-page flow), OPERATIONS (PayPal setup, env, deploy), CLAUDE.md §12h (spec, then as built), STATUS, PROGRESS, PROJECT_SUMMARY, MIGRATION; this plan is saved to `docs/plans/phase-13-billing-admin.md`.

## 13a Verification

- **Pure unit tests:**
  - `entitlementFor` state table (trial edges, grace, cancel-at-period-end, manual overdue, suspended)
  - dated price selection; amount = first + (n − 1) × additional (n = 1, 2, 20)
  - proration at the additional price (period lengths, cents rounding, the post-snapshot extra period)
  - the 20-location cap (403 `enterprise_required`; custom `max_locations` null = no cap)
  - user limit (pooled, owner counted, pending invites)
  - token ledger math
- **PayPal client** (fake transport): token cache, retry, error mapping, the create-subscription body (override `fixed_price`, `custom_id`, currency plan), the PATCH path, order create / capture.
- **Route tests:**
  - trial → checkout → `ACTIVATED` + `SALE.COMPLETED` → active + invoice PDF; replayed events are idempotent
  - the renewal snapshot PATCHes the price 11 days out (and uses a future-dated price)
  - add a location at the paid quantity → 402 quote → slots order → capture → add succeeds; remove → the slot is reusable without charge
  - refresh with tokens: 402 `insufficient_tokens` → buy a pack → spend → a failed run refunds
  - invitation over the user limit → 403 while existing members keep access
  - past_due → grace expiry → 402 on gated routes, 200 on reads; the monthly refresh skips
  - custom plan + manual billing (invoice issued, admin records payment, overdue → read-only)
  - audit log entries; coupons on packs
- **Other checks:** the migration test; guard matrix; `check:endpoints`; lint 0 in new code; build 0.
- **Dev server:** fake PayPal only, webhook replay from fixtures, invoice PDF; stop all dev processes.
- **No live PayPal** until Mohit provides sandbox credentials and says so.

---

## 13b Admin panel backend + support (as approved 2026-09-27; billing items adjusted)

Branch `claude/phase-13b-admin-panel`, after 13a is merged.
- **First commit (added by Mohit, 2026-09-28): the payment-provider interface.** Move every PayPal call behind one `PaymentProvider` interface (checkout, one-time order, subscription update / cancel, webhook verification and parsing), PayPal as its only implementation, no behaviour change. Details in CLAUDE.md §12h. Reason: customers must be able to pay by card without a PayPal account; if the sandbox shows PayPal can't do that, a card processor is added as a second provider (STATUS.md "Decide before launch").
- **Users** (`platform.read` / `platform.write`):
  - list / search, detail (memberships, organizations, verification, last logins, Google connections)
  - disable / enable (sessions revoked), force logout, resend verification, mark verified
- **Organizations:**
  - list / search (type, entitlement state, plan, trial ending)
  - detail (owner, members, locations, clients, usage, subscription, invoices, token balance, citations summary)
  - actions: suspend / unsuspend with a reason (403 `organization_suspended` on writes), plus links to the 13a billing admin (custom plan, trial, tokens); all audit-logged
- **Support tickets:** a rebuild of the legacy `Support`, organization-scoped with threads.
  - **Customer** (`/support/tickets`): create / list / detail / reply / close.
  - **Admin** (`/admin/support/tickets`): list / filter / detail / reply / status / assign / counts. New `support.read` / `support.manage` (super admin, admin, editor).
  - **Emails:** on new tickets and replies (dev: logged).
  - **Legacy:** the `/supports` routes are deprecated and existing tickets migrated.
- **Overview:** `GET /admin/overview`: organizations by type and state, active subscriptions and MRR per currency (first + (paid − 1) × additional), trials ending in 7 days, past_due, token sales in the last 30 days, signups in the last 30 days, open tickets.
- **Legacy `/admin/operations/*`:** deprecated.
- **Verification:** as approved (guard matrix, suspend → 403, ticket threads with organization isolation, overview numbers).

## Decisions for approval (13a)

1. **Pricing:** `first_location_price` + (`n` − 1) × `additional_location_price`, dated prices per currency; the standard plan caps at **20 locations** (more → enterprise custom plan, 403 `enterprise_required`).
2. **No PayPal quantity:** each subscription carries its own price override (`fixed_price` = that total), patched without buyer consent. One PayPal plan per currency; custom prices use the same override.
3. **Renewal snapshot 11 days before renewal** (PayPal ignores price changes within 10 days for PayPal-funded subscriptions). Locations added after the snapshot pay the rest of this period **plus the next period** in their one-time charge. Locations removed after it are billed once more and then drop off.
4. **Prorated slots (always at the additional-location price) and token packs are one-time PayPal orders** (buyer approves each). Manual-billing organizations get prorations on their next invoice instead.
5. **Coupons apply to token packs only;** subscription discounts are custom plans.
6. **User limit counts** active memberships of every role (owner included) + pending invitations.
7. **Minimum paid quantity 1;** checkout quantity = the active locations (at least 1). The trial doesn't carry over into the paid period.
8. **Tokens:** "run now" costs the same as a rankings refresh. Refunds only when a refresh fails entirely. Monthly grants (custom plans) are credited at each renewal payment.
9. **Legacy removals and migration** as in the approved plan; the standard plan is created without prices (checkout 409 `price_not_set` until Mohit sets them).
