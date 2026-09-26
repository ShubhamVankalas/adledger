# AdLedger — Architecture

> v0.1 design. The original multi-service design (FastAPI + Celery + Redis + separate
> Next.js and MCP services) was replaced on 2026-09-26 by a **single TypeScript app** so
> non-technical users can install AdLedger with one command. See “Decisions” at the end.

## 1. System overview

```
 Browser (customer's site)       Ad platforms            Payments
 ┌───────────────────────┐   ┌────────────────────┐  ┌──────────────┐
 │ al.js pixel (1.7 KB)  │   │ Meta Graph API     │  │ Stripe API + │
 │ page views, UTMs,     │   │ Google Ads API     │  │ webhooks     │
 │ click IDs, leads      │   └─────────┬──────────┘  └──────┬───────┘
 └──────────┬────────────┘             │ scheduled sync     │ webhooks + backfill
            │ POST /api/v1/collect     ▼                    ▼
            │          ┌──────────────────────────────────────────────┐
            └────────▶ │ AdLedger app (Next.js, one Node process)     │
 Form tools ─webhook─▶ │  • dashboard (React Server Components)       │
 Claude/Cursor ─MCP──▶ │  • REST API /api/v1, MCP /api/mcp            │
                       │  • jobs: syncs, attribution, weekly reports  │
                       └───────────────────────┬──────────────────────┘
                                               ▼
                          PostgreSQL 16 (or embedded PGlite for dev/tests)
```

Rules:
- **Numbers are computed in SQL, never by the LLM.** The AI only narrates a “facts pack”, and
  every number in its output is checked against the pack.
- **One read path.** `src/lib/reports.ts` feeds the dashboard, REST API, MCP tools and AI facts,
  so they always agree.
- **Every connector has a mock mode** that serves realistic data in the platform's real API
  format, so demo mode and tests exercise the same parsing code as live mode.

## 2. Repository layout

```
.
├── src/
│   ├── app/
│   │   ├── (auth)/setup, login          first-run wizard + sign-in
│   │   ├── (app)/                        dashboard: overview, performance, contacts, insights, settings
│   │   ├── actions/                      server actions (auth, settings)
│   │   └── api/
│   │       ├── v1/collect                pixel endpoint (text/plain beacons)
│   │       ├── v1/webhooks/leads/[token] generic form webhook
│   │       ├── v1/webhooks/stripe/[ws]   Stripe webhook (signature verified)
│   │       ├── v1/reports/[report]       REST reports (API key)
│   │       ├── v1/contacts, v1/sync      REST
│   │       ├── v1/health                 health check
│   │       └── mcp                       MCP server (Streamable HTTP, API key)
│   ├── components/                       UI (shadcn/ui on Base UI, Recharts)
│   ├── lib/
│   │   ├── db/{schema,index}.ts          Drizzle schema; pg or PGlite driver; auto-migrate
│   │   ├── money.ts                      minor units, currency exponents, allocate()
│   │   ├── crypto.ts                     hashing, scrypt passwords, AES-GCM, PII redaction
│   │   ├── auth.ts                       sessions, API keys
│   │   ├── settings.ts                   workspace + encrypted connection credentials
│   │   ├── tracking/{utm,collect,identity}.ts
│   │   ├── connectors/{ads,stripe}.ts    Meta, Google Ads, Stripe (live + mock)
│   │   ├── sync.ts, matching.ts          upserts, touchpoint→ad matching
│   │   ├── attribution/                  models + recompute
│   │   ├── reports.ts                    all reporting SQL
│   │   ├── ai/{facts,report,numbers}.ts  facts pack, BYO-model client, number check
│   │   ├── mcp.ts                        read-only MCP tools
│   │   ├── jobs.ts, boot.ts              in-process scheduler, startup
│   │   └── demo/{world,seed}.ts          deterministic demo world + seeder
│   └── instrumentation.ts                runs boot() once on server start
├── pixel/al.ts                           pixel source → public/p/al.js (esbuild)
├── drizzle/                              SQL migrations (drizzle-kit generate)
├── fixtures/                             sample API payloads (Meta, Google Ads, Stripe)
├── tests/                                vitest (embedded Postgres; optional real Postgres)
├── examples/demo-site/                   static page for manual pixel testing
├── Dockerfile, docker-compose.yml, install.sh, render.yaml, railway.json
└── docs/
```

## 3. Runtime

| Piece | How it runs |
|---|---|
| App | `node server.js` (Next.js standalone output) on port 3000 |
| Database | PostgreSQL 16 via `DATABASE_URL`; if unset, embedded PGlite in `DATA_DIR` (dev, single-container trials) |
| Migrations | Applied automatically at startup (`src/lib/db/index.ts`) |
| Background jobs | `src/lib/jobs.ts`: ad sync every `SYNC_INTERVAL_HOURS` (6), weekly insights check hourly, debounced attribution recompute after webhooks/leads/syncs. Scheduled jobs take a Postgres advisory lock, so running several replicas is safe. |
| HTTPS | Optional Caddy container (`docker compose --profile https`) or any reverse proxy |

## 4. Data model (PostgreSQL)

Every tenant table has `id uuid pk`, `workspace_id uuid fk`, `created_at timestamptz`
(`workspaces` and the instance-level `app_meta` are the exceptions). Money is
`*_minor bigint` + `currency`. Timestamps are UTC `timestamptz`.

**Tenancy & access** — `organizations` (a business or agency) → `workspaces` (one per brand or
client: reporting_currency, timezone, attribution_window_days, is_demo, onboarding),
`users` (login identity; scrypt hash), `memberships` (user × organization with a role: owner, admin,
analyst, viewer, client — clients carry an explicit list of workspace ids), `invitations` (hashed
token, 7-day expiry), `audit_log`, `sessions` (hashed token, current workspace), `api_keys` (hashed),
`pixel_sites` (public key, allowed domains), `lead_webhooks` (token, field mapping),
`notification_rules` (event × channel, settings such as hour or threshold), `connections`
(any provider id from the integration registry, `llm`, or a `notify_*` channel; mode mock|live, config jsonb,
`secrets_enc` AES-256-GCM, last_synced_at, last_error), `app_meta` (generated app secret).

**Ads** — `ad_accounts`, `campaigns`, `ad_groups`, `ads`, `ad_insights_daily`
(unique `(workspace_id, platform, ad_id, date)`, idempotent upserts), `sync_runs`.

**First-party tracking** — `visitors` (anonymous_id, contact_id), `events` (raw, append-only,
PII-redacted properties, truncated IP), `touchpoints` (UTMs, click id, fbp/fbc, channel,
platform, matched campaign/ad group/ad).

**People & money** — `contacts` (the only table with raw email; email_hash, phone_hash,
lifecycle, external ids), `leads` (PII-redacted raw payload), `revenue_events` (Stripe
payments and refunds; unique `(workspace_id, source, external_id)`).

**Derived** — `attribution_credits` (model, conversion type/id/time, touchpoint or null for
unattributed, channel, platform, campaign/ad group/ad, credit numeric(9,6), revenue_minor),
`ai_reports` (period, model name, facts, markdown, unverified numbers).

## 5. Key flows

**Pixel → touchpoint.** `al.js` loads with `data-site=pk_…`, keeps a first-party `_al_vid`
cookie (broadest cookie-able domain, localStorage fallback) and sends batched `text/plain`
beacons (no CORS preflight). The API validates the site key and origin, drops bots, stores the
event (IP truncated, emails in properties hashed), upserts the visitor and creates a touchpoint
when the URL has UTMs/click IDs or the referrer is an external site. Refreshes within 30
minutes with the same campaign/click are de-duplicated.

**Channels.** gclid/gbraid/wbraid/msclkid → paid_search; paid mediums (cpc, ppc, paid_social,
cpm, display…) → paid_social or paid_search by source; fbclid/ttclid → paid_social;
email/newsletter → email; social/search referrers → organic; other referrers → referral.

**Identity stitching.** `identify`/`lead` with an email → normalized + hashed → find-or-create
contact → link the visitor (first link wins). Several visitors per contact are allowed
(phone + laptop). Contacts are never merged automatically.

**Revenue (Stripe).** `charge.succeeded`/`charge.refunded` are the source of money;
`checkout.session.completed` links the buyer to their visitor (`client_reference_id` or
`metadata.adledger_vid`) and back-fills the contact on an earlier charge. Payments are keyed by
payment_intent (else charge id), refunds by `refunds:{charge}` with a cumulative negative
amount — replays never duplicate. Contact resolution: visitor id → email → Stripe customer id.

**Ad spend.** Meta Graph API `v26.0` insights (level=ad, daily, unified attribution setting) and
Google Ads API `v25` `searchStream` GAQL on `ad_group_ad`. Versions are configurable. Meta
`spend` is a decimal string and Google `cost_micros` an integer — both converted to minor units
without floating point. Scheduled syncs cover yesterday + trailing 7 days.

**Matching touchpoints to ads.** IDs in UTMs (utm_campaign / utm_term / utm_content = campaign /
ad group / ad id) → names (case-insensitive exact) → unmatched (still counted by channel).
Re-run after every sync; only fills empty matches.

**Attribution.** Conversions: first lead per contact, first payment per contact (“customer”),
every revenue event. Eligible touchpoints are the contact's touchpoints within
`attribution_window_days` before the anchor. The anchor is the conversion time, except that
**repeat payments and refunds anchor at the customer's first payment** (LTV attribution).
Models: first_touch (earliest), last_touch (latest non-direct), linear (equal). Revenue is split
with largest-remainder rounding so credits sum exactly to the payment. No touchpoints → one
“unattributed” credit (reported, not hidden). Full recompute per workspace, debounced, and once
per boot so logic upgrades apply to old data.

**Currency.** One reporting currency per workspace. Rows in other currencies are stored but
excluded from totals, with a warning in the API/UI. FX conversion is v0.2.

**Reporting.** `overview`, `performance` (campaign / ad_group / ad, drill-down by parent),
`timeseries`, `channels`, `wasted-spend`, `compare`, contacts list and journey. Date filters
are inclusive and use the workspace timezone for day boundaries. `reports-advanced.ts` adds
`model-comparison` (first-touch vs last-touch vs linear revenue/ROAS per campaign, with each
campaign flagged as a journey starter or closer) and `ltv` (first-payment-month cohorts with
monthly and cumulative revenue per customer, and LTV:CAC per acquiring platform/channel).

**AI insights.** `ai/facts.ts` builds a JSON facts pack (current vs previous period, top and
wasted campaigns, biggest movers, channel mix) with pre-formatted money. `ai/report.ts` calls the
configured model through the Vercel AI SDK (OpenAI, Anthropic, Gemini, or any
OpenAI-compatible endpoint incl. Ollama/LM Studio/OpenRouter/DeepSeek). With no model, a
deterministic template report is produced. `ai/numbers.ts` flags numbers not present in the facts.

**MCP.** `/api/mcp` serves read-only tools via `mcp-handler` (Streamable HTTP, stateless) with
API-key auth. Tool output always states date range, currency and attribution model; contact
emails are masked.

**Integration registry.** `src/lib/connectors/registry.ts` lists every integration. Ad connectors
implement `AdsConnector` (`fetchLive` + `mock`, both returning normalized `AdDayRow`s), revenue
sources implement `RevenueConnector` (`verifyWebhook`, `parseWebhook`, optional `backfill`), and
notification channels implement `NotificationChannelDriver`. Each carries `IntegrationMeta` (fields,
setup steps, docs link) that drives the Settings catalog and connect forms — adding an integration is one
file plus one registry line. Revenue webhooks for every non-Stripe source share
`/api/v1/webhooks/{provider}/{workspaceId}`; all revenue goes through `ingestRevenue` (idempotent on
source + external id; contact matched by visitor id → email → customer id → phone).

**Imports.** The Spend API (`POST /api/v1/spend`), Conversions API (`POST /api/v1/conversions`) and
CSV uploads share `src/lib/imports.ts`, so any ad network or checkout without a native connector can be
brought in (Zapier, Make, n8n, scripts, spreadsheets).

**Teams & permissions.** Roles are per organization (`src/lib/permissions.ts`): owner (everything),
admin (workspaces, integrations, members), analyst (reports, exports, insights, API keys), viewer
(read-only), client (read-only, only listed workspaces). Every server action calls `guard(permission)`;
owners can't be demoted or removed if they are the last one. Sessions store the current workspace;
switching validates access.

**Notifications.** `src/lib/notify` delivers events (weekly report, daily digest, wasted spend, sync
failed, new customer, large payment) to the channels selected in `notification_rules`. Scheduled
events run hourly and respect the workspace timezone; delivery failures are logged, never thrown.

## 6. Configuration

All optional; see `.env.example`. Connector credentials and the AI model are configured in the
dashboard and stored encrypted with `APP_SECRET` (auto-generated and stored in the database if
not provided). Headless installs can set `ADMIN_EMAIL`/`ADMIN_PASSWORD` (+ `DEMO_DATA=true`).

## 7. Security & privacy

- Pixel keys are public and can only write events; everything else needs a session or API key.
- Rate limits on `/collect`, webhooks and login (in-memory token buckets).
- IPs truncated; emails/phones hashed everywhere except `contacts`; PII redacted from stored
  form payloads and event properties.
- Sessions: random 256-bit tokens, stored hashed, httpOnly + SameSite=Lax cookies (Secure behind HTTPS).
- Passwords: scrypt (N=2^15). Credentials: AES-256-GCM.
- Security headers on dashboard routes; CORS open only on the pixel endpoint.

## 8. Testing

`pnpm test` runs vitest against an in-memory embedded Postgres with `CONNECTOR_MODE=mock`:
money math (property tests), UTM/channel rules, trait extraction and PII redaction, the full
pixel → lead → Stripe → sync → attribution → reports pipeline, idempotency, signature checks,
timezone-correct filters, route handlers, schema conventions, AI number checks, MCP read-only
guarantees, and the seeded demo story. CI also runs the suite against a real PostgreSQL 16 and
smoke-tests the Docker image with `docker compose up`.

## Decisions

- **2026-09-26 — single app instead of 7 services.** FastAPI + Celery + Redis + Next.js + a
  separate MCP server meant 7 containers and two languages. For a product whose top priority is
  “non-technical people can install it”, one container + Postgres wins. Background work is small
  (a sync every few hours, a recompute after events), so an in-process scheduler with Postgres
  advisory locks replaces Celery/Redis.
- **Drizzle + PGlite.** SQL-first ORM (reports are hand-written SQL) with an embedded Postgres
  for zero-setup development, single-container trials and fast tests.
- **Credentials in the UI, not env vars.** Easier for non-technical users; encrypted at rest.
- **2026-09-27 — organizations & roles.** Agencies need many client workspaces and read-only client
  access; teams need roles. Existing installs are migrated automatically (each workspace becomes its own
  organization; its admin becomes the owner).
- **LTV attribution for repeat payments.** Renewals credit the acquiring journey instead of
  becoming “unattributed” once the window has passed.
