# Upcoming features: groundwork (planned, spec pending)

Written 2026-09-29 at Mohit's request, at the end of Phase 13b. **Docs only: no feature code.** Mohit gives the full specs later; each feature then gets its own phase, CLAUDE.md spec section and plan. This note records, per feature:
- what exists that it builds on, and what's missing
- open questions for Mohit
- a rough data model and job ideas
- dependencies and costs

It ends with the foundations the features share and whether current code blocks any of them.

| # | Feature | Needs | Roadmap |
|---|---|---|---|
| A | AI GBP posts | GBP v4 access, an AI provider, public media storage | planned, spec pending (extends Phase 9) |
| B | AI visibility | AI provider(s) with web-grounded answers | planned, spec pending |
| C | Review management (AI) | GBP v4 access, an AI provider | planned, spec pending (extends Phase 9) |
| D | White-label hosting | a second domain, TLS, host-based routing | planned, spec pending |

---

## A. AI GBP posts

**Goal:** AI-written post text and images for a location's Google Business Profile. Publishing schedules (daily, twice a week, weekly, monthly, custom), an optional approval step before publishing, and a calendar.

**Builds on:**
- **Legacy posting:** `services/common/gbpPostSchedular.service.ts`, `jobs/postToGbp.ts`, the `GBPPost` model and `/gbp/post/*`, using v4 `localPosts`. Phase 9's spec (CLAUDE.md §12a) already covers the rebuild: `gbpClient`, validation per topic type, HTTPS media checked with a HEAD request, `recurrenceInfo`, idempotent publishing, and post state synced back.
- **Location context:** the GBP profile snapshot (categories, description, services, hours: `GbpProfileSnapshot`), search keywords (`GbpKeywordMonthly`) and tracked keywords (`Location.tracking.keywords`).
- **Infrastructure:** agenda jobs (`defineJob`), the usage ledger (`ApiUsage`), organization branding, and the billing entitlements map (`hasFeature`), where a new feature is a data flag.

**Missing:**
- an AI provider interface (text + image)
- public media storage: GBP fetches `sourceUrl` itself, so images must be on a public HTTPS URL
- a recurring-content scheduler (series → occurrences)
- an approval workflow with its notifications
- a calendar view API
- GBP v4 access (blocked on Google)

**Open questions for Mohit:**
1. Who approves: the organization owner and members, the agency's client (a `client_user`), or both? Is approval per post or per series?
2. Tone and brand inputs per location (voice, words to avoid, CTA defaults)? Languages beyond English?
3. Images: AI-generated only, or also the business's own GBP photos and uploads? Any rules for people in images?
4. Post types: STANDARD only first, or also EVENT and OFFER?
5. What happens to scheduled posts when approval hasn't come in time: skip, publish anyway, or notify?
6. Limits and cost: posts per month per location included, or token-priced like manual refreshes?
7. Editing after publishing: allowed (the v4 patch) or delete-and-recreate?

**Rough data model:**
- `PostSeries { location_id, cadence: daily | twice_weekly | weekly | monthly | custom (rrule), timezone, topic_rules, cta, approval_required, active, next_occurrence_at }`
- `GBPPost` (rebuilt) gains `series_id`, `status: draft | pending_approval | approved | scheduled | publishing | live | rejected | failed`, `generated: { model, prompt_version, cost_ref }`, `media: [{ asset_id, public_url }]`, `approved_by / at`, `gbp_post_name`, `last_error`
- `MediaAsset { organization_id, kind: generated | upload, storage_key, public_url, mime, bytes, width, height, created_by }`

**Jobs:**
- `post-series-plan` (daily): creates the next N occurrences per series as drafts.
- `post-generate`: text + image per draft (AI provider), then `pending_approval` or `scheduled`.
- `post-publish` at the scheduled time (idempotent on `gbp_post_name`).
- The `gbp-sync` extension reads post state back.

**Dependencies and cost:**
- GBP v4 localPosts: no per-call charge, quota-limited, needs v4 access.
- AI text: about 1–2k tokens per post, cents per post at current LLM list prices.
- AI images: roughly $0.02–0.08 per image depending on the provider and size.
- Storage/CDN for images: negligible at this scale.
- Every call counted in the usage ledger.

---

## B. AI visibility

**Goal:** track whether and how the business appears in AI assistants' answers (ChatGPT, Gemini, Perplexity, Claude) to relevant prompts, over time, with a score and a competitor comparison.

**Builds on:**
- **Prompts from keywords:** tracked keywords and the location's city give prompts like "best plumber in Austin".
- **Competitors:** `tracking.competitors` + the map-list top 3 are the comparison set, and `Location.summary` + the dashboard are where a score would surface.
- **Runs and reports:** the ranking run pattern (a job per run, results stored per run, change vs the previous run), the reports center (a new report type and section) and the usage ledger.

**Missing:**
- **An AI provider interface for queries.** Each assistant is queried through its API, preferably with web search or grounding on (answers without browsing only reflect training data).
- **Answer parsing:** is the business mentioned or cited, its position in a list, the linked domain, sentiment. This needs entity matching: name + city + phone/website against the answer text and its citations.
- **The scoring formula.**
- **Run storage.**

**Open questions for Mohit:**
1. Which assistants at launch, and do we need the consumer products' answers (not available by API) or are API answers with web search acceptable? This is the main accuracy question: API answers differ from what users see in the apps.
2. Prompts: generated from keywords automatically, entered by the customer, or both? How many per location?
3. Cadence: monthly with the refresh, or its own schedule? Samples per prompt (answers vary run to run, like ranking samples)?
4. What the score means: mention rate, average position, share of voice vs competitors, citations of the website / GBP?
5. Is it priced per location, as an add-on entitlement, or with tokens?
6. Terms of service: check each provider's terms for automated querying and storing answers.

**Rough data model:**
- `AiVisibilityRun { location_id, run_at, status, prompts_version, providers, samples, cost }`
- `AiAnswer { run_id, provider, model, prompt, sample, answer_text (or hash + excerpt), citations: [{ url, domain }], mentions: [{ place_id | name, position, sentiment }], latency_ms }`
- `Location.summary.ai_visibility { score, mention_rate, change }`
- `Location.ai_visibility { prompts: [{ text, source: keyword | custom }], providers, active }`

**Jobs:** `ai-visibility-run` (per location; bounded concurrency per provider; rate limits per provider like `PLACES_MAX_QPS`), then scoring and change vs the previous run, then the summary. A report section.

**Dependencies and cost:** provider API keys (OpenAI, Google Gemini, Perplexity, Anthropic). At roughly 1–3k tokens per answer, 10 prompts × 4 providers × 3 samples ≈ 120 answers per location per run, about $0.30–1.50 per run with web search on (search/grounding is often priced per call on top of tokens). The cost model is in the plan when specced.

---

## C. Review management (AI)

**Goal:** review sync, AI analysis (sentiment, topics, trends), AI reply suggestions, and auto-reply with rules and/or approval.

**Builds on:**
- **Reviews already stored:** `gbp-sync` stores them (`GbpReview`: rating, comment, create/update time, reply, reviewer display name) when `GBP_V4_ENABLED`.
- **Metrics already built:** the GBP report's reviews section (average, distribution, reply rate, median reply time, unreplied), the dashboard's `unreplied` and review actions, the GBP Score reviews pillar, and the competitor reviews (Places Details, up to 5 per business).

**Missing:**
- **v4 access** (blocked on Google).
- **A write path** for replies (`PUT …/reviews/{id}/reply`, delete reply) through `gbpClient`.
- **Faster review sync** than monthly: new reviews should be seen within hours for replies to be useful. That means a lighter `review-sync` job (reviews only) on its own cadence.
- **AI analysis and reply generation**, a rules engine (e.g. auto-reply to 4–5★ with no text, approval for ≤ 3★ or keywords), approval queue and notifications (Phase 15 overlaps).

**Open questions for Mohit:**
1. Review sync frequency (hourly? every 6 h?) and whether it's included or priced.
2. Auto-reply defaults: off by default? Which ratings can auto-reply, and is a delay before posting required (e.g. 1 h to allow an override)?
3. Who approves (owner and members, a `client_user` for its clients)? Is there a signature per location?
4. Analysis: topics from a fixed taxonomy per industry, or free-form clustering? Trends over what window?
5. Reply language: always the review's language?
6. Negative-review alerts: email now, other channels with Phase 15?

**Rough data model:**
- `GbpReview` gains `analysis: { sentiment, topics[], language, analyzed_at, model }`, `reply_state: none | suggested | pending_approval | scheduled | posted | failed`, `suggested_reply`, `reply_source: manual | ai | auto`, `posted_by`, `posted_at`
- `ReviewRule { location_id | organization_id, when: { ratings, has_text, keywords }, action: suggest | require_approval | auto_reply, delay_minutes, template_hint, active }`
- `ReviewInsight` (monthly per location): topic counts and sentiment trend.

**Jobs:**
- `review-sync` (frequent, reviews only)
- `review-analyze` (new or changed reviews)
- `review-reply-generate`, applying the rules
- `review-reply-post` (idempotent)
- monthly insight aggregation feeding the GBP report

**Dependencies and cost:** GBP v4 reviews API (no per-call charge, quota-limited). AI analysis plus a reply costs about a cent or less per review at current LLM prices. Everything counted in the usage ledger.

---

## D. White-label hosting

**Goal:** agencies send reports to their clients under their own name and logo, hosted on a separate generic domain (e.g. `googleprofile.report`, not decided), with no MyPageSEO branding.

**Builds on:**
- **Branding:** organization branding (Phase 12: agency name, logo, colours, footer and contact text, `hide_mypageseo`, email sender name and reply-to), frozen into every `ReportSnapshot`.
- **Share links and pages:** `/r/:token` (`src/routes/share.route.ts`): hashed tokens, expiry, revocation, rate limit, noindex, strict CSP, no internal ids, and the HTML renderer and PDF download it serves.
- **Report emails:** already branded; they link to share pages when the PDF is too large.

**Missing:**
- **A second domain** served by the same app (or a small separate service) with host-based routing: requests for `<generic domain>` only reach the public share routes, never `/api/v1`.
- **Link building:** share URLs built on that domain for agencies with white-label on (`SHARE_BASE_URL` per organization instead of global).
- **Removal of every MyPageSEO trace** on those pages, including the attribution footer. The "Google Maps" attribution for Places content must stay; it is Google's requirement, not our branding.
- **Optionally, per-agency subdomains** (`acme.googleprofile.report`) or agency-owned custom domains (`reports.acme.com`, CNAME + automatic TLS).
- **An email sending domain** that doesn't reveal MyPageSEO (today From is `EMAIL_FROM`'s address with the agency's display name).

**Open questions for Mohit:**
1. One generic domain for all agencies (path-based: `googleprofile.report/r/<token>`), per-agency subdomains, or agency custom domains? The first is simplest; custom domains need automatic certificates (e.g. Caddy on-demand TLS or a cert manager) and a verification flow.
2. Must report emails also come from a neutral domain (SPF/DKIM for it)?
3. Should the share page offer a client portal (several reports for one client behind one link) or stay one report per link?
4. Is it included in the agency plan or an entitlement add-on?
5. Domain choice and registration (Mohit).

**Rough data model:**
- `Organization.white_label_hosting { enabled, mode: shared | subdomain | custom, subdomain, custom_domain, domain_verified_at, tls_status }`
- `ReportShare` unchanged; share URLs computed from the organization's hosting settings.
- A `domains` collection if custom domains are allowed (verification token, DNS check status).

**Jobs:** `custom-domain-verify` (DNS TXT/CNAME checks, retries), certificate issuance/renewal (if not delegated to the proxy).

**Dependencies and cost:** the domain (~$10–60 per year depending on the TLD), DNS, TLS (free with Let's Encrypt), nginx/Caddy configuration in Phase 14's server setup. No per-report cost.

---

## Cross-cutting foundations

| Foundation | Needed by | Current state | Blocker? |
|---|---|---|---|
| **AI provider interface:** text generation, image generation and LLM queries (with web search / grounding), with usage and cost in the existing ledger | A, B, C | Not built. The pattern exists twice: the payment-provider interface (`services/billing/providers/`) and the typed, mockable clients (`src/clients/*`, fake transport in tests). The usage ledger takes new SKUs as data (`services/usage/skus.ts`, `configs/pricing.ts`); token-based pricing needs a per-call cost field (today the ledger stores counts and prices them by SKU). | **No.** Add an `ai.*` SKU family and record cost per call (tokens in/out, images) alongside counts. |
| **Public media storage:** generated images on a public HTTPS URL (GBP fetches `sourceUrl`) | A (and C if images are ever attached) | Only local disk: `public/uploads/{images,videos}` served by `/images/:filename` and `/videos/:filename`, with no organization scoping, no metadata and a per-process cache. Reports use a *private* directory (`REPORTS_STORAGE_DIR`). | **No hard blocker, but not reusable as is.** Add a storage interface (`put`, `publicUrl`, `delete`) with a local-disk driver now and an S3-compatible driver later, plus a `MediaAsset` model; unguessable keys; the server's public URL must be HTTPS and reachable by Google (Phase 14). |
| **Serving on a second domain:** host-based routing, per-agency branding, TLS | D | `app.ts` mounts everything for every host; `/r` is mounted outside `/api/v1`; `SHARE_BASE_URL` is global. CSP and noindex are already strict on `/r`. | **No.** A host check middleware (only `/r/*` on the white-label host, 404 otherwise) and a per-organization share base URL. TLS/proxy work belongs to Phase 14's nginx setup. |
| **Recurring content scheduling:** series → occurrences, per-location timezone, catch-up and idempotency | A (post series), C (review sync cadence), B (visibility cadence) | Agenda with the Mongo-locked scheduler pattern of `monthly-refresh` (compare-and-set claims, stuck guards, local-time scheduling by `Location.timezone`), `report-schedule-dispatch` (cycles per location) and `defineJob` / `scheduleJob`. | **No.** The monthly-refresh pattern generalises: a planner job creates dated occurrences (unique per series + date), and executor jobs claim them. |

**Also shared:**
- **Approvals and notifications:** posts and review replies both need an approve/reject queue and "needs your approval" notifications. That is Phase 15 (notifications and automations), so these features should wait for it or bring a minimal email notice through the one email service (`EMAIL_TRANSPORT`).
- **Entitlements:** each feature is a new key in the billing plan's `entitlements` map plus `requireFeature(key)` on its routes. Tokens can price per-use actions (as manual refreshes do).
- **GBP v4 access** blocks A and C (and Phase 9). It's the first dependency to resolve with Google.

**Nothing in the current code blocks any of these.** The work before them is the three foundations above (AI provider + ledger cost, media storage, host routing), each small, plus Google's v4 approval.
