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
│   │       ├── v1/webhooks/[provider]/[ws] other revenue sources (Shopify … PhonePe)
│   │       ├── v1/webhooks/leads-native/[provider]/[ws] Meta / Google Ads / TikTok lead forms
│   │       ├── v1/webhooks/whatsapp/[ws] WhatsApp Business Cloud API (click-to-chat leads)
│   │       ├── v1/webhooks/crm/[provider]/[ws] HubSpot / Pipedrive deal events
│   │       ├── v1/reports/[report]       REST reports (API key)
│   │       ├── v1/contacts, v1/sync      REST (+ DELETE / export per contact)
│   │       ├── v1/exports/{contacts,workspace} CSV / streamed JSON downloads
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
│   │   ├── connectors/{ads,revenue,crm,leads}/ one file per extra connector (registry.ts lists all)
│   │   ├── sync.ts, matching.ts          upserts, touchpoint→ad matching
│   │   ├── attribution/                  models + recompute
│   │   ├── reports.ts                    all reporting SQL
│   │   ├── privacy.ts                    erasure, subject-access + workspace export, retention
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
| Background jobs | `src/lib/jobs.ts`: ad sync every `SYNC_INTERVAL_HOURS` (6), weekly insights check hourly, conversion uploads hourly, alert rules hourly, debounced attribution recompute after webhooks/leads/syncs. Scheduled jobs take a Postgres advisory lock, so running several replicas is safe. |
| HTTPS | Optional Caddy container (`docker compose --profile https`) or any reverse proxy |

## 4. Data model (PostgreSQL)

Every tenant table has `id uuid pk`, `workspace_id uuid fk`, `created_at timestamptz`
(`workspaces` and the instance-level `app_meta` are the exceptions). Money is
`*_minor bigint` + `currency`. Timestamps are UTC `timestamptz`.

**Tenancy & access** — `organizations` (a business or agency; optional logo) → `workspaces` (one per brand or
client: reporting_currency, timezone, attribution_window_days, is_demo, onboarding),
`users` (login identity; scrypt hash; optional profile picture), `memberships` (user × organization with a role: owner, admin,
analyst, viewer, client — clients carry an explicit list of workspace ids), `invitations` (hashed
token, 7-day expiry), `audit_log`, `sessions` (hashed token, current workspace), `api_keys` (hashed),
`pixel_sites` (public key, allowed domains, consent_mode optout|required|cookieless), `lead_webhooks` (token, field mapping),
`notification_rules` (event × channel, settings such as hour or threshold), `connections`
(any provider id from the integration registry, `llm`, or a `notify_*` channel; mode mock|live, config jsonb,
`secrets_enc` AES-256-GCM, last_synced_at, last_error), `app_meta` (generated app secret).

**Ads** — `ad_accounts`, `campaigns`, `ad_groups`, `ads`, `ad_insights_daily`
(unique `(workspace_id, platform, ad_id, date)`, idempotent upserts), `sync_runs`.

**First-party tracking** — `visitors` (anonymous_id, contact_id, consent granted|denied|unknown, gpc), `events` (raw, append-only,
PII-redacted properties, truncated IP), `touchpoints` (UTMs, click id, fbp/fbc, channel,
platform, matched campaign/ad group/ad).

**People & money** — `contacts` (the only table with raw email; email_hash, phone_hash,
lifecycle, external ids, ads_consent granted|denied|null), `leads` (PII-redacted raw payload), `revenue_events` (payments
and refunds from every revenue source, plus won CRM deals; unique `(workspace_id, source, external_id)`).

**Derived** — `attribution_credits` (model, conversion type/id/time, touchpoint or null for
unattributed, channel, platform, campaign/ad group/ad, credit numeric(9,6), revenue_minor),
`ai_reports` (period, model name, facts, markdown, unverified numbers), `conversion_uploads` (platform ×
conversion type × lead/payment id, unique; status pending|sent|failed|skipped, attempts, next_attempt_at,
error, mock, sent_at, skip_reason, consent_mode = the consent basis it was built with).

**Overview layouts** — `dashboards` (name, preset, layout jsonb, version, updated_at; `user_id` null =
the workspace default, otherwise that member's personal override; unique `(workspace_id, user_id)` with
nulls not distinct).

**Automation, sharing, Ask** — `alert_rules` (kind threshold|anomaly, metric cac|cpl|roas|spend|revenue|leads,
comparator, `threshold_minor` for money or `threshold_value` for ratios/counts/z-score, window_days, scope
workspace|platform|campaign + scope_id, channels jsonb, cooldown_hours, enabled, state ok|breached, last value
and times), `alert_events` (history: triggered|resolved, title, detail, value, period, channels delivered),
`share_links` (SHA-256 of the token, label, page, locked filters jsonb, expires_at, revoked_at, view_count,
last_viewed_at, created_by), `ask_messages` (per-user Ask history: role, content, the SQL result tables it
cites, unverified numbers, model name).
**Reports** — `report_schedules` (report kind, params {model, compare}, weekly/monthly cadence, weekday,
local hour, recipients {all | user ids}, skip_empty, last run status), `export_log` (one row per PDF:
user / API key / schedule id, kind, params, unique fingerprint, data hash, bytes, pages, recipients,
status — ids only, no personal data). `organizations.logo_png` holds the PNG copy of the logo for PDFs.

## 5. Key flows

**Pixel → touchpoint.** `al.js` loads with `data-site=pk_…`, keeps a first-party `_al_vid`
cookie (broadest cookie-able domain, localStorage fallback) and sends batched `text/plain`
beacons (no CORS preflight). The API validates the site key and origin, drops bots, stores the
event (IP truncated, emails in properties hashed), upserts the visitor and creates a touchpoint
when the URL has UTMs/click IDs or the referrer is an external site. Refreshes within 30
minutes with the same campaign/click are de-duplicated.

**Channels.** gclid/gbraid/wbraid/msclkid → paid_search; paid mediums (cpc, ppc, paid_social,
cpm, display…) → paid_social or paid_search by source; fbclid/ttclid → paid_social;
email/newsletter → email; AI assistants (chatgpt.com, chat.openai.com, perplexity.ai, gemini.google.com,
copilot.microsoft.com, claude.ai as referrer, or utm_source=chatgpt.com and similar) → ai_assistant;
social/search referrers → organic; other referrers → referral.

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

**Analysis depth.** `src/lib/reports-analysis.ts` (SQL, workspace timezone, integer minor units) feeds
the Attribution → Paths and Time to convert tabs and the Customers → Cohorts and Payback tabs, plus
two Overview widgets: `attributionPaths` (ordered channel/platform sequences inside the attribution
window before a first payment or first lead, repeats collapsed, with revenue to date, median days and
touches), `timeToConvert` (first touch → lead → payment lags with median/p80/p90 and buckets, touches
to convert, cross-device share, per-campaign lags and a recommended window = smallest round window
covering 90% of first touch → payment lags, only from 20 customers), `modelDisagreement` (dumbbell data
per campaign from `modelComparison`), `cohortRetention` + `cohortAverages` (monthly acquisition cohorts:
retention %, cumulative LTV, revenue per month, CAC payback month; months that have not happened are
`null`, not 0), `paybackByChannel` (credit-weighted LTV at day 0–365 over matured customers only, CAC =
platform spend ÷ credited customers, interpolated payback day, repeat and refund rates), `funnel`
(visitors → leads → customers → revenue, with the previous or last-year period) and `conversionsHeatmap`
(weekday × hour). The UI lives in `src/components/analysis/**` (hand-built HTML/SVG charts except the
LTV curve, which uses Recharts); tab rows carry the period and filters between tabs. Tests check the SQL on
a hand-computed ledger (incl. Asia/Kolkata bounds and workspace isolation) and cross-check every function
against direct SQL on the demo data.

**AI insights.** `ai/facts.ts` builds a JSON facts pack (current vs previous period, top and
wasted campaigns, biggest movers, channel mix) with pre-formatted figures (whole-unit money, signed
changes, human dates, platform and channel display names). `ai/report.ts` calls the
configured model through the Vercel AI SDK (OpenAI, Anthropic, Gemini, or any
OpenAI-compatible endpoint incl. Ollama/LM Studio/OpenRouter/DeepSeek). With no model, a
deterministic template report is produced. `ai/numbers.ts` flags numbers not present in the facts.

**Display formatting.** `src/lib/format.ts` owns how numbers read in the UI: exact `money()` for
individual payments, `moneyWhole()` (no cents above 10) for tables, KPIs and unit costs,
`moneyShort()` ($41.3K) for secondary text; `credit()` shows credited leads/customers whole from
10 up and to one decimal below (linear credit is fractional; CSV exports keep exact values);
`roas()`, `pct()`, `signedPct()` use a real minus sign; `dateRange()` gives "Sep 20 – 26".

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
source + external id; contact matched by visitor id → email → customer id → phone). “New customer” and
“large payment” alerts fire only when the row is newly inserted, so webhook replays never re-notify.
Connectors with non-JSON bodies read the raw body themselves (Instamojo and Gumroad post forms, Recurly
posts XML); Gumroad and Recurly also read a `token` / `currency` query parameter, which the Settings
dialog includes in the webhook URL it shows (`webhookPathFor` in the registry).

**CRM deals.** `src/lib/connectors/crm/` (HubSpot, Pipedrive) implement `RevenueConnector` plus
`webhookDealIds` / `fetchDeals`. Backfill (on connect and **Sync now**) imports won deals;
`/api/v1/webhooks/crm/{provider}/{workspaceId}` re-reads the deals named in a webhook through the CRM
API (CRM webhooks carry only ids) and ingests the won ones through `ingestRevenue`.

**Native lead forms.** `src/lib/connectors/leads/` (Meta Lead Ads, Google Ads lead forms, TikTok Lead
Generation) implement `LeadConnector` (`verifyWebhook`, `parseWebhook`, and `verifyChallenge` for Meta's
GET handshake). `/api/v1/webhooks/leads-native/{provider}/{workspaceId}` verifies the call, and
`ingestNativeLeads` creates the contact, the lead and a touchpoint carrying the ad, ad group and
campaign ids, so the lead is credited to the ad that collected it (idempotent on the platform's lead id).
These connections are webhook-only: sync is a no-op.

**WhatsApp click-to-chat.** The pixel appends a short reference code to WhatsApp links and records a
`whatsapp_click` event. `/api/v1/webhooks/whatsapp/{workspaceId}` (signed with the app secret; GET is the
verification handshake) turns the first message carrying a code into a lead linked to that visitor
(`src/lib/tracking/whatsapp.ts`).

**One-click connect.** `src/lib/oauth` runs the OAuth authorization-code flow (PKCE where the
platform supports it) for connectors whose `IntegrationMeta.oauth` env vars are set:
`/api/v1/oauth/{provider}/start` → platform consent → `/callback` (signed state cookie, code exchange,
tokens held in an encrypted 15-minute cookie) → account picker → `saveConnection` with the connector's
usual config/secret keys → background sync.

**Conversion upload (CAPI).** `src/lib/capi/` sends leads and payments back to the ad platforms so
their bidding learns from real revenue. Switched on per connection (Meta: `capiEnabled` + `pixelId`
[+ `capiAccessToken`, `testEventCode`]; Google Ads: `conversionUploads` + lead/purchase conversion action
IDs). An hourly job enqueues recent conversions (Meta: 7 days, its limit; Google: 30 days) into
`conversion_uploads` (`on conflict do nothing`, so re-runs are idempotent) and sends due rows in batches.
Meta events carry `event_id = {lead|purchase}_{id}` for de-duplication, SHA-256 `em`/`ph`/`external_id`,
fbc/fbp, the stored (truncated) IP and user agent, the page URL without its query string (stored URLs
are not PII-redacted), and `value` in exact major units; without a user agent and page URL the
`action_source` is `system_generated`. Google conversions go through the **Data Manager API**
(`POST https://datamanager.googleapis.com/v1/events:ingest`, OAuth scope `auth/datamanager`, no
developer token), because since 15 June 2026 the Google Ads API's `uploadClickConversions` rejects
developer tokens that hadn't uploaded offline conversions before. Each event carries the latest
gclid/gbraid/wbraid within 90 days (or, for leads without a click id, the Google-normalized hex SHA-256
email: enhanced conversions for leads), `transactionId` = our id, an RFC 3339 `eventTimestamp`, and
`destinationReferences` pointing at one destination per conversion action (operating account = the
conversion account, login account = the manager ID when set). Up to 2,000 events per request. The API is
fast-fail: a 400 naming `events[i]` fails those events permanently and re-sends the rest once; scope,
disabled-API and access errors are retried with a fix hint ("Reconnect Google Ads…").
Failures retry with backoff (15 min, 1 h, 4 h, 16 h) and are marked failed after 5 attempts; permanent
errors fail at once (token, permission and unknown-pixel errors are retried so a fixed setup applies); a
Meta batch rejected permanently is re-sent event by event. Mock mode sends the same requests to an
in-process mock of each API (`mockMetaFetch`, `mockDataManagerFetch`: real response and error formats,
no network) and marks rows sent (`mock = true`); once the platform runs live, those rows (inside the
look-back window) are queued again and really sent.

**Consent-aware uploads.** `src/lib/capi/consent.ts` decides one basis per conversion from
`contacts.ads_consent`, the GPC flag on the contact's visitors and whether the workspace has a strict
pixel (`pixel_sites.consent_mode` `required` or `cookieless`): *denied* (skipped, `skip_reason =
consent_denied`) → *none* (strict mode without a yes: skipped, `no_ads_consent`) → *limited* (Global
Privacy Control: Meta `data_processing_options: ["LDU"]` with country/state 0; Google both consent fields
`CONSENT_DENIED` and no user identifiers, so a lead without a click id is skipped as
`limited_no_click_id`) → *granted* (Google `CONSENT_GRANTED`) → *implied* (opt-out mode, nobody objected:
Google `CONSENT_STATUS_UNSPECIFIED`, Meta `data_processing_options: []`). The basis is stored in
`conversion_uploads.consent_mode`; every skip has a machine `skip_reason`. The Meta / Google Ads dialogs
show 7-day counts: sent, limited, pending, failed, skipped (with consent skips called out).

**Pixel consent.** `data-consent` on the script tag (Settings → Tracking writes it into the snippet):
`optout` (default: first-party cookie, `adledger.consent(false)` forgets the visitor), `required` (no
cookie, storage or request until `adledger.consent(true)`; the current page's events wait in memory) and
`cookieless` (a per-page ID; a yes upgrades to a cookie). The visitor cookie lasts 390 days (under 13
months) and is never extended. Every batch carries `consent` and `navigator.globalPrivacyControl`; the
collect endpoint stores them on `visitors` (an explicit answer is never overwritten by "unknown"),
copies explicit answers to `contacts.ads_consent`, records a withdrawal sent as an empty batch, and
drops events without consent for `required` sites even when an old snippet sends them. Settings →
Tracking also has copy-paste glue for Cookiebot, CookieYes, Osano, Klaro and Google Consent Mode v2
(`src/lib/tracking/consent-modes.ts`).

**Imports.** The Spend API (`POST /api/v1/spend`), Conversions API (`POST /api/v1/conversions`) and
CSV uploads share `src/lib/imports.ts`, so any ad network or checkout without a native connector can be
brought in (Zapier, Make, n8n, scripts, spreadsheets).

**Teams & permissions.** Roles are per organization (`src/lib/permissions.ts`): owner (everything),
admin (workspaces, integrations, members), analyst (reports, exports, insights, API keys), viewer
(read-only), client (read-only, only listed workspaces). Every server action calls `guard(permission)`;
owners can't be demoted or removed if they are the last one. Sessions store the current workspace;
switching validates access.

**Privacy & data ownership.** `src/lib/privacy.ts`. *Erasure* (Contact page → Delete contact, or
`DELETE /api/v1/contacts/{id}`): deletes the contact row and its leads, unlinks its visitors, clears
the properties of their raw events and any (hashed or URL-encoded) emails from their event and touchpoint URLs, keeps the
revenue rows with `contact_id = null` so totals don't change, and moves that revenue's attribution
credits to “unattributed” in place (same result as a full recompute, without its cost). *Subject access*: `GET /api/v1/contacts/{id}/export` (JSON). *Exports*:
`GET /api/v1/exports/contacts` (CSV of the Contacts filter, `reports.export` or API key) and
`GET /api/v1/exports/workspace` (every workspace table as one streamed JSON document, credentials
omitted; session with `workspace.data` only). *Retention*: optional “delete raw events older than N days”
(7–3650), enforced by the daily `data-retention` job; touchpoints, contacts and revenue are kept, so
attribution is unaffected. Erasures, exports and retention changes are audit-logged (ids only, never emails).

**Overview widget board.** The Overview (`src/app/(app)/page.tsx`) is a board of widgets: a briefing
sentence, a pinned strip of up to 6 KPI tiles and named sections on a 12 / 6 / 1-column grid with fixed
sizes (s 3/12, m 6/12, l 8/12, xl 12/12) and fixed heights (KPI 124px, card 380px), so nothing jumps
between loading, empty, error and data.
- *Registries.* `src/lib/metrics.ts` (label, definition, format, polarity: spend neutral, CAC/CPL
  down-is-good, |Δ| < 2% reads "flat") and `src/lib/widgets/catalog.ts` (client-safe metadata: title,
  category, description, allowed sizes, default size) + `src/lib/widgets/registry.tsx` (server: the async
  component and same-size skeleton per type).
- *Numbers.* `src/lib/reports-metrics.ts`: `kpiSeries` returns every KPI per day plus the period total
  in one query (`group by rollup`), so tiles, sparklines and the Metric explorer share one result and
  agree with `overview()` (tested on the demo data); plus wasted spend with campaign maturity ("too early"
  when a campaign is younger than the median days to convert), the platform scorecard and recent
  leads and payments (emails masked on the server, never sent to the browser raw). The briefing sentence
  is a template (`src/lib/dashboard/briefing.ts`), never the LLM. The Spend vs revenue week/month toggle
  groups the daily SQL rows in the browser (integer addition only).
- *Rendering.* Each widget is an async server component in its own error boundary and `<Suspense>`;
  shared inputs are `React.cache` loaders (`src/lib/dashboard/data.ts`) and the KPI queries are started
  before anything else renders. Recharts and `@dnd-kit` load in their own chunks (`@dnd-kit` only in
  edit mode, on desktop).
- *Layouts.* `src/lib/dashboard/layout.ts` validates every read and save with zod: bad items are dropped,
  bad settings unset, disallowed sizes snap back, and unknown widget types are kept and render "Widget
  unavailable" (a downgrade never destroys a board). Presets: Minimal (fresh workspaces), E-commerce (the
  demo), Lead gen, Agency. A member sees their personal view, else the workspace default, else the preset.
- *Editing.* "Customize", the `E` key or `/?edit=1`: drag with pointer or keyboard, size menu, remove,
  sections add/rename/reorder/delete, reset to a preset or the workspace default, save. Phones get an
  ↑ / ↓ reorder list. KPI tiles pin/unpin outside edit mode (optimistic, Undo toast). Server actions in
  `src/app/actions/dashboard.ts` use `guard("dashboard.edit")` (every role, for personal views; the
  workspace default also needs `workspace.settings`) and `audit()`; saves carry the row version and a
  stale save is rejected instead of overwriting a teammate's change.

**PDF reports.** `@react-pdf/renderer` renders on the server (pure JS, no Chromium, listed in
`serverExternalPackages`); charts are drawn with react-pdf `<Svg>` primitives by the in-house kit in
`src/lib/pdf/charts/` (nice-tick scales, line, bars, combo, donut, funnel, heatmap, waterfall, bullet,
slope, sparkline). Report kinds live in the `src/lib/report-kinds/` registry: each declares its meta,
a `load(db, ws, params)` that calls only `reports*.ts`, and a react-pdf body. `generateReportPdf`
loads the data, fingerprints it (SHA-256 over kind, params, data, export id, exporter and time),
renders the shared frame (masthead with the org logo from `organizations.logo_png`, cover,
methodology appendix, "Prepared for …" watermark and "n / total" on every page) and writes one
`export_log` row (ids only). `GET /api/v1/reports/{kind}/pdf` (session `reports.pdf` or API key)
runs behind an in-process limiter (2 renders at once, 2 queued, then 429). `/verify` looks a
fingerprint up and shows only kind, workspace, period and issue date. `report_schedules` are run by
the hourly `report-schedules` job (`BUILTIN_JOBS` in `jobs.ts`) and emailed with the PDF attached.
Fonts ship in `src/lib/pdf/fonts/` (OFL). `src/app/print.css` makes Ctrl+P print light, without
navigation. Details: [REPORTS.md](REPORTS.md).

**Notifications.** `src/lib/notify` delivers events (weekly report, KPI digest, wasted spend, sync
failed, new customer, large payment) to the channels selected in `notification_rules`. Scheduled
events run hourly and respect the workspace timezone; delivery failures are logged, never thrown.
The KPI digest (`daily_digest` event) has a per-channel cadence stored in the rule's settings
(`cadence`: daily = yesterday, weekly = the 7 days to Sunday sent on Mondays, monthly = last month
sent on the 1st; `digestPeriod()` in `notify/index.ts`).

**Alerts.** `src/lib/alerts.ts` (client-safe constants in `alerts-meta.ts`). A threshold rule reads one
metric for the last N complete days (workspace timezone, linear model) through `reports.ts`
(`overview()` for the workspace or a platform, `performance()` for a campaign; platform/campaign
revenue and leads are the ones credited to ads). It notifies once per breach: state goes `ok → breached`
when it fires and back to `ok` (with a "resolved" event) when the metric recovers, and it never fires
again within `cooldown_hours` of the last notification. A metric that can't be measured (CAC with no
customers) never fires. The built-in anomaly rule (one per workspace, off by default) z-scores
yesterday's revenue, spend and leads against the previous 28 days (needs 14 active days and some
variation) and logs each metric at most once per day. Rules run hourly as the `alerts` job, which
`jobs.ts` appends to the scheduler (`BUILTIN_JOBS`); `requestAlertCheck(workspaceId)` re-checks one
workspace soon after new data. Settings → Alerts (`/settings/workspace/alerts`, `alerts.manage`) has
the rule builder with a live "right now" preview, the anomaly toggle and the history.

**Share links.** `src/lib/share.ts`. A link is a 256-bit random token shown once; only its SHA-256 is
stored. Its filters (rolling range or fixed dates, model, optional platform) are locked at creation:
`/share/[token]` computes everything from the stored filters and ignores every URL parameter.
`loadSharedReport()` returns an explicit allow-list of aggregates (KPIs vs the previous period, spend
vs revenue from ads by day, top 10 campaigns, platforms), never ids, contacts or emails; with a platform
locked, revenue, leads and customers are only those credited to that platform and the platform table
is dropped. Unknown, expired and revoked tokens all 404 the same way. The page is `noindex`,
rate-limited per IP (60/min), counts views and writes `share_link.view` to the audit log with a
truncated IP. Settings → Sharing (`/settings/workspace/sharing`, `reports.share`) creates and revokes.

**Insights v2.** `/insights` has three tabs in the URL (`?tab=`): Reports (action cards from
`reports-insights.ts` above the weekly report), Ask and Alerts (history + what's being watched).
Action cards are read-only rules over `performance()`/`overview()` rows (move budget from the biggest
ROAS < 0.5× campaign to the best ≥ 1.5×, a strong campaign with a small share of spend, the biggest
revenue drop, CAC up ≥ 20%, ≥ 40% of revenue unattributed); every figure is a chip that links to the
row it came from (`/performance?level=ad_group&parent=<campaign>` or the Overview with the same period).
**Ask** (`src/lib/ai/ask.ts`, `insights.ask`) answers with read-only tools that run the same
`reports.ts` functions as the dashboard, REST API and MCP server (`get_overview`, `get_performance`,
`get_platform_breakdown`, `compare_periods`, `find_wasted_spend`, `get_timeseries`,
`search_campaigns`; nothing person-level). The model sees pre-formatted values (`ai/ask-format.ts`, the
same formatter the UI uses), writes one to three sentences, and any number it writes that no tool
returned is flagged; answers render the tool tables with a link to the matching dashboard view.
Without a model (or when it fails, or a local model skips the tools) a rule-based router
(`planQuestion`) picks one tool and describes the result from the table's own values. History is
per user (last 200 kept). The command palette's "?" questions arrive through `sessionStorage`.

**Command palette & shortcuts.** `src/lib/hotkeys.ts` is the single shortcut registry (no dependency):
key strings like `"g o"` (G then O within 1 s), `"mod+k"` (⌘K / Ctrl K) or `"?"`, matched on `event.key`,
ignored while typing in a field, a menu or a dialog. Components register with `useHotkeys()` for as long as
they're mounted (page-scoped shortcuts come and go with the page), and the `?` sheet
(`components/shortcuts-sheet.tsx`) renders whatever is registered. `components/command-palette.tsx` is an
always-mounted shell in the app layout: it owns ⌘K, `/` (focuses the element marked `data-hotkey-search`),
the G-then-letter navigation and the `adledger:open-palette` window event; the dialog
(`command-palette-dialog.tsx`, Base UI Autocomplete inside a Base UI Dialog) is a separate chunk fetched when
the browser is idle. Pages, tabs and settings sections come from `command-palette-data.ts`; records come from
`POST /api/v1/search` (`src/lib/search.ts`: workspace-scoped, query in the body so emails never reach logs,
case-insensitive substring on `lower(name)` with a small `LIMIT` per kind, exact emails through the
`(workspace_id, email_hash)` index, masked emails for clients). "Recent" lives in the browser
(`localStorage`, per workspace, bare emails masked). `?question` hands off to Insights → Ask through
`sessionStorage` (`adledger:ask-draft`), not the URL.

**Live.** `/live` shows visitors in the last 5 minutes, today so far vs the same time yesterday (local day
in the workspace timezone; spend, reported per day by the platforms, compares against yesterday's total ×
the share of the day passed), today vs yesterday by hour, a feed of ad clicks, visits (session starts),
leads, payments and refunds, and the top pages and sources of the last 30 minutes. Every number is SQL in
`src/lib/reports-live.ts`. Transport is Server-Sent Events from the same Node process:
`GET /api/v1/live` (dashboard session, any role with `reports.view`) subscribes to a per-workspace hub in
`src/lib/live.ts` that polls the database every 2 s while anyone is watching (indexed, `created_at`-cursor
queries with a 10 s look-back for late commits, de-duplicated by key; counters refresh every 10 s, sooner
after new activity), so it works unchanged with several app instances and needs no pub/sub service.
`nudgeLive(workspaceId)` asks for an immediate poll from ingest paths. Streams send a heartbeat every 15 s,
resume from `Last-Event-ID` / `?after=<cursor>`, re-check the session every minute, are recycled every
15 minutes, and cap at 50 per workspace; the browser closes its stream 20 s after the tab is hidden and
resumes on return. Payloads never carry an email, phone or full name: people are initials (`P. S.`) or a
masked email (`p•••@gmail.com`, company domains fully masked), paths lose their query string, and free
text is scrubbed of emails and long digit runs. `GET /api/v1/live/pulse` (session or API key) returns
today's revenue and visitors now for the sidebar pulse, polled every 30 s by one shared client poller.
Streamer mode (hide every amount) and sale toasts are per-browser preferences in `localStorage`. In a
sample-data workspace, `src/lib/live-demo.ts` writes a gentle trickle of simulated visits, leads and sales
(copied from the demo's own campaigns, `@example.com` people) while Live is open, so the page moves and
still reads only SQL; it never runs for a real workspace.

## 6. Configuration

All optional; see `.env.example`. Connector credentials and the AI model are configured in the
dashboard and stored encrypted with `APP_SECRET` (auto-generated and stored in the database if
not provided). Headless installs can set `ADMIN_EMAIL`/`ADMIN_PASSWORD` (+ `DEMO_DATA=true`).

## 7. Security & privacy

- Pixel keys are public and can only write events; everything else needs a session or API key.
  API keys are workspace-scoped; REST/MCP calls with a dashboard session are checked against the
  member's role (writes need `workspace.settings`) and must be same-origin.
- Rate limits on `/collect`, webhooks, login, invitations and the REST/MCP API (in-memory token
  buckets), plus per-account password lockouts; request bodies are size-capped before parsing.
- Outbound URLs typed into the dashboard go through `src/lib/net.ts` (no private, loopback,
  link-local or metadata targets unless `ALLOW_PRIVATE_URLS=true`; LLM base URLs may use
  `localhost` / `host.docker.internal`). See [SECURITY.md](../SECURITY.md).
- IPs truncated; emails/phones hashed everywhere except `contacts`; PII redacted from stored
  form payloads and event properties.
- Right to erasure, subject-access export, full data export and raw-event retention (see “Privacy &
  data ownership” above).
- Sessions: random 256-bit tokens, stored hashed, httpOnly + SameSite=Lax cookies (Secure behind HTTPS),
  re-issued on every sign-in; a password change revokes all sessions.
- Passwords: scrypt (N=2^15). Credentials: AES-256-GCM.
- Security headers (CSP, frame/sniff/referrer/permissions policies, HSTS over HTTPS) on dashboard
  routes; CORS open only on the pixel endpoint.
- Share links (`/share/[token]`): hashed 256-bit tokens, aggregates only, filters locked server-side,
  expiring and revocable, `noindex`, rate-limited, every view audited with a truncated IP.

### 7.1 Trust core (`src/lib/security/`)

The honest, user-facing version is [docs/SECURITY.md](SECURITY.md). Implementation map:

- **Permissions.** `contacts.pii` (owner/admin/analyst) gates unmasked emails; `export.csv`,
  `export.contacts` (owner/admin) and `reports.pdf` split exports; `security.manage` (owner) gates
  the org policy. `policyCan()` in `security/policy.ts` narrows the role matrix by the org's
  `organizations.security` jsonb (zod-parsed with defaults: `require2fa`, `sessionIdleMinutes`,
  `sessionMaxDays`, `clientsCanDownloadPdf`). `SessionUser.can` uses it.
- **Masking.** Pages always render `maskEmail()` output; `revealContactEmailsAction` returns raw
  emails to `contacts.pii` holders and audits `contact.pii_revealed` (ids and count only). API
  responses use `security/pii.ts` (`canSeePii(principal)`): contacts list, journey, search and the
  contacts CSV. Without PII access, contact search matches names and whole emails only.
- **API key scopes.** `api_keys.scopes text[]` (`reports:read` default, `mcp`, `contacts:read`,
  `contacts:pii`, `ingest:write`), `expires_at`, `last_used_ip_trunc`. `withAuth({ scope })` and
  `authorize(req, permission, { scope })` enforce them; `Caller.can()` maps role permissions to
  scopes for follow-up decisions. The migration gives pre-existing keys every scope but
  `contacts:pii`.
- **2FA.** `security/totp.ts` (RFC 4226/6238 on `node:crypto`, base32, ±1 step, replay guard via
  `users.totp_last_step`), `recovery.ts` (10 scrypt-hashed single-use codes), `two-factor.ts`
  (enrol/confirm/disable; secret AES-GCM encrypted in `users.totp_secret_enc`), `mfa.ts` (signed
  10-minute `al_mfa` challenge cookie between password and code), `qr.ts` (`uqr` → SVG path).
  `login()` returns `{ mfa: true }` and `/login/verify` completes it. With `require2fa`, members
  without 2FA get `needs2fa`: `requireUser` redirects to `/two-factor/setup`, `guard()` refuses,
  and API calls with that session are unauthenticated. `ADLEDGER_BREAK_GLASS=<owner email>` resets
  an owner's 2FA at boot (`break-glass.ts`, called from `boot.ts`).
- **Sessions.** `sessions.ip_trunc`, `user_agent`, `last_seen_at` (stamped at most every 5 min),
  `auth_method`. `sessionExpired()` applies the org's idle timeout and max lifetime on every
  request. A sign-in from an unseen `deviceKey` audits `auth.new_device` (security alert) and emails
  the member (`new-device.ts`).
- **Passwords.** `password-policy.ts` (NIST SP 800-63B-4) with `common-passwords.txt`, traced into
  the standalone build by `outputFileTracingIncludes` in `next.config.ts`.
- **Audit log v2.** `audit()` → `appendAudit()` (`audit-chain.ts`): per-org `seq` + `prev_hash` +
  `hash` = sha256(prev + canonical JSON), serialized with `pg_advisory_xact_lock`; rows written
  before the chain existed are sealed on the next append or verify. `verifyAuditChain()` reports
  the first broken `seq`. Filters and CSV (`/api/v1/exports/audit`, `audit.view` + `export.csv`)
  share `audit-query.ts`.
- **Alerts.** Actions in `ALERTING_ACTIONS` (auth.ts) raise the `security_alert` notify event via
  `alerts.ts` (names and counts only; contact exports alert above 1,000 rows).
- **Posture.** `posture.ts` builds the checklist on Settings → Organization → Security policy
  (key storage, HTTPS, 2FA coverage, idle sessions, audit verify, PII keys, backups).
- **Disclosure.** `/.well-known/security.txt` (RFC 9116, `security-txt.ts`; `SECURITY_CONTACT`
  adds the operator's contact). CI: dependency review + `pnpm audit` on PRs, CodeQL, Trivy on the
  image; Dependabot; SBOM + provenance on release images.

## 8. Testing

`pnpm test` runs vitest against an in-memory embedded Postgres with `CONNECTOR_MODE=mock`:
money math (property tests), UTM/channel rules, trait extraction and PII redaction, the full
pixel → lead → Stripe → sync → attribution → reports pipeline, idempotency, signature checks,
timezone-correct filters, route handlers, schema conventions, AI number checks, MCP read-only
guarantees, and the seeded demo story. CI also runs the suite against a real PostgreSQL 16 and
smoke-tests the Docker image with `docker compose up`.

`pnpm e2e` (Playwright, against a production build) runs the user journey in `e2e/smoke.spec.ts`,
then `e2e/a11y.spec.ts`: every main page at 375px and 1440px in light and dark mode must have no
serious/critical axe-core violations (WCAG 2.1 AA + best practices) and no sideways scroll on a phone.
UI conventions that keep it green: grids start from `grid-cols-1` (implicit columns grow to fit
nowrap content), wide tables become card lists below `sm`, icon-only controls and select triggers
get an `aria-label`, and phones/touch screens get >= 36px tap targets (see `globals.css`).

## 9. UI system ("Quiet Ledger")

The look is specified in `docs/redesign/BRIEF.md` §2 and lives in one place:

- **Tokens** — `src/app/globals.css`. Raw OKLCH tokens per theme (`--bg`, `--bg-subtle`, `--surface`,
  `--fill*`, `--border*`, `--fg`, `--fg-muted`, `--fg-faint`, `--ink`, `--brand*`, `--positive`,
  `--negative`, `--warning`, `--chart-revenue|spend|leads|customers`) are mapped onto the shadcn
  names (`--background`, `--card`, `--primary` = ink…), so primitives pick them up unchanged. The
  brief's emerald accent is `--brand` (`text-brand`, `bg-brand-soft`) because shadcn's `--accent` is
  the hover fill. Green is for money only; primary buttons are ink.
- **Scale** — type utilities `text-micro|caption|ui|body|title-sm|title|kpi|kpi-lg|mono` (body text
  is 13px `text-ui`), radius 4/6/8/12 (`rounded-sm|md|lg|xl`), elevation `shadow-sm|md|lg` (cards
  use `--elev-card`: a hairline, no drop in dark mode), motion `--ease-out`, `--ease-drawer`,
  `--dur-*`, plus `.num`, `.kbd`, `.surface-card`, `.live-dot`, `.pending-line`, `.reveal-delayed`.
  `src/lib/utils.ts` teaches `cn` the custom font sizes so `text-ui` never removes a text colour.
- **Shell** — `(app)/layout.tsx` renders the sidebar (`components/app-sidebar.tsx`: workspace
  switcher, search, Overview/Live, Analyze, CRM, setup ring, settings, help, account; `[` or Ctrl/⌘ B
  toggles the icon rail, remembered in the `sidebar_state` cookie) and the phone tab bar
  (`mobile-nav.tsx`). `components/app-shell.tsx` holds the shell context (demo pill), the 2px
  pending line and the window events `adledger:open-palette` / `adledger:open-shortcuts` that the
  search and help buttons dispatch.
- **Page header + filters** — `page-header.tsx` (52px, title, demo pill, controls) and
  `report-controls.tsx`: date presets, compare and model in the URL (`range`, `from`/`to`,
  `compare=prev|year|none`, `model`, `platform`), resolved server-side by `lib/period.ts`
  (`resolvePeriodParams` returns `comparison`; `comparisonParams()` gives report params for it).
  Preset maths is pure and shared with the client in `lib/period-presets.ts`.

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
- **2026-09-27 — profile pictures and logos in the database.** `users.avatar` and `organizations.logo`
  are `bytea` columns (+ content type and updated-at) instead of files on disk, so there is no volume
  or object store to configure and backups stay one `pg_dump`. The browser crops/resizes to a 256px
  square (WebP, PNG fallback) before upload; the server accepts only PNG/JPEG/WebP (magic bytes checked,
  never SVG) up to 300 KB. Images are served session-only from `/api/media/{user|org}/{id}?v=<updated-at>`
  (members of the same organization; `nosniff`, private long-lived cache). Admins and owners
  (`org.branding`) manage the logo; everyone manages their own picture.
- **2026-09-27 — retention setting stored in `connections`.** The raw-event retention policy is a
  `connections` row with provider `retention` (`config.eventsDays`, `enabled`, `last_synced_at` = last run)
  instead of a new column: connections is already the per-workspace, unique-per-provider settings store,
  so no migration is needed. `workspaces.onboarding` is reserved for onboarding progress. Clearing
  workspace data keeps it (like the `llm` connection).
- **2026-09-27 — palette search without a trigram index.** `pg_trgm` would make substring search on
  names index-backed, but PGlite doesn't load it by default and `CREATE EXTENSION` can need privileges a
  managed Postgres won't grant, which would break "migrations apply at startup". Searches filter on
  `workspace_id` first and stop at 5 rows per kind, which stays fast into the hundreds of thousands of
  contacts; revisit with an optional trigram index if a workspace outgrows that.
- **LTV attribution for repeat payments.** Renewals credit the acquiring journey instead of
  becoming “unattributed” once the window has passed.
- **2026-09-27 — Overview as a widget board on CSS grid spans.** Layouts are fixed size presets on a
  12-column grid (not free pixel positions, not `react-grid-layout`): they can't turn ugly, need no
  positioning maths and work with server components, so every widget still streams from the server.
  Drag and drop uses `@dnd-kit/core` + `@dnd-kit/sortable` (keyboard and touch accessible), loaded only
  in edit mode. Layouts live in one `dashboards` table (workspace default + personal overrides) with an
  optimistic-concurrency `version`.
