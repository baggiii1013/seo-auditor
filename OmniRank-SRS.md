# OmniRank AI — Software Requirements Specification

> **Source:** _Omni Rank Roadmap_ v1.0, May 2026, Krishna Puranik (Dreamsdesign) — Sections 3–18.
> **Cross-checked against:** the `seo-auditor` repository as of commit `1102e57`.
> **Status:** Draft 1 · 18 Sep 2026 · Confidential

---

## 1. Purpose of this document

The roadmap describes a product. The repository contains a different one. This SRS reconciles the two: it states what OmniRank AI is meant to be, records precisely what exists today, names the gap, and turns the remainder into requirements that can be built and tested against.

Everything in **§4 (What exists)** was read out of the code, not out of the roadmap. Everything in **§6 onward** is specified, not yet built.

---

## 2. The product in one page

**Problem.** Buyers increasingly ask ChatGPT, Perplexity and Gemini instead of typing into Google. An assistant answers from a handful of sources it decided to trust. A business that is not among those sources is invisible in a way no rank tracker reports, because there is no rank.

**Insight the roadmap monetises.** Being _cited by an assistant_ is a different discipline from ranking — it needs liftable passages, structured data, cited sources, concrete numbers, an `llms.txt`, and crawler access that has not been silently revoked by a CDN default. Almost no Indian SMB has any of this, and almost no Indian agency sells it.

**The product.** A multi-tenant SaaS that (a) measures a site's AI visibility, (b) generates AI-optimised pages and publishes them onto the client's own domain under `/feeds/`, (c) repurposes each page into social content, (d) captures the leads those pages produce, and (e) keeps all of it fresh automatically.

**Positioning.** Not "cheaper Gushwork". The first complete AI-visibility platform built for India — AI search _and_ social, at ₹2,999–₹19,999/month, with Razorpay and Indian support. Gushwork is US-only, sales-led, $800+/month, and generates no social content at all.

**Unfair advantage.** Dreamsdesign's existing 4,500+ client network. The first 100 customers are an upsell, not cold outreach.

---

## 3. Scope

### 3.1 In scope

| #   | Subsystem                  | One line                                                                                         |
| --- | -------------------------- | ------------------------------------------------------------------------------------------------ |
| S1  | **Visibility Diagnostics** | Crawl a site and score how ready it is to be read, quoted and cited by answer engines.           |
| S2  | **Content Intelligence**   | Keyword and question research, competitor structure analysis, citation-probability scoring.      |
| S3  | **AI Content Pipeline**    | Seven-step agent chain that turns a keyword into a published, schema-marked page.                |
| S4  | **AI Visibility Engine**   | The `/feeds/` subdirectory CMS — renders, hosts and serves pages on the _client's_ domain.       |
| S5  | **Distribution Engine**    | LinkedIn, Instagram, YouTube, X, WhatsApp, GMB, email — generated from the page already written. |
| S6  | **Leads & Analytics**      | Lead capture with spam scoring, crawl-activity tracking, Search Console, monthly PDF reports.    |
| S7  | **Platform**               | Multi-tenancy, auth, credits, Razorpay billing, team roles, audit log.                           |
| S8  | **Citation Network**       | Directory submissions, press syndication, partner-site CRM. Largely operational, not software.   |

### 3.2 Explicitly out of scope

- Real AI-citation tracking. **No vendor exposes an API for it.** Everything the product reports about citations is a proxy or an estimate and must be labelled as such in the UI. This is a product rule, not a limitation to be engineered around.
- Backlink/ranking index of our own — Ahrefs and Search Console already do it.
- A bundled headless browser. Rejected in the engine's own roadmap: it buys a handful of checks and costs `npx`-with-no-install, which is the whole install story.
- Auto-publishing to Instagram and YouTube — not possible without platform approvals. Copy-paste-ready output instead.

---

## 4. What exists today

The repository is **not** an early OmniRank AI. It is a working, fairly deep implementation of **S1 only** — and S1 is the one subsystem the roadmap barely specifies, mentioning it once as a GTM lead magnet in §15.2.

### 4.1 Inventory

| Layer        | Path                                                                   | What it is                                                                                                                                                                   |
| ------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Audit engine | `engine/`                                                              | `@nurkamol/seo-audit` v1.40.1, vendored at commit `155525d`. ~12,200 lines, ~90 checks. See `engine/UPSTREAM.txt` for the two local patches.                                 |
| Worker       | `engine/worker/index.mjs`                                              | `handle(Request, env) => Response`. Every route: `/stream` (SSE), `/run`, `/plan`, `/preview`, `/diff`, `/reports`, `/compare`, `/checks`, `/options`, `/agents`, `/render`. |
| Adapter      | `app/api/engine/[...path]/route.ts`                                    | Strips `/api/engine`, presents the bearer token, hands off to the worker. **This one file is the entire backend.**                                                           |
| Front end    | `app/page.tsx`, `auditor.tsx`, `report.tsx`, `viz.tsx`, `ai-panel.tsx` | Next.js 16.3.5 / React 19. Form is drawn from the engine's own `formFields()`, so a flag added upstream becomes a control automatically.                                     |
| Check        | `check.mjs`                                                            | The one runnable end-to-end check. `npm start & npm run check`.                                                                                                              |

### 4.2 The AEO/GEO capability already shipped

Four of the last six commits are answer-engine work, and it is the genuinely differentiated part of the codebase:

- **`engine/src/agents-ai.mjs`** — thirteen AI crawlers checked against `robots.txt`, and critically it distinguishes **training** crawlers (GPTBot, ClaudeBot, Google-Extended, CCBot…) from **answering** crawlers (OAI-SearchBot, ChatGPT-User, Claude-SearchBot, PerplexityBot…). Blocking the first costs nothing today; blocking the second removes you from live answers. A site that meant to opt out of training and blocked both has almost certainly not read the difference — and that is the exact finding this module exists to surface.
- **`engine/src/ai.mjs`** — a **separate** readiness sheet, deliberately not folded into the 100-point score. Three pillars (Access / Answer engines / Generative engines), fourteen weighted signals, each scored _out of what actually applied_ rather than deducted from a fixed total. GEO weights are taken from the Princeton GEO study (KDD 2024, 10k Perplexity queries): citations largest, statistics second, quotes third.
- **`engine/src/llms.mjs`** — generates the `llms.txt` the site should have had, built entirely from strings the site already serves. Refuses to write one from a truncated crawl, on the grounds that a partial `llms.txt` is worse than none because it looks complete.
- **`engine/src/agents.mjs`** — crawl as Googlebot, Bingbot or any real browser/OS pair, so what a crawler is served can be compared with what a person is served.

### 4.3 What this means

We have built the **diagnostic half**. We have built none of the **generative half**.

Concretely: there is no database, no tenant, no user, no login, no job queue, no Anthropic call, no page generation, no publishing, no lead form, no billing. The roadmap's §17 MVP list has **ten items** and the repository satisfies **zero** of them — while delivering a §15.2 "Phase 3" lead magnet that is materially better than the one the roadmap describes.

That is not wasted work. It is a different, defensible entry point, and §12 treats it as one.

---

## 5. The gap — built vs. specified

\*See diagram: **Feature Stack — Built / Next / Later\***

| Subsystem               | Roadmap says         | Repo has                                                      | Gap                |
| ----------------------- | -------------------- | ------------------------------------------------------------- | ------------------ |
| S1 Diagnostics          | One paragraph, §15.2 | ~90 checks, 3-pillar AI score, 13 crawlers, `llms.txt` writer | **Ahead of spec**  |
| S2 Content Intelligence | §4.1 steps 1–2       | —                                                             | Full build         |
| S3 AI Pipeline          | §4.1 steps 3–7       | —                                                             | Full build         |
| S4 AI Visibility Engine | §5                   | —                                                             | Full build         |
| S5 Distribution         | §8                   | —                                                             | Full build         |
| S6 Leads & Analytics    | §6, §10              | —                                                             | Full build         |
| S7 Platform             | §3.3, §11, §13       | —                                                             | Full build         |
| S8 Citation Network     | §7                   | —                                                             | Mostly operational |

---

## 6. System architecture

_See diagrams: **Current Architecture**, **Target Architecture (AWS)**, **AI Feed Delivery**._

Five subsystems over a shared multi-tenant core. Each tenant is one paying customer — a business, or an agency holding many `client_profiles`.

### 6.1 Infrastructure decisions (from §3.2, unchanged)

| Component  | Choice                                     | Reason                                    |
| ---------- | ------------------------------------------ | ----------------------------------------- |
| Cloud      | AWS `ap-south-1` (Mumbai)                  | Latency for Indian users                  |
| API        | EC2 `t3.medium` + ASG                      | Control, cheap at early scale             |
| Database   | PostgreSQL on RDS `db.t3.medium`, Multi-AZ | Managed, PITR, read replicas              |
| Queue      | BullMQ on ElastiCache Redis `t3.micro`     | Retries, scheduling, priority             |
| AI         | Anthropic Claude (Sonnet tier)             | ~₹2 per generated page at current pricing |
| Storage    | S3                                         | Rendered HTML, reports, assets            |
| Edge       | CloudFront (+ Lambda@Edge)                 | Sub-100 ms `/feeds/` globally             |
| Email      | SES                                        | $0.10 / 1,000                             |
| SERP       | serper.dev (preferred) or SerpAPI          | $0.001–$0.002 per search                  |
| Payments   | Razorpay                                   | Indian market requirement                 |
| Monitoring | CloudWatch + Sentry                        | Infra + application errors                |

> **Decision needed.** The existing front end is Next.js 16 on Vercel-shaped hosting, and the existing engine already runs unmodified on both Node and Cloudflare Workers. The roadmap's EC2 + CloudFront stack was written before that existed. **See §14, Open Question 1.**

### 6.2 Architectural rules carried over from the engine

These are non-negotiable and already enforced in `engine/`:

1. **One implementation of every check.** The Worker and the CLI share `src/audit.mjs`; nothing is re-implemented per surface. Any new surface (dashboard, API, plugin) consumes the same module.
2. **A check that could not run is not a check that passed.** Skipped signals are excluded from both numerator and denominator. This is why a one-page crawl does not score 100.
3. **An opportunity costs nothing.** The AI readiness sheet never moves the 100-point grade.
4. **Never cry wolf.** A publisher who deliberately blocks ClaudeBot has done the correct thing correctly; the finding is a neutral note, never a fault.

---

## 7. Feature stack

\*See diagram: **Feature Stack — Built / Next / Later\***

```
┌─ Surfaces ──────────────────────────────────────────────────────────┐
│ Marketing site · Free AI Visibility Score · App dashboard ·          │
│ WordPress plugin · Cloudflare Worker · White-label PDF reports       │
├─ Application ───────────────────────────────────────────────────────┤
│ Auth & tenancy · Onboarding wizard · Content library · Calendar ·    │
│ Keyword manager · Lead inbox · Analytics · Client manager · Billing  │
├─ Engines ───────────────────────────────────────────────────────────┤
│ [BUILT] Visibility Diagnostics  │ Content Intelligence               │
│         AI Content Pipeline     │ Distribution Engine                │
│         Auto-Update Engine      │ Citation Network CRM               │
├─ Platform ──────────────────────────────────────────────────────────┤
│ BullMQ job queue · Credit ledger · Anthropic client · SERP client ·  │
│ Schema generator · Markdown→HTML renderer · Spam scorer · Audit log  │
├─ Data ──────────────────────────────────────────────────────────────┤
│ PostgreSQL (20 tables) · Redis · S3 · CloudFront                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 8. Functional requirements

Requirements are grouped by subsystem and tagged `FR-<subsystem>-<n>`. Priority: **M** must (MVP), **S** should (v1.0), **C** could (v1.1+).

### 8.1 S1 — Visibility Diagnostics `[largely built]`

| ID      | Requirement                                                                                        | Pri | State |
| ------- | -------------------------------------------------------------------------------------------------- | --- | ----- |
| FR-S1-1 | Crawl a site by sitemap or by following links, obeying `robots.txt`.                               | M   | ✅    |
| FR-S1-2 | Run ~90 technical checks and group findings by cause, ordered by reach.                            | M   | ✅    |
| FR-S1-3 | Score AI readiness across Access / AEO / GEO pillars, out of applicable signals only.              | M   | ✅    |
| FR-S1-4 | Report which of 13 AI crawlers are allowed, separating training from answering.                    | M   | ✅    |
| FR-S1-5 | Generate a draft `llms.txt`; refuse on a truncated crawl.                                          | M   | ✅    |
| FR-S1-6 | Compare what a crawler is served against what a browser is served.                                 | S   | ✅    |
| FR-S1-7 | Stream progress over SSE and render a printable report.                                            | M   | ✅    |
| FR-S1-8 | Expose the audit as a public, unauthenticated lead magnet with rate limiting and a captured email. | S   | ❌    |
| FR-S1-9 | Persist runs per tenant and re-run on a schedule, so the score becomes a trend.                    | S   | ❌    |

### 8.2 S2 — Content Intelligence

| ID      | Requirement                                                                                                        | Pri |
| ------- | ------------------------------------------------------------------------------------------------------------------ | --- |
| FR-S2-1 | Generate ≥30 seed buyer questions from `{industry, services, city, audience}` via Claude.                          | M   |
| FR-S2-2 | Expand seeds via SERP "People Also Ask"; deduplicate to 200–400 questions per client.                              | S   |
| FR-S2-3 | Score each question 0–100 for AI-citation probability; ≥70 is high priority.                                       | M   |
| FR-S2-4 | Fetch top-5 SERP results per high-priority keyword and extract H1/H2s, word count, FAQ presence, JSON-LD presence. | S   |
| FR-S2-5 | Store all of the above in `keyword_research`, with a gaps view of keywords that have no content.                   | M   |
| FR-S2-6 | Re-run research monthly per client.                                                                                | C   |

### 8.3 S3 — AI Content Pipeline

\*See diagram: **Multi-Agent Content Pipeline\***

| ID       | Requirement                                                                                                                                  | Pri |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| FR-S3-1  | Implement the pipeline as discrete, independently re-runnable queue steps. **No LLM framework** — plain functions calling the Anthropic SDK. | M   |
| FR-S3-2  | Structure agent returns a strict JSON blueprint: title, meta description, schema type, ordered sections with type and word-count targets.    | M   |
| FR-S3-3  | Writing agent generates markdown against the blueprint, in the client's brand voice, streamed to avoid timeouts.                             | M   |
| FR-S3-4  | Estimated data must be labelled as estimated. Unverifiable statistics without hedging are a **hard fail**.                                   | M   |
| FR-S3-5  | Schema agent is **deterministic code, not an LLM call** — FAQPage, Article, HowTo, LocalBusiness, Service.                                   | M   |
| FR-S3-6  | Quality score out of 100 across the nine weighted factors in §4.1 step 6. ≥80 auto-approve · 60–79 human review · <60 auto-regenerate.       | M   |
| FR-S3-7  | Render markdown → HTML into a page template carrying JSON-LD in `<head>`, feed navigation, content, lead form, footer.                       | M   |
| FR-S3-8  | Every job records tokens used, duration, attempts and error, for cost attribution.                                                           | M   |
| FR-S3-9  | Max 3 attempts, then `failed` with the error surfaced in the dashboard.                                                                      | M   |
| FR-S3-10 | **Reuse S1's checks to grade generated pages before publishing.** A page we generate must pass the readiness sheet we sell.                  | S   |

> FR-S3-10 is the single highest-leverage integration available to us, and it exists only because of what was built first. Nobody else in this market can grade their own output with the same instrument they sell as the diagnosis.

### 8.4 S4 — AI Visibility Engine

\*See diagram: **AI Feed Delivery\***

| ID      | Requirement                                                                                                                                              | Pri |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| FR-S4-1 | Serve a published page by slug from `GET /ai-feed/pages/:slug`, authenticated by client ID + secret.                                                     | M   |
| FR-S4-2 | **WordPress plugin** — `add_rewrite_rule` on `^feeds/(.+)$`, proxies to our API, installs in 2 minutes with only a Client ID. Covers ~65% of the market. | S   |
| FR-S4-3 | **Cloudflare Worker** — intercept `/feeds/*`, pass everything else through to origin.                                                                    | S   |
| FR-S4-4 | **Manual HTML download** — the MVP fallback; client uploads the files themselves.                                                                        | M   |
| FR-S4-5 | Auto-generate and republish `llms.txt` on every publish/unpublish. _(Generator already exists — FR-S1-5.)_                                               | M   |
| FR-S4-6 | Auto-generate `sitemap.xml` on any content status change.                                                                                                | S   |
| FR-S4-7 | `POST /clients/:id/verify-connection` proves pages are actually being served from the client's domain.                                                   | M   |
| FR-S4-8 | Detect the client's platform from their homepage during onboarding and show only the relevant instructions.                                              | S   |
| FR-S4-9 | Each page carries ≥2 internal links to sibling feed pages.                                                                                               | S   |

### 8.5 S5 — Distribution Engine

| ID      | Requirement                                                                                                                                                                                                                                                                                                                                                                         | Pri |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| FR-S5-1 | Repurpose a published feed page into platform-specific social content — one Claude call per piece, the page passed as context so facts cannot drift.                                                                                                                                                                                                                                | S   |
| FR-S5-2 | Enforce per-platform rules: LinkedIn 1,300 chars / hook line 1 / 3 hashtags · Instagram 2,200 with the first 125 load-bearing, plus a 30–60 s Reel script · YouTube full script with b-roll cues, titles, description, thumbnail text · X 6–8 tweet thread · WhatsApp 5 messages under 300 chars · GMB three post types with CTA button · Email subject A/B ×3 + 600–800 word body. | S   |
| FR-S5-3 | Month-grid content calendar with drag-to-reschedule.                                                                                                                                                                                                                                                                                                                                | S   |
| FR-S5-4 | Publish via WordPress REST (App Password), LinkedIn API, or generic webhook. Instagram and YouTube are copy-paste only.                                                                                                                                                                                                                                                             | S   |
| FR-S5-5 | Agency mode: require approval before anything schedules.                                                                                                                                                                                                                                                                                                                            | S   |

### 8.6 S6 — Leads & Analytics

| ID       | Requirement                                                                                                                                                              | Pri |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- |
| FR-S6-1  | Public `POST /leads` from feed-page forms — name, email, phone, message, plus source URL, referrer and UTMs.                                                             | M   |
| FR-S6-2  | Spam score 0–100 from: honeypot field, <3 s submit time, email-domain MX lookup, IP blocklist, content heuristics. 0–30 clean · 31–60 flagged · 61+ hidden but retained. | M   |
| FR-S6-3  | Notify the client by email — immediate, daily digest, or never.                                                                                                          | M   |
| FR-S6-4  | Lead inbox: status badges, filters, per-lead notes, one-click status, CSV export.                                                                                        | M   |
| FR-S6-5  | Track page views via a lightweight beacon on each feed page.                                                                                                             | S   |
| FR-S6-6  | Parse access logs for GPTBot / PerplexityBot / ClaudeBot / OAI-SearchBot / Googlebot and chart crawl activity.                                                           | S   |
| FR-S6-7  | Google Search Console integration for index status and impressions per URL.                                                                                              | S   |
| FR-S6-8  | Monthly PDF report via Puppeteer → S3 → email on the 1st. White-labelled on the Agency plan.                                                                             | S   |
| FR-S6-9  | **Every citation-related number is labelled an estimate in the UI.** Non-negotiable.                                                                                     | M   |
| FR-S6-10 | Surface intermediate milestones — indexed, crawled, first impressions — so progress is visible before leads arrive.                                                      | M   |

> FR-S6-10 is risk mitigation, not a feature. §16 rates "customer expectation mismatch" HIGH: customers expect leads next week, reality is 3–4 months.

### 8.7 S7 — Platform

| ID      | Requirement                                                                                                                | Pri |
| ------- | -------------------------------------------------------------------------------------------------------------------------- | --- |
| FR-S7-1 | JWT auth: 15-minute access token, httpOnly rotating refresh cookie, bcrypt cost 12, email verification, password reset.    | M   |
| FR-S7-2 | Tenant isolation on every query. Agency tenants see all their clients; business tenants see only themselves.               | M   |
| FR-S7-3 | Roles: owner / admin / member / viewer.                                                                                    | S   |
| FR-S7-4 | Credit ledger — debit before generation, refuse when exhausted, reset per billing cycle. Costs per §13.2.                  | M   |
| FR-S7-5 | Razorpay subscriptions with webhook handling, retry, SMS+email on failure, and a **7-day grace period** before suspension. | M   |
| FR-S7-6 | Soft delete everywhere (`deleted_at`). Never hard-delete.                                                                  | M   |
| FR-S7-7 | Encrypt integration credentials with AES-256-GCM at rest.                                                                  | M   |
| FR-S7-8 | Audit log every sensitive action: login, plan change, delete.                                                              | S   |
| FR-S7-9 | Team invitations by email for users who do not yet exist.                                                                  | C   |

### 8.8 S8 — Citation Network

| ID      | Requirement                                                                                                                                                                                                     | Pri |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| FR-S8-1 | On onboarding, queue submission to the free tier: Google Business Profile, Bing Places, Apple Maps, Clutch, GoodFirms, DesignRush, Crunchbase, LinkedIn, JustDial, Sulekha, IndiaMART, Wikidata where eligible. | S   |
| FR-S8-2 | Press-release generator + submission tracking (PRNewswire/BusinessWire India, PRLog, editorial pitches).                                                                                                        | C   |
| FR-S8-3 | Partner-site CRM in `partner_sites` / `backlink_placements`. Target 50 partners year 1, 150 year 2, 300 year 3.                                                                                                 | C   |

---

## 9. Data model

\*See diagram: **Database Schema (ERD)\***

PostgreSQL. UUID primary keys via `gen_random_uuid()`. All timestamps `TIMESTAMPTZ` in UTC. Soft deletes throughout.

**Core:** `tenants` · `users` · `client_profiles` · `keyword_research` · `content_pieces` · `ai_feed_pages` · `generation_jobs` · `leads`

**Supporting:** `integrations` (AES-256-GCM encrypted) · `backlink_placements` · `partner_sites` · `content_schedule` · `analytics_events` (time-series, partitioned monthly) · `billing_subscriptions` · `refresh_queue` · `team_invitations` · `email_logs` · `audit_log`

**Proposed additions**, required by the diagnostics subsystem that the roadmap did not anticipate:

| Table           | Purpose                                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `audit_runs`    | One row per crawl: target URL, options, score, AI-readiness pillars, findings JSONB, page count. Makes the score a trend rather than a snapshot. |
| `credit_ledger` | Append-only debits and credits. `tenants.credits_used` is a running total and cannot answer "where did 400 credits go".                          |

---

## 10. External interfaces

### 10.1 REST API

All under `/api/v1/`, JWT bearer, JSON. Full endpoint list in roadmap §11, summarised:

| Group             | Endpoints                                                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth              | `register` `login` `refresh` `logout` `forgot-password` `reset-password` `verify-email` `me`                                                    |
| Clients           | `GET/POST /clients` · `GET/PUT/DELETE /clients/:id` · `onboarding/complete` · `setup-instructions` · `verify-connection`                        |
| Content           | `generate` · `generate/stream` (SSE) · `batch-generate` · `jobs/:id` · CRUD · `approve` `publish` `schedule` `regenerate`                       |
| Keywords          | `research` · `list` · `gaps` · `suggest` · CRUD · `:id/generate`                                                                                |
| AI Feed           | `pages` · `pages/:slug` · `index` · `sitemap.xml` · `llms.txt` · `pages/:id/refresh` · `stats`                                                  |
| Leads             | `POST /leads` (public) · list · detail · update · `mark-spam` · `export` · `stats`                                                              |
| Analytics         | `dashboard` · `content-velocity` · `platform-breakdown` · `keyword-coverage` · `crawl-activity` · `lead-trend` · `reports/generate` · `reports` |
| **Audit** _(new)_ | `POST /audit/run` · `GET /audit/runs` · `GET /audit/runs/:id` · `POST /audit/public` (rate-limited lead magnet)                                 |

### 10.2 Third-party

| Service               | Used for                                     | Failure posture                                                     |
| --------------------- | -------------------------------------------- | ------------------------------------------------------------------- |
| Anthropic             | All generation                               | Queue + retry; rate limits are a §16 MEDIUM risk                    |
| serper.dev / SerpAPI  | PAA expansion, competitor SERPs, rank checks | Optional per keyword — skip on low priority to save cost            |
| Razorpay              | Subscriptions                                | Webhook-driven, retries, 7-day grace                                |
| Google Search Console | Index status, impressions                    | OAuth loopback flow already implemented in `engine/src/console.mjs` |
| PageSpeed Insights    | Performance                                  | Already wired in `engine/src/psi.mjs`                               |
| AWS SES               | Transactional email                          | Logged to `email_logs`                                              |
| LinkedIn API          | Social publishing                            | Requires platform approval — treat as blocked until granted         |

### 10.3 User-facing surfaces

Public: `/` `/pricing` `/blog` `/about` `/contact` `/demo` `/login` `/register` `/reset-password` — plus `/ai-visibility-score`, the free tool.

Onboarding: `welcome → business → voice → keywords → setup → plan → done`.

App: `/dashboard` `/ai-feed` `/ai-feed/setup` `/content/generate` `/content/library` `/content/calendar` `/keywords` `/leads` `/analytics` `/clients` `/clients/:id` `/integrations` `/settings` `/settings/billing` `/settings/team`.

\*See diagram: **User Journey — Signup to First Lead\***

---

## 11. Non-functional requirements

| ID     | Requirement                                                                                                                            |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-1  | `/feeds/*` pages served in **<100 ms** globally from edge cache.                                                                       |
| NFR-2  | Generation is **never synchronous**. `POST /content/generate` returns a job ID immediately.                                            |
| NFR-3  | Every tenant query is scoped by `tenant_id`. Cross-tenant leakage is a P0.                                                             |
| NFR-4  | Integration credentials encrypted at rest (AES-256-GCM); passwords bcrypt cost 12.                                                     |
| NFR-5  | Anthropic cost per AI Feed page ≈ ₹2. **Plan pricing must carry ≥5× margin over API cost at every tier.**                              |
| NFR-6  | Job queue rate-limits Anthropic calls from day one, not after the first 429 storm.                                                     |
| NFR-7  | Nothing below the quality threshold is ever auto-published. Fewer good pages beats more bad ones — bad pages actively harm the client. |
| NFR-8  | Billing alerts on AWS at ₹5,000 and ₹15,000/month.                                                                                     |
| NFR-9  | A capability that cannot run on a given runtime must say which one it did not run in. _(Carried from the engine's two-runtime rule.)_  |
| NFR-10 | PDF report generation must not block a request thread — queue it.                                                                      |

---

## 12. Delivery plan

The roadmap's §14.2 assumes a standing start. It no longer applies unchanged, because S1 is done and it changes what the cheapest first revenue looks like.

### 12.1 Recommended sequencing

\*See diagram: **Delivery Phases\***

| Phase                            | Weeks | Contents                                                                                           | Why here                                                                                                                                                                |
| -------------------------------- | ----- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0 · Harden what exists**      | 2     | Postgres + `audit_runs`, auth, tenancy, rate limiting. Ship `/ai-visibility-score` publicly.       | Turns a local tool into a lead magnet that collects emails **before** the generator exists. The roadmap put this at month 5; it is available now for two weeks of work. |
| **P1 · Pipeline**                | 6     | Queue, Anthropic client, steps 1–7, schema generator, quality score, HTML render, manual download. | The core product. Ends at a page a client can publish by hand.                                                                                                          |
| **P2 · Dashboard + leads**       | 5     | Onboarding wizard, dashboard, content library, lead capture, spam scoring, notifications.          | Makes it sellable.                                                                                                                                                      |
| **P3 · Billing**                 | 2     | Razorpay, credit ledger, plan enforcement, grace period.                                           | First revenue. **MVP complete here.**                                                                                                                                   |
| **P4 · Delivery integrations**   | 3     | WordPress plugin, Cloudflare Worker, `verify-connection`, auto `llms.txt` + sitemap.               | Removes the manual-upload friction that will otherwise cap retention.                                                                                                   |
| **P5 · Social engine**           | 4     | Seven platforms, calendar, approval workflow.                                                      | The stated differentiator over Gushwork.                                                                                                                                |
| **P6 · Agency + reports**        | 3     | Multi-client dashboard, white-label PDF, team roles.                                               | Unlocks the ₹19,999 tier — 12–17 of which cover the whole build cost.                                                                                                   |
| **P7 · Auto-update + analytics** | 4     | Refresh cron, Search Console, crawl-log parsing, rank checks.                                      | Retention and proof.                                                                                                                                                    |
| **P8 · Polish + launch**         | 2     | Security audit, performance, beta onboarding.                                                      |                                                                                                                                                                         |

**Total: 31 weeks** with 3 developers; ~22 with 4 working front end and back end in parallel.

### 12.2 MVP definition (§17, amended)

Ships at end of P3. Ten items:

1. Registration, login, email verification
2. Client profile setup incl. brand voice
3. AI-generated keyword/question list _(no SERP yet)_
4. AI Feed page generation and preview
5. Manual HTML download
6. Content library
7. Lead form on feed pages + email notification
8. Lead list
9. Starter plan via Razorpay
10. Transactional emails

**Amended:** add **(11) the public AI Visibility Score**, shipped in P0 and running for the whole of P1–P3 as a standing lead-collection machine.

### 12.3 MVP success criteria (unchanged — these are the gate)

- 10 paying customers at any price point
- ≥3 customers with feed pages indexed by Google inside 30 days
- ≥1 inbound lead through a feed page
- > 5 min average dashboard session
- NPS ≥30 from the first 10

> If ten paying customers cannot be reached with this, more features will not fix it.

---

## 13. Commercial model

### 13.1 Plans

|                     | Starter    | Growth     | Agency              |
| ------------------- | ---------- | ---------- | ------------------- |
| Monthly             | **₹2,999** | **₹7,999** | **₹19,999**         |
| Annual (−20%)       | ₹28,790    | ₹76,790    | ₹1,91,990           |
| Feed pages / mo     | 50         | 200        | 1,000               |
| Social pieces / mo  | 20         | 100        | 500                 |
| Clients             | 1          | 5          | Unlimited           |
| Backlinks / mo      | 3          | 10         | 25                  |
| Credits / mo        | 150        | 600        | 3,000               |
| Auto-update         | —          | ✅         | ✅                  |
| LinkedIn            | —          | ✅         | ✅                  |
| Search Console      | —          | ✅         | ✅                  |
| White-label reports | —          | —          | ✅                  |
| Human QA            | —          | Monthly    | Weekly              |
| Support             | Email 48h  | Email 24h  | WhatsApp + priority |

Top-up: 100 credits for ₹500.

### 13.2 Credits

| Action                                | Credits |
| ------------------------------------- | ------- |
| AI Feed page                          | 2       |
| Blog post                             | 3       |
| LinkedIn post                         | 1       |
| Instagram caption + Reel              | 1       |
| YouTube script                        | 3       |
| Email newsletter                      | 2       |
| Refresh a page                        | 1       |
| Keyword research (per client)         | 5       |
| Competitor analysis (per keyword)     | 1       |
| **Visibility audit run** _(proposed)_ | **2**   |

### 13.3 Economics

Build burn ₹2.33–3.23 L/month; ₹14–19.4 L over six months. **Break-even: 12–17 Agency customers.**

Projections (§13.3) are aspirational at 15–20% monthly growth; the document's own guidance is to expect 30–50% of year-one figures.

---

## 14. Risks and open questions

### 14.1 Risks (§16)

| Risk                                      | Sev      | Mitigation                                                                                                                                      |
| ----------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| AI engines change how they index and cite | **HIGH** | Auto-update engine from day one. Treat freshness as core. Monitor crawler behaviour continuously — **we already have the instrument for this.** |
| Content quality variance at scale         | **HIGH** | Quality scoring, human review queue, never auto-publish below threshold. FR-S3-10 grades output with the same engine we sell.                   |
| Customer expectation mismatch             | **HIGH** | State 3–4 months on the pricing page. Show indexing and crawl milestones before leads (FR-S6-10).                                               |
| Citation network takes years              | MED-HIGH | Phase it: free directories → press → partners. Be honest about timelines.                                                                       |
| WordPress plugin compatibility            | MED      | Test top 20 themes; error reporting in-plugin; manual-HTML fallback always available.                                                           |
| Anthropic rate limits and cost            | MED      | Queue + rate limit from day one; 5× margin (NFR-5).                                                                                             |
| Razorpay failures                         | LOW-MED  | Robust webhooks, retries, SMS+email, 7-day grace.                                                                                               |

### 14.2 Open questions — decisions needed before P1

1. **Runtime.** Keep the Next.js + Worker-adapter shape already working, or move to the roadmap's EC2 + CloudFront? The engine runs unmodified on both. Deciding this after P1 means rewriting the API layer.
2. **Does the audit engine stay vendored?** It is pinned at upstream `155525d` with two local patches. If OmniRank depends on it commercially, we either take ownership of the fork or contribute the patches upstream. Drifting silently is the bad third option.
3. **Where does `audit_runs` live** relative to `content_pieces`? An audit finding and a content gap are close cousins; a shared "opportunity" concept may be worth the modelling.
4. **Is FR-S1-8 (public scorer) the wedge product, or a lead magnet?** A free scorer with a paid "fix it for me" button is a materially different funnel from a SaaS with a free tool attached.
5. **Human QA capacity.** Growth and Agency plans promise monthly/weekly human review. Nobody is costed for this in §14.3.
6. **Hindi/Gujarati** is promised as Phase 2 in §3.1 and specified nowhere. Prompt-level only, or does it reach schema, `llms.txt` and the UI?

---

## 15. Traceability

| SRS §    | Roadmap §   | Code                                                                        |
| -------- | ----------- | --------------------------------------------------------------------------- |
| §4       | —           | `engine/`, `app/`, `app/api/engine/[...path]/route.ts`                      |
| §6       | 3.2         | —                                                                           |
| §8.1     | 15.2        | `engine/src/ai.mjs`, `agents-ai.mjs`, `llms.mjs`, `agents.mjs`, `score.mjs` |
| §8.2–8.3 | 4.1         | —                                                                           |
| §8.4     | 5           | `engine/src/llms.mjs` (partial)                                             |
| §8.5     | 8           | —                                                                           |
| §8.6     | 6, 10       | `engine/src/console.mjs`, `psi.mjs` (partial)                               |
| §8.7     | 3.3, 11, 13 | —                                                                           |
| §8.8     | 7           | —                                                                           |
| §9       | 3.3         | —                                                                           |
| §10      | 11, 12      | `engine/worker/index.mjs`                                                   |
| §12      | 14.2, 17    | —                                                                           |
| §13      | 13          | —                                                                           |
| §14      | 16          | —                                                                           |
