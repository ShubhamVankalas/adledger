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
| Background jobs | `src/lib/jobs.ts`: ad sync every `SYNC_INTERVAL_HOURS` (6), weekly insights check hourly, conversion uploads hourly, debounced attribution recompute after webhooks/leads/syncs. Scheduled jobs take a Postgres advisory lock, so running several replicas is safe. |
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

**Goals & hygiene** — `goals` (one per `(workspace_id, metric)`: metric revenue | attributed_revenue |
leads | customers | roas | mer | cac | cpl, period month | quarter, `target_minor` for money or
`target_value` numeric for counts/ratios, optional `budget_minor`, the currency it was set in),
`contact_duplicate_dismissals` (pairs marked "not the same person", `contact_a_id < contact_b_id`).

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

**Goals & pacing.** `src/lib/reports-goals.ts` paces each goal for the current month or quarter in the
workspace timezone. Actuals are `overview()` for period-to-date (so a goal always equals its KPI tile);
cumulative metrics project at the current run rate, ratios and costs are judged on the value to date, and
nothing is judged before day 3. The ad budget is paced the same way. Pure maths and metric definitions
live in `src/lib/goal-metrics.ts` (client-safe): `stoplight(metric, value, target)` and
`targetFor(targets, metric)` colour table cells, `<GoalsPacingWidget/>` (`components/goals/`) renders the
card. Settings → Workspace → Targets & goals (`guard("workspace.settings")` + `audit()`).

**Contacts import.** `src/lib/contacts-import.ts`: the CSV is parsed by `parseCsvTable()` (imports.ts),
columns are auto-mapped from their headers and re-mapped in the browser, and every mapping change
re-previews "new / update / invalid / repeated" against the workspace's email and phone hashes before
anything is written. The import upserts on `(workspace_id, email_hash)` (phone hash for phone-only rows),
only fills blanks on existing contacts (name, phone, an earlier date added), folds repeated rows into one
person, and can record a `csv` lead for each new person. Running it twice only updates.

**Duplicates & merge.** `src/lib/contacts-merge.ts` suggests pairs that share a phone hash, the same
canonical email (Gmail dots and `+tags` ignored) or the same multi-word name where one side has no email
(groups larger than a few are ignored as shared or common values), minus dismissed pairs. A merge runs in
one transaction: every column with a foreign key to `contacts(id)` is found in the catalog and re-pointed
(so tables added later are covered; a row that would break a unique key is dropped because the kept
contact already has it), plus `attribution_credits.contact_id`; blank columns on the kept contact are
filled from the merged one, the email moves over only if the kept contact has none, the merged contact
is deleted, and attribution is recomputed. Merging needs `workspace.data`, importing and dismissing
`workspace.settings`; all three write `audit()` with IDs only.

**Notifications.** `src/lib/notify` delivers events (weekly report, daily digest, wasted spend, sync
failed, new customer, large payment) to the channels selected in `notification_rules`. Scheduled
events run hourly and respect the workspace timezone; delivery failures are logged, never thrown.

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
