# Phase 18: Reputation (review management) + a shared OpenAI layer

## Context

Google approved GBP v4 on 2026-10-02 and `GBP_V4_ENABLED=true` is on in production. The monthly `gbp-sync` already stores reviews (`GbpReview`), but nothing can reply to them, flag them or use AI. Mohit wants a Reputation section: review stats on the dashboard, reply management with AI-suggested replies for 4–5 star reviews, flags for dangerous reviews, and AI-drafted appeal text for removal requests. He also wants one shared OpenAI layer that later features reuse. The governing rule (his PDF): **deterministic software first, AI only on an explicit user action; never spend Google quota or OpenAI credits in the background.**

**Decisions (Mohit, 2026-10-02):**
- AI actions **spend MyPageSEO tokens** (the existing ledger); costs are admin-set per plan.
- Default model **`gpt-5-nano`** ($0.05 in / $0.40 out per 1M; OpenAI pricing page), configurable via `OPENAI_MODEL`, run with minimal reasoning.
- **Auto-reply: later** (not in this phase).
- Reviews refresh: a **Refresh Reviews button** (incremental, rate-limited) **plus** the existing monthly sync.
- AI reply suggestions **only for 4–5 star reviews**; 1–3 star replies are written by the user.

**Facts this rests on (verified 2026-10-02):**
- Google's v4 `accounts.locations.reviews` has only `list`, `get`, `updateReply`, `deleteReply`. **There is no API to report or appeal a review.** Reporting and the one-time appeal happen in Google's Reviews Management Tool by hand. So the "appeal" feature = an AI-drafted report/appeal text + a link to Google's tool + a status the user updates.
- No `OPENAI_API_KEY` in the local `.env` yet; all tests use a fake client. A live check needs Mohit's key and his go-ahead.

Branch `claude/phase-18-reviews` from `master`. CLAUDE.md gets the §12j spec and a roadmap row first (standing rule). This also covers the roadmap's "Review management" item and the review half of Phase 9 (posting stays Phase 9).

## Plan

### A. Shared AI layer (reused by later features)
- **Client** `src/clients/openaiClient.ts`: OpenAI Responses API over the existing `src/clients/http.ts` transport (timeout, 1 retry on 5xx/429, safe errors, no payload logging). Structured outputs (JSON schema) so replies come back as typed JSON. `reasoning.effort` from config (`minimal`), `max_output_tokens` per task. Mockable like `placesClient` (`createOpenaiClient({ transport })`).
- **Service** `src/services/ai/ai.service.ts` (the "middleware" every feature calls): `runAiTask({ task, organizationId, locationId, userId, tokenCost, input, schema, maxOutputTokens })`:
  1. 503 `ai_not_configured` without a key.
  2. Global safety net: `AI_DAILY_BUDGET_USD` (default 5) on a MongoDB counter across pm2 processes → 503 `ai_budget_reached`.
  3. Spends `tokenCost` MyPageSEO tokens (`spend()` in `src/services/billing/tokens.ts`) → 402 `insufficient_tokens`; **refunds** (`refundSpend`) if the OpenAI call fails.
  4. Calls OpenAI, records model, input / cached / output tokens and estimated $ in a new `AiCall` ledger (`ai_calls`, counts only, no prompt or review text).
- **Config:** `OPENAI_API_KEY`, `OPENAI_MODEL` (gpt-5-nano), `OPENAI_REASONING_EFFORT` (minimal), `AI_DAILY_BUDGET_USD` (5), `AI_MAX_REVIEWS_PER_REQUEST` (20). Prices for the OpenAI models in `src/configs/pricing.ts`; `npm run cost:report` adds an AI section.
- **Token costs (admin-set, `BillingPlan.ai_token_costs`, defaults):** reply drafts 1 token per started batch of 10 reviews; analysis 1 per started 10; appeal draft 1; insights 2. Cached results cost nothing. Shown in `GET /billing` (`tokens.ai_costs`) and on the reviews summary.
- **Privacy:** only the review text, rating, the business name/category and up to 8 tracked keywords go to OpenAI. Reviewer first name only (for a natural greeting), never full names or ids.

### B. Review store, sync and refresh (no AI)
- **`GbpReview` gains:** `fingerprint` (normalised text hash), `flags[]` (`{ code, source: system|ai, detail }`), `flag_level` (`none | attention | suspicious`), `reply_state` (`none | draft | sent | failed`) + `sent_at`, `sent_by`, `send_error`, `draft` (`{ text, source: ai|user, model, generated_at, input_hash, edited }`), `analysis` (`{ sentiment, severity, suspicious_indicators, summary, recommended_action, model, analyzed_at, input_hash }`), `appeal` (`{ text, policy_reason, generated_at, model }`), `report_status` (`not_reported | reported | appeal_submitted | removed | kept`, set by the user), `first_seen_at`.
- **Refresh** `POST /locations/:id/reviews/refresh`: v4 `reviews.list` with `orderBy=updateTime desc`, stopping at the first page that reaches reviews already stored unchanged (usually 1 call). Once per 15 minutes per location (429 + `next_allowed_at`), free (Google quota only), owner/member, bound + v4 required (`gbp_not_connected` / `v4_access_pending`). Runs the deterministic flags on new or changed reviews. **No AI.** The monthly `gbp-sync` keeps its full fetch and uses the same upsert + flagging.
- **Deterministic flags** (pure `src/reviews/flags.ts`, unit-tested): link / email / phone in text, duplicate text (same fingerprint at this location), same reviewer posting several times, profanity / abuse dictionary, promotional words, empty 1-star, a burst of 3+ one- or two-star reviews within 24 h, rating-text mismatch (5 stars with clearly negative words, small lexicon). Wording: **"Suspicious indicators"**, never "fake". A changed review text clears and recomputes the system flags and invalidates drafts / analysis (input hash).

### C. Replies (AI drafts for 4–5 stars only, explicit send)
- `POST /locations/:id/reviews/drafts { review_ids, regenerate? }`: one OpenAI request per batch of up to 10 selected reviews (shared instructions sent once). Only **4–5 star, not yet replied, not flagged suspicious**; others come back in `skipped` with a reason (`rating_not_eligible`, `already_replied`, `flagged`). Existing drafts with the same input are returned free unless `regenerate: true`. Prompt rules from the PDF: short, specific to what the review says, no invented facts, keywords only when they fit, no keyword stuffing, no templated phrases.
- `PATCH /locations/:id/reviews/:reviewId/draft { text }` (any rating; this is how 1–3 star replies are written), `DELETE …/draft`.
- `POST /locations/:id/reviews/send { review_ids }` (max 50): publishes each review's draft with v4 `updateReply`; per-review result; `reply_state: sent | failed` + `send_error`. No AI afterwards. `DELETE /locations/:id/reviews/:reviewId/reply` removes a published reply (`deleteReply`).
- Owner / member only; client_user read-only; `requireBilling` on drafts, send and refresh.

### D. Analysis, flags and appeal drafts (explicit only)
- `POST /locations/:id/reviews/analyze { review_ids }`: AI on selected reviews (any rating): sentiment, severity, suspicious indicators, a one-line summary and a recommended action. Adds `source: ai` flags; cached by input hash. Never reports anything.
- `POST /locations/:id/reviews/:reviewId/appeal-draft`: for a flagged review, the AI drafts a short, factual report / appeal text tied to one of Google's prohibited-content categories (spam, off-topic, conflict of interest, harassment, offensive content…) plus `report_url` (Google's Reviews Management Tool). The user submits it on Google; `PATCH …/report-status` records what happened.

### E. Lists, stats, dashboard, insights
- `GET /locations/:id/reviews` (filters: rating, replied / unreplied, reply_state, flagged, has_draft, text search; sort newest / oldest / rating; paginated) and `GET /locations/:id/reviews/summary` (all MongoDB aggregation, no AI): total, average, new this month, 4–5 / 1–3 star counts, replies sent this month, drafts pending, flagged, awaiting attention (unreplied 1–3 stars or flagged), last sync, token costs and balance.
- **Dashboard:** `Location.summary` gets the review counts (written on refresh, sync and send), and `GET /dashboard` adds a `reputation` block (business: this location set; agency: portfolio totals + locations needing attention). Recommended action `reviews:attention`.
- **Insights:** `POST /locations/:id/reviews/insights` (AI, explicit): sends aggregated counts per rating and month plus at most 60 recent review texts cut to 300 characters; returns themes, praise, complaints and observations; stored in `ReviewInsight` and served by `GET …/reviews/insights` until regenerated.

### Files (representative)
- New: `src/clients/openaiClient.ts`, `src/services/ai/{ai.service,budget,prompts}.ts`, `src/models/{aiCall,reviewInsight}.model.ts`, `src/reviews/{flags,fingerprint,eligibility}.ts`, `src/services/reviews/{refresh,list,summary,drafts,send,analysis,appeal,insights}.ts`, `src/routes/v1/common/reviews.route.ts`, `src/controllers/reviews/*`, `src/middlewares/reviews/*`.
- Changed: `src/models/gbpData.model.ts` (GbpReview fields), `src/clients/gbpClient.ts` (`listReviewsSince`, `updateReply`, `deleteReply`), `src/gbp/sync.executor.ts` (shared upsert + flags), `src/models/billingPlan.model.ts` + `src/billing/entitlement.ts` (`ai_token_costs`), `src/services/billing/account.service.ts`, `src/services/locations/summary.ts`, `src/services/dashboard/*`, `src/configs/{config,pricing}.ts`, `.env.example`.
- Tests with a fake OpenAI client and fake GBP transport; docs: CLAUDE §12j + roadmap, ENDPOINTS, API, FRONTEND_BACKEND_MAP, OPERATIONS (AI costs, budget, key setup), STATUS, PROGRESS; Postman. Then a note for the frontend.

## Cost per action (gpt-5-nano list prices)
- 10 reply drafts ≈ 1,500 tokens in + 1,000 out ≈ **$0.0005**. Analysis of 10 ≈ the same. Appeal draft ≈ $0.0002. Insights ≈ 15,000 in + 800 out ≈ **$0.001**.
- Refresh: usually 1 free Google call. Nothing runs in the background; the monthly sync is unchanged.

## Verification
- Build 0 errors, both tsc configs 0, lint stays 40, full suite green, `check:endpoints` passes.
- Unit tests: flags, eligibility, batching, token charge + refund on failure, cache (no second charge), daily budget cap, incremental refresh stopping early, send results.
- Live (only when Mohit adds `OPENAI_API_KEY` and says so): one draft batch of 2 reviews and one analysis on the live-test location, under $0.01; recorded in LIVE_TEST.md. Sending a real reply to Google only with his explicit OK.
