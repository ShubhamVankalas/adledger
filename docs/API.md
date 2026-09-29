<!-- Generated from public/openapi.json by scripts/api-docs.ts. Do not edit by hand. -->

# AdLedger API reference (v0.1.0)

The machine-readable spec is served by every install at `/api/v1/openapi.json` (OpenAPI 3.1) —
load it into Postman, Insomnia, Scalar or an SDK generator.

REST API of a self-hosted AdLedger install. Reporting endpoints read the same SQL as the dashboard and the MCP server, so numbers always agree.

**Authentication.** Create an API key in Developers → API keys (Settings → API & MCP for roles without the Developers page) and send it as `Authorization: Bearer al_...`. Each key carries scopes: `reports:read` (the default for new keys), `mcp`, `contacts:read` (emails masked), `contacts:pii` (raw emails) and `ingest:write` (push data, trigger syncs, erase contacts). A call without the scope it needs gets 403. A dashboard session cookie also works for same-origin calls and is held to the member's role. Ingestion endpoints called by third parties (pixel, webhooks) are authenticated by their own site key, URL token or signature instead.

**Money** is always an integer in minor units (e.g. cents) plus an ISO 4217 currency code. **Dates** in query strings are `YYYY-MM-DD` in the workspace timezone (end inclusive); timestamps in responses are ISO 8601 UTC.

**Outbound webhooks.** For data out in real time (a new lead, a payment, a stage change), add a webhook endpoint in Developers → Webhooks instead of polling. Events are listed under Webhook events below; docs/WEBHOOKS.md covers signatures and retries.

## Endpoints

| Method | Path | Summary | Auth |
|---|---|---|---|
| GET | [`/api/v1/health`](#get-apiv1health) | Health check | public |
| GET | [`/api/v1/openapi.json`](#get-apiv1openapijson) | This OpenAPI document | public |
| GET | [`/api/v1/reports/{report}`](#get-apiv1reportsreport) | Run a report | API key |
| GET | [`/api/v1/reports/{report}/pdf`](#get-apiv1reportsreportpdf) | Download a PDF report | API key |
| GET | [`/api/v1/contacts`](#get-apiv1contacts) | List contacts | API key |
| GET | [`/api/v1/contacts/{id}/journey`](#get-apiv1contactsidjourney) | Contact journey | API key |
| GET | [`/api/v1/leads`](#get-apiv1leads) | List leads | API key |
| POST | [`/api/v1/search`](#post-apiv1search) | Search the workspace | API key |
| GET | [`/api/v1/live`](#get-apiv1live) | Live activity stream (Server-Sent Events) | session |
| GET | [`/api/v1/live/pulse`](#get-apiv1livepulse) | Today's revenue and visitors now | API key |
| DELETE | [`/api/v1/contacts/{id}`](#delete-apiv1contactsid) | Erase a contact | API key |
| GET | [`/api/v1/contacts/{id}/export`](#get-apiv1contactsidexport) | Export a contact | API key |
| GET | [`/api/v1/exports/audit`](#get-apiv1exportsaudit) | Export the audit log | session |
| GET | [`/api/v1/exports/contacts`](#get-apiv1exportscontacts) | Export contacts as CSV | API key |
| GET | [`/api/v1/exports/workspace`](#get-apiv1exportsworkspace) | Export the whole workspace | session |
| POST | [`/api/v1/sync/{provider}`](#post-apiv1syncprovider) | Sync a connector now | API key |
| POST | [`/api/v1/spend`](#post-apiv1spend) | Push ad spend | API key |
| POST | [`/api/v1/conversions`](#post-apiv1conversions) | Push payments, refunds and leads | API key |
| POST | [`/api/v1/collect`](#post-apiv1collect) | Pixel events | public |
| OPTIONS | [`/api/v1/collect`](#options-apiv1collect) | CORS preflight | public |
| GET | [`/api/v1/import/template`](#get-apiv1importtemplate) | CSV import template | public |
| POST | [`/api/v1/webhooks/leads/{token}`](#post-apiv1webhooksleadstoken) | Form lead webhook | public |
| GET | [`/api/v1/webhooks/leads-native/{provider}/{workspaceId}`](#get-apiv1webhooksleads-nativeproviderworkspaceid) | Native lead form webhook verification | public |
| POST | [`/api/v1/webhooks/leads-native/{provider}/{workspaceId}`](#post-apiv1webhooksleads-nativeproviderworkspaceid) | Native lead form webhook | public |
| GET | [`/api/v1/webhooks/whatsapp/{workspaceId}`](#get-apiv1webhookswhatsappworkspaceid) | WhatsApp webhook verification | public |
| POST | [`/api/v1/webhooks/whatsapp/{workspaceId}`](#post-apiv1webhookswhatsappworkspaceid) | WhatsApp message webhook | public |
| POST | [`/api/v1/webhooks/stripe/{workspaceId}`](#post-apiv1webhooksstripeworkspaceid) | Stripe webhook | public |
| POST | [`/api/v1/webhooks/{provider}/{workspaceId}`](#post-apiv1webhooksproviderworkspaceid) | Revenue platform webhook | public |
| POST | [`/api/v1/webhooks/crm/{provider}/{workspaceId}`](#post-apiv1webhookscrmproviderworkspaceid) | CRM deal webhook | public |
| GET | [`/api/mcp`](#get-apimcp) | MCP event stream (not supported) | API key |
| POST | [`/api/mcp`](#post-apimcp) | MCP endpoint (Streamable HTTP) | API key |
| DELETE | [`/api/mcp`](#delete-apimcp) | End an MCP session (not supported) | API key |
| GET | [`/api/v1/oauth/{provider}/start`](#get-apiv1oauthproviderstart) | Start one-click connect | session |
| GET | [`/api/v1/oauth/{provider}/callback`](#get-apiv1oauthprovidercallback) | One-click connect callback | session |
| GET | [`/api/v1/money/{report}`](#get-apiv1moneyreport) | Run a money-truth report | API key |
| GET | [`/api/v1/receipts/{paymentId}`](#get-apiv1receiptspaymentid) | Get the ad receipt of a payment | API key |
| GET | [`/api/v1/exports/pause-drafts`](#get-apiv1exportspause-drafts) | Export pause drafts as a bulk-edit CSV | API key |

## Reports

Attribution reports (read-only).

### GET /api/v1/reports/{report}

**Run a report.** `overview` → KPI totals · `performance` → rows per campaign / ad group / ad · `timeseries` → one point per day · `channels` → credit per channel · `wasted-spend` → rows with meaningful spend and ROAS < 0.5 · `compare` → this period vs the previous period of equal length. · `model-comparison` → the three attribution models side by side (`model` is ignored) · `ltv` → customer lifetime value by first-payment cohort and LTV:CAC per acquiring platform. API keys need `reports:read`.

Auth: `Authorization: Bearer al_...` (or a dashboard session).

| Parameter | In | Type | Required | Description |
|---|---|---|---|---|
| `report` | path | `overview`, `performance`, `timeseries`, `channels`, `wasted-spend`, `compare`, `model-comparison`, `ltv` | yes | Which report. |
| `start` | query | [Date](#date) | yes | First day, YYYY-MM-DD (workspace timezone). |
| `end` | query | [Date](#date) | yes | Last day, inclusive, YYYY-MM-DD. |
| `model` | query | [AttributionModel](#attributionmodel) | no | Attribution model. (default `"last_touch"`) |
| `platform` | query | [Platform](#platform) | no | Limit to one ad platform (overview, performance, timeseries, wasted-spend). |
| `level` | query | `campaign`, `ad_group`, `ad` | no | Row level for `performance` and `wasted-spend`. (default `"campaign"`) |
| `parentId` | query | string (uuid) | no | `performance` only: rows under this campaign (level=ad_group) or ad group (level=ad). |

| Status | Response |
|---|---|
| 200 | Report with the period, model, currency and timezone it was computed for. — `application/json`: [ReportResponse](#reportresponse) |
| 400 | A query parameter failed validation. — `application/json`: [ValidationError](#validationerror) |
| 401 | Missing or invalid API key. — `application/json`: [Error](#error) |
| 404 | Not found. — `application/json`: [Error](#error) |

### GET /api/v1/reports/{report}/pdf

**Download a PDF report.** Branded PDF of one report kind: `executive-summary` (1 page), `weekly-performance`, `attribution-models` (all models side by side; `model` is ignored), `ltv-cohorts` (landscape) or `wasted-spend`. Every number comes from the same SQL as the JSON reports. Each download is written to the export log and carries a fingerprint that `/verify` confirms. Dashboard sessions need the `reports.pdf` permission. At most two PDFs render at once (plus a short queue); beyond that the answer is 429.

Auth: `Authorization: Bearer al_...` (or a dashboard session).

| Parameter | In | Type | Required | Description |
|---|---|---|---|---|
| `report` | path | `executive-summary`, `weekly-performance`, `attribution-models`, `ltv-cohorts`, `wasted-spend` | yes | Which report. |
| `start` | query | [Date](#date) | no | First day, YYYY-MM-DD (workspace timezone). Omit start and end for the report's default range ending on the latest day with data. |
| `end` | query | [Date](#date) | no | Last day, inclusive, YYYY-MM-DD. At most two years after start. |
| `model` | query | [AttributionModel](#attributionmodel) | no | Attribution model. (default `"linear"`) |
| `compare` | query | `previous`, `none` | no | Compare with the previous period of equal length (executive summary and weekly performance). (default `"previous"`) |

| Status | Response |
|---|---|
| 200 | The PDF (`Cache-Control: private, no-store`). `X-Export-Id` and `X-Report-Fingerprint` identify this export. — `application/pdf`: string (binary) |
| 400 | A query parameter failed validation. — `application/json`: [ValidationError](#validationerror) |
| 401 | Missing or invalid API key. — `application/json`: [Error](#error) |
| 403 | The session role lacks the permission, or the request is cross-site. — `application/json`: [Error](#error) |
| 404 | Not found. — `application/json`: [Error](#error) |
| 429 | Too many requests; retry later. — `application/json`: [Error](#error) |

### GET /api/v1/money/{report}

**Run a money-truth report.** `truth-gap` → per platform and campaign: conversions and purchase value the platform reports next to verified conversions, verified revenue (payments from buyers who clicked) and credited revenue under `model` · `profit` → the P&L (gross sales, refunds, cost of goods, fees, shipping, contribution, ad spend, profit after ads, MER, POAS, break-even ROAS) plus profit and customer quality per `level` · `time-to-money` → payback lag (median / p80 days from first click to first payment) per campaign as of `end`, the "too early to judge" flag and the pause drafts for the period · `acquisition` → ad spend split into customer acquisition costs and an unallocated line (contact ids only, top 500).

Auth: `Authorization: Bearer al_...` (or a dashboard session).

| Parameter | In | Type | Required | Description |
|---|---|---|---|---|
| `report` | path | `truth-gap`, `profit`, `time-to-money`, `acquisition` | yes | Which report. |
| `start` | query | [Date](#date) | yes | First day, YYYY-MM-DD (workspace timezone). |
| `end` | query | [Date](#date) | yes | Last day, inclusive, YYYY-MM-DD. |
| `model` | query | [AttributionModel](#attributionmodel) | no | Attribution model. (default `"linear"`) |
| `platform` | query | [Platform](#platform) | no | Limit to one ad platform. |
| `level` | query | `platform`, `campaign`, `ad` | no | `profit` only: rows per platform, campaign or ad. (default `"campaign"`) |
| `cost` | query | `share`, `clicks` | no | How a customer's acquisition cost is counted: `share` shares each ad's monthly spend between the customers it brought (by credit); `clicks` counts only their own clicks at that day's cost per click. Either way customer costs + unallocated = spend. (default `"share"`) |

| Status | Response |
|---|---|
| 200 | Report data with the period, model, currency and timezone. Money in integer minor units. — `application/json`: object |
| 400 | A query parameter failed validation. — `application/json`: [ValidationError](#validationerror) |
| 401 | Missing or invalid API key. — `application/json`: [Error](#error) |
| 404 | Not found. — `application/json`: [Error](#error) |

### GET /api/v1/receipts/{paymentId}

**Get the ad receipt of a payment.** Which ads earned one payment or refund (credit shares whose amounts add up to the payment exactly), what the customer cost in ad spend, their payback date, lifetime revenue and (with unit economics set) profit. The contact's email is masked.

Auth: `Authorization: Bearer al_...` (or a dashboard session).

| Parameter | In | Type | Required | Description |
|---|---|---|---|---|
| `paymentId` | path | string (uuid) | yes | Revenue event id. |
| `model` | query | [AttributionModel](#attributionmodel) | no | Attribution model. (default `"linear"`) |
| `cost` | query | `share`, `clicks` | no | How a customer's acquisition cost is counted: `share` shares each ad's monthly spend between the customers it brought (by credit); `clicks` counts only their own clicks at that day's cost per click. Either way customer costs + unallocated = spend. (default `"share"`) |

| Status | Response |
|---|---|
| 200 | The receipt. — `application/json`: object |
| 400 | A query parameter failed validation. — `application/json`: [ValidationError](#validationerror) |
| 401 | Missing or invalid API key. — `application/json`: [Error](#error) |
| 404 | Not found. — `application/json`: [Error](#error) |

### GET /api/v1/exports/pause-drafts

**Export pause drafts as a bulk-edit CSV.** Campaigns with meaningful spend that returned under 0.5x (POAS once unit economics are set, else ROAS) and are old enough to judge, as a file to import in Meta Ads Manager (matches on Campaign ID) or Google Ads Editor (matches on campaign name). AdLedger never calls a platform's write API. API key, or a dashboard session with `reports.export`. Audited.

Auth: `Authorization: Bearer al_...` (or a dashboard session).

| Parameter | In | Type | Required | Description |
|---|---|---|---|---|
| `platform` | query | `meta`, `google` | yes | Which bulk-edit format. |
| `start` | query | [Date](#date) | yes | First day, YYYY-MM-DD (workspace timezone). |
| `end` | query | [Date](#date) | yes | Last day, inclusive, YYYY-MM-DD. |
| `model` | query | [AttributionModel](#attributionmodel) | no | Attribution model. (default `"linear"`) |

| Status | Response |
|---|---|
| 200 | CSV file. — `text/csv`: string |
| 400 | A query parameter failed validation. — `application/json`: [ValidationError](#validationerror) |
| 401 | Missing or invalid API key. — `application/json`: [Error](#error) |
| 403 | The session role lacks the permission, or the request is cross-site. — `application/json`: [Error](#error) |
| 429 | Too many requests; retry later. — `application/json`: [Error](#error) |

## Contacts

Leads, customers and their journeys (read-only).

### GET /api/v1/contacts

**List contacts.** Leads and customers, newest first. API keys need `contacts:read`. Emails are masked (`p•••@gmail.com`, `emailsMasked: true`) unless the key has `contacts:pii` or the member's role may see contact PII (owner, admin, analyst). Without that, `search` matches names and complete email addresses only.

Auth: `Authorization: Bearer al_...` (or a dashboard session).

| Parameter | In | Type | Required | Description |
|---|---|---|---|---|
| `search` | query | string | no | Case-insensitive match on email or name. |
| `lifecycle` | query | `lead`, `customer` | no | Only leads or only customers. |
| `limit` | query | integer | no | Page size. (default `50`, min 1, max 200) |
| `offset` | query | integer | no | Rows to skip. (default `0`, min 0) |

| Status | Response |
|---|---|
| 200 | A page of contacts. — `application/json`: object |
| 400 | A query parameter failed validation. — `application/json`: [ValidationError](#validationerror) |
| 401 | Missing or invalid API key. — `application/json`: [Error](#error) |

### GET /api/v1/contacts/{id}/journey

**Contact journey.** Ordered touchpoints, leads and payments for one contact plus the revenue credit each attribution model gives. API keys need `contacts:read`; the email is masked unless the caller may see contact PII.

Auth: `Authorization: Bearer al_...` (or a dashboard session).

| Parameter | In | Type | Required | Description |
|---|---|---|---|---|
| `id` | path | string (uuid) | yes | Contact id. |

| Status | Response |
|---|---|
| 200 | The journey. — `application/json`: [Journey](#journey) |
| 401 | Missing or invalid API key. — `application/json`: [Error](#error) |
| 404 | Not found. — `application/json`: [Error](#error) |

### GET /api/v1/leads

**List leads.** Every lead (form fill, lead ad, WhatsApp chat, API or CSV lead), newest first, with cursor pagination: pass `next_cursor` back as `cursor` until it is `null`. API keys need `contacts:read`. Emails are masked unless the key has `contacts:pii` or the member's role may see contact PII. For real-time delivery use the `lead.created` webhook instead of polling.

Auth: `Authorization: Bearer al_...` (or a dashboard session).

| Parameter | In | Type | Required | Description |
|---|---|---|---|---|
| `since` | query | string (date-time) | no | Only leads at or after this time (ISO 8601 with offset). |
| `until` | query | string (date-time) | no | Only leads before this time (ISO 8601 with offset). |
| `source` | query | `pixel`, `webhook`, `api`, `csv` | no | Only leads from one source. |
| `limit` | query | integer | no | Page size. (default `50`, min 1, max 200) |
| `cursor` | query | string | no | `next_cursor` from the previous page. |

| Status | Response |
|---|---|
| 200 | A page of leads. — `application/json`: object |
| 400 | A query parameter failed validation. — `application/json`: [ValidationError](#validationerror) |
| 401 | Missing or invalid API key. — `application/json`: [Error](#error) |
| 403 | The session role lacks the permission, or the request is cross-site. — `application/json`: [Error](#error) |

## Search

Find contacts, campaigns, ad sets and ads by name (powers the dashboard's ⌘K palette).

### POST /api/v1/search

**Search the workspace.** Contacts by name or email, and campaigns, ad sets and ads by name (case-insensitive substring; exact and prefix matches first). The query goes in the body, never the URL, so emails stay out of access logs, and it is never logged. Results come grouped by kind (contacts, campaigns, ad sets, ads) with up to `limit` of each. Dashboard sessions work for every role; agency clients get masked contact emails. Rate limit: 240 requests per minute per caller.

Auth: `Authorization: Bearer al_...` (or a dashboard session).

Request body: `application/json`: object

| Status | Response |
|---|---|
| 200 | Matches: contacts, then campaigns, ad sets and ads. — `application/json`: object |
| 400 | Malformed request. — `application/json`: [Error](#error) |
| 401 | Missing or invalid API key. — `application/json`: [Error](#error) |
| 403 | The session role lacks the permission, or the request is cross-site. — `application/json`: [Error](#error) |
| 413 | Too many rows in one request. — `application/json`: [Error](#error) |
| 429 | Too many requests; retry later. — `application/json`: [Error](#error) |

## Live

Real-time activity for the dashboard's Live view: counters, a feed of visits, leads and payments, and the sidebar pulse.

### GET /api/v1/live

**Live activity stream (Server-Sent Events).** A `text/event-stream` for the dashboard's Live view. Dashboard session only (any role that can view reports); API keys get 403. Events: `feed` (`{ items: LiveFeedItem[], reset?: true }`, with the resume cursor as the event `id`), `snapshot` (the live counters: visitors in the last 5 minutes, today so far vs the same time yesterday in the workspace timezone, today and yesterday by hour, top pages and sources in the last 30 minutes), `end` (`{ reason: "signed_out" | "busy" }`) and a `: ping` comment every 15 seconds. Reconnects resume from the `Last-Event-ID` header (sent automatically by `EventSource`) or `?after=<cursor>`; a cursor older than 10 minutes starts a fresh feed. Streams are recycled every 15 minutes and closed when the session ends. Payloads carry counts, amounts and masked labels (initials or `p•••@gmail.com`), never an email address, phone number or full name; paths have no query string. Rate limit: 60 connections per minute per user.

Auth: dashboard session only (API keys are refused).

| Parameter | In | Type | Required | Description |
|---|---|---|---|---|
| `after` | query | string | no | Resume cursor (the `id` of the last `feed` event, an ISO timestamp with microseconds). Ignored when malformed. (pattern `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$`) |

| Status | Response |
|---|---|
| 200 | Event stream. — `text/event-stream`: string |
| 401 | Missing or invalid API key. — `application/json`: [Error](#error) |
| 403 | The session role lacks the permission, or the request is cross-site. — `application/json`: [Error](#error) |
| 429 | Too many requests; retry later. — `application/json`: [Error](#error) |

### GET /api/v1/live/pulse

**Today's revenue and visitors now.** Net revenue so far today (payments minus refunds in the reporting currency, local day in the workspace timezone) and distinct visitors on the site in the last 5 minutes. Cheap enough to poll (the dashboard sidebar polls every 30 seconds). Rate limit: 240 requests per minute per workspace.

Auth: `Authorization: Bearer al_...` (or a dashboard session).

| Status | Response |
|---|---|
| 200 | The pulse. — `application/json`: object |
| 401 | Missing or invalid API key. — `application/json`: [Error](#error) |
| 403 | The session role lacks the permission, or the request is cross-site. — `application/json`: [Error](#error) |
| 429 | Too many requests; retry later. — `application/json`: [Error](#error) |

## Privacy

Erasure and data exports (GDPR / CCPA).

### DELETE /api/v1/contacts/{id}

**Erase a contact.** Right to erasure. Deletes the contact and its leads, unlinks its visitors and keeps its revenue as unattributed, so totals do not change. API key with `ingest:write`, or a dashboard session with `workspace.data` (owners and admins).

Auth: `Authorization: Bearer al_...` (or a dashboard session).

| Parameter | In | Type | Required | Description |
|---|---|---|---|---|
| `id` | path | string (uuid) | yes | Contact id. |

| Status | Response |
|---|---|
| 200 | What was removed. — `application/json`: object |
| 401 | Missing or invalid API key. — `application/json`: [Error](#error) |
| 403 | The session role lacks the permission, or the request is cross-site. — `application/json`: [Error](#error) |
| 404 | Not found. — `application/json`: [Error](#error) |
| 429 | Too many requests; retry later. — `application/json`: [Error](#error) |

### GET /api/v1/contacts/{id}/export

**Export a contact.** Subject-access request: everything stored about one contact, raw email included, as a JSON download. API key with `contacts:pii`, or a dashboard session with `export.contacts` (owners and admins).

Auth: `Authorization: Bearer al_...` (or a dashboard session).

| Parameter | In | Type | Required | Description |
|---|---|---|---|---|
| `id` | path | string (uuid) | yes | Contact id. |

| Status | Response |
|---|---|
| 200 | JSON document (attachment). — `application/json`: object |
| 401 | Missing or invalid API key. — `application/json`: [Error](#error) |
| 403 | The session role lacks the permission, or the request is cross-site. — `application/json`: [Error](#error) |
| 404 | Not found. — `application/json`: [Error](#error) |
| 429 | Too many requests; retry later. — `application/json`: [Error](#error) |

### GET /api/v1/exports/audit

**Export the audit log.** The organization's audit log as a streamed CSV download, newest first, with each entry's `seq`, `prev_hash` and `hash` so the tamper-evident chain can be checked outside AdLedger. Accepts the same filters as the audit log page. Dashboard session only, with `audit.view` and `export.csv` (owners and admins); API keys get 403. The export itself is logged.

Auth: dashboard session only (API keys are refused).

| Parameter | In | Type | Required | Description |
|---|---|---|---|---|
| `category` | query | `signin`, `security`, `members`, `data`, `settings`, `integrations` | no | Kind of activity. |
| `member` | query | string | no | A member's user id, or `system` for entries without a member (API keys, jobs). |
| `workspace` | query | string (uuid) | no | Workspace id. |
| `period` | query | `7d`, `30d`, `90d`, `all` | no | How far back to go. (default `"90d"`) |

| Status | Response |
|---|---|
| 200 | CSV (attachment). — `text/csv`: string |
| 401 | Missing or invalid API key. — `application/json`: [Error](#error) |
| 403 | The session role lacks the permission, or the request is cross-site. — `application/json`: [Error](#error) |
| 429 | Too many requests; retry later. — `application/json`: [Error](#error) |

### GET /api/v1/exports/contacts

**Export contacts as CSV.** The Contacts list (optionally filtered) as a streamed CSV download. API key with `contacts:read`, or a dashboard session with `export.csv`. Emails are raw only for keys with `contacts:pii` and members with `export.contacts` (owners, admins); everyone else gets them masked. Exports of more than 1,000 rows raise a security alert.

Auth: `Authorization: Bearer al_...` (or a dashboard session).

| Parameter | In | Type | Required | Description |
|---|---|---|---|---|
| `q` | query | string | no | Search text (name, email, company). (max length 200) |
| `lifecycle` | query | `lead`, `customer` | no | Only leads or only customers. |

| Status | Response |
|---|---|
| 200 | CSV file. — `text/csv`: string |
| 401 | Missing or invalid API key. — `application/json`: [Error](#error) |
| 403 | The session role lacks the permission, or the request is cross-site. — `application/json`: [Error](#error) |
| 429 | Too many requests; retry later. — `application/json`: [Error](#error) |

### GET /api/v1/exports/workspace

**Export the whole workspace.** Every row this workspace owns as one streamed JSON document (credentials omitted). Dashboard session only, with `workspace.data` (owners and admins); API keys get 403.

Auth: dashboard session only (API keys are refused).

| Status | Response |
|---|---|
| 200 | JSON document (attachment). — `application/json`: object |
| 401 | Missing or invalid API key. — `application/json`: [Error](#error) |
| 403 | The session role lacks the permission, or the request is cross-site. — `application/json`: [Error](#error) |
| 429 | Too many requests; retry later. — `application/json`: [Error](#error) |

## Ingestion

Push spend, conversions and pixel events into AdLedger.

### POST /api/v1/spend

**Push ad spend.** Daily spend rows from any ad platform (Zapier, Make, n8n, scripts). Campaigns, ad groups and ads are created on the fly; re-sending the same day/entity replaces it. Up to 20,000 rows per request. API keys need `ingest:write`.

Auth: `Authorization: Bearer al_...` (or a dashboard session).

Request body: `application/json`: object

| Status | Response |
|---|---|
| 200 | Rows stored (some may have errors). — `application/json`: [SpendImportResult](#spendimportresult) |
| 400 | Malformed request. — `application/json`: [Error](#error) |
| 401 | Missing or invalid API key. — `application/json`: [Error](#error) |
| 413 | Too many rows in one request. — `application/json`: [Error](#error) |
| 422 | No row could be stored. — `application/json`: [SpendImportResult](#spendimportresult) |

### POST /api/v1/conversions

**Push payments, refunds and leads.** Conversions from any tool (WooCommerce plugin, Zapier, Make, your backend). Idempotent on `source` + `external_id`. Up to 5,000 events per request. API keys need `ingest:write`.

Auth: `Authorization: Bearer al_...` (or a dashboard session).

Request body: `application/json`: object

| Status | Response |
|---|---|
| 200 | Events stored (some may have errors). — `application/json`: [ConversionImportResult](#conversionimportresult) |
| 400 | Malformed request. — `application/json`: [Error](#error) |
| 401 | Missing or invalid API key. — `application/json`: [Error](#error) |
| 413 | Too many rows in one request. — `application/json`: [Error](#error) |
| 422 | No event could be stored. — `application/json`: [ConversionImportResult](#conversionimportresult) |

### POST /api/v1/collect

**Pixel events.** Endpoint of the website pixel (`/p/al.js`). Sent with `navigator.sendBeacon` as `text/plain` JSON to avoid a CORS preflight. Authenticated by the public site key; the request origin must match the site's domains. Bots are silently dropped.

Auth: none (public endpoint).

Request body: `text/plain`: [CollectPayload](#collectpayload) · `application/json`: [CollectPayload](#collectpayload)

| Status | Response |
|---|---|
| 204 | Accepted (or dropped as bot traffic). |
| 400 | Invalid payload. — `text/plain`: string |
| 403 | Origin not allowed for this site. — `text/plain`: string |
| 404 | Unknown site key. — `text/plain`: string |
| 413 | Payload over 64 KB. — `text/plain`: string |
| 429 | Rate limited. — `text/plain`: string |

### OPTIONS /api/v1/collect

**CORS preflight.**

Auth: none (public endpoint).

| Status | Response |
|---|---|
| 204 | CORS headers for the calling origin. |

### GET /api/v1/import/template

**CSV import template.** Example CSV for Settings → Import data.

Auth: none (public endpoint).

| Parameter | In | Type | Required | Description |
|---|---|---|---|---|
| `kind` | query | `spend`, `revenue` | no | Template type. (default `"spend"`) |

| Status | Response |
|---|---|
| 200 | CSV file. — `text/csv`: string |

## Sync

Trigger connector syncs.

### POST /api/v1/sync/{provider}

**Sync a connector now.** Runs a sync for a connected provider immediately (scheduled syncs also run automatically). A provider that isn't connected or is disabled returns `status: skipped`. API keys need `ingest:write`.

Auth: `Authorization: Bearer al_...` (or a dashboard session).

| Parameter | In | Type | Required | Description |
|---|---|---|---|---|
| `provider` | path | `meta`, `google_ads`, `stripe` | yes | Connector to sync. |

| Status | Response |
|---|---|
| 200 | Sync finished or was skipped. — `application/json`: [SyncResult](#syncresult) |
| 401 | Missing or invalid API key. — `application/json`: [Error](#error) |
| 404 | Not found. — `application/json`: [Error](#error) |
| 502 | The upstream API failed (`status: error`). — `application/json`: [SyncResult](#syncresult) |

## Webhooks

Inbound webhooks from form tools, ad-platform lead forms, WhatsApp, CRMs and revenue platforms.

### POST /api/v1/webhooks/leads/{token}

**Form lead webhook.** Generic lead webhook for Typeform, Tally, Webflow, Jotform, Zapier or any form. Create one in Settings → Tracking; the URL token authenticates the call. Email, phone and name are auto-detected (or mapped in settings); send `al_vid` to link the visitor.

Auth: none (public endpoint).

| Parameter | In | Type | Required | Description |
|---|---|---|---|---|
| `token` | path | string | yes | Webhook token from Settings. |

Request body: `application/json`: object · `application/x-www-form-urlencoded`: object · `multipart/form-data`: object

| Status | Response |
|---|---|
| 201 | Lead recorded. — `application/json`: object |
| 404 | Not found. — `application/json`: [Error](#error) |
| 422 | Nothing usable in the payload. — `application/json`: [Error](#error) |
| 429 | Too many requests; retry later. — `application/json`: [Error](#error) |

### GET /api/v1/webhooks/leads-native/{provider}/{workspaceId}

**Native lead form webhook verification.** Subscription handshake for Meta Lead Ads: answers `hub.challenge` when `hub.verify_token` matches the connection's verify token.

Auth: none (public endpoint).

| Parameter | In | Type | Required | Description |
|---|---|---|---|---|
| `provider` | path | `meta_leads`, `google_ads_leads`, `tiktok_leads` | yes | Lead form connector. |
| `workspaceId` | path | string (uuid) | yes | Workspace id. |
| `hub.mode` | query | `"subscribe"` | yes |  |
| `hub.verify_token` | query | string | yes | The verify token saved in AdLedger. |
| `hub.challenge` | query | string | yes | Echoed back on success. |

| Status | Response |
|---|---|
| 200 | The `hub.challenge` value, echoed as plain text. — `text/plain`: string |
| 400 | Malformed request. — `application/json`: [Error](#error) |
| 403 | Verification failed. — `application/json`: [Error](#error) |
| 404 | Not found. — `application/json`: [Error](#error) |
| 429 | Too many requests; retry later. — `application/json`: [Error](#error) |

### POST /api/v1/webhooks/leads-native/{provider}/{workspaceId}

**Native lead form webhook.** Leads from Meta Lead Ads (signed `X-Hub-Signature-256`; lead details are fetched from the Graph API), Google Ads lead form extensions (`google_key` in the body) and TikTok Lead Generation (`TikTok-Signature`). Each lead becomes a contact, a lead and a touchpoint on the ad that collected it. Idempotent on the platform's lead id.

Auth: none (public endpoint).

| Parameter | In | Type | Required | Description |
|---|---|---|---|---|
| `provider` | path | `meta_leads`, `google_ads_leads`, `tiktok_leads` | yes | Lead form connector. |
| `workspaceId` | path | string (uuid) | yes | Workspace id. |

Request body: `application/json`: object

| Status | Response |
|---|---|
| 200 | Webhook processed. — `application/json`: object |
| 400 | Malformed request. — `application/json`: [Error](#error) |
| 401 | Invalid signature. — `application/json`: [Error](#error) |
| 404 | Not found. — `application/json`: [Error](#error) |
| 413 | Payload too large. — `application/json`: [Error](#error) |
| 429 | Too many requests; retry later. — `application/json`: [Error](#error) |
| 500 | Processing failed; the platform will retry (ingestion is idempotent). — `application/json`: [Error](#error) |

### GET /api/v1/webhooks/whatsapp/{workspaceId}

**WhatsApp webhook verification.** WhatsApp Business Cloud API subscription handshake: answers `hub.challenge` when `hub.verify_token` matches the connection's verify token.

Auth: none (public endpoint).

| Parameter | In | Type | Required | Description |
|---|---|---|---|---|
| `workspaceId` | path | string (uuid) | yes | Workspace id. |
| `hub.mode` | query | `"subscribe"` | yes |  |
| `hub.verify_token` | query | string | yes | The verify token saved in AdLedger. |
| `hub.challenge` | query | string | yes | Echoed back on success. |

| Status | Response |
|---|---|
| 200 | The `hub.challenge` value, echoed as plain text. — `text/plain`: string |
| 403 | Verification failed. — `application/json`: [Error](#error) |
| 404 | Not found. — `application/json`: [Error](#error) |
| 429 | Too many requests; retry later. — `application/json`: [Error](#error) |

### POST /api/v1/webhooks/whatsapp/{workspaceId}

**WhatsApp message webhook.** Inbound WhatsApp messages, verified with `X-Hub-Signature-256` (your app secret). A message carrying a click-to-chat reference code is linked to the visitor and ad that opened the chat and recorded as a lead. Idempotent per reference code.

Auth: none (public endpoint).

| Parameter | In | Type | Required | Description |
|---|---|---|---|---|
| `workspaceId` | path | string (uuid) | yes | Workspace id. |
| `X-Hub-Signature-256` | header | string | yes |  |

Request body: `application/json`: object

| Status | Response |
|---|---|
| 200 | Webhook processed. — `application/json`: object |
| 401 | Invalid signature. — `application/json`: [Error](#error) |
| 404 | Not found. — `application/json`: [Error](#error) |
| 413 | Payload too large. — `application/json`: [Error](#error) |
| 429 | Too many requests; retry later. — `application/json`: [Error](#error) |
| 500 | Processing failed; Meta will retry (ingestion is idempotent). — `application/json`: [Error](#error) |

### POST /api/v1/webhooks/stripe/{workspaceId}

**Stripe webhook.** Receives Stripe events (charges, refunds, checkout sessions). Verified with the `Stripe-Signature` header. AdLedger registers this webhook in Stripe automatically when it can.

Auth: none (public endpoint).

| Parameter | In | Type | Required | Description |
|---|---|---|---|---|
| `workspaceId` | path | string (uuid) | yes | Workspace id. |
| `Stripe-Signature` | header | string | yes |  |

Request body: `application/json`: object

| Status | Response |
|---|---|
| 200 | Event processed (or ignored). — `application/json`: object |
| 400 | Malformed request. — `application/json`: [Error](#error) |
| 404 | Not found. — `application/json`: [Error](#error) |
| 500 | Processing failed; Stripe will retry (ingestion is idempotent). — `application/json`: [Error](#error) |

### POST /api/v1/webhooks/{provider}/{workspaceId}

**Revenue platform webhook.** Orders, payments and refunds from connected revenue platforms. Each provider's own signature scheme is verified (HMAC, HTTP Basic auth for Chargebee and Recurly, a `?token=` for Gumroad). WooCommerce's `webhook_id=N` activation ping is acknowledged. Recurly reads the site currency from `?currency=` (default USD). HubSpot and Pipedrive use `/api/v1/webhooks/crm/{provider}/{workspaceId}` instead.

Auth: none (public endpoint).

| Parameter | In | Type | Required | Description |
|---|---|---|---|---|
| `provider` | path | `shopify`, `woocommerce`, `paddle`, `lemonsqueezy`, `razorpay`, `paypal`, `chargebee`, `recurly`, `gumroad`, `cashfree`, `instamojo`, `phonepe` | yes | Revenue connector. |
| `workspaceId` | path | string (uuid) | yes | Workspace id. |

Request body: `application/json`: object · `application/x-www-form-urlencoded`: object · `application/xml`: string

| Status | Response |
|---|---|
| 200 | Webhook processed. — `application/json`: object |
| 400 | Malformed request. — `application/json`: [Error](#error) |
| 401 | Invalid signature. — `application/json`: [Error](#error) |
| 404 | Not found. — `application/json`: [Error](#error) |
| 413 | Payload too large. — `application/json`: [Error](#error) |
| 429 | Too many requests; retry later. — `application/json`: [Error](#error) |
| 500 | Processing failed; the platform will retry (ingestion is idempotent). — `application/json`: [Error](#error) |

### POST /api/v1/webhooks/crm/{provider}/{workspaceId}

**CRM deal webhook.** Deal events from HubSpot (`X-HubSpot-Signature-v3`) or Pipedrive (HTTP Basic auth). The events carry only deal ids, so AdLedger re-reads those deals through the CRM's API and stores the won ones as revenue (idempotent on deal id).

Auth: none (public endpoint).

| Parameter | In | Type | Required | Description |
|---|---|---|---|---|
| `provider` | path | `hubspot`, `pipedrive` | yes | CRM connector. |
| `workspaceId` | path | string (uuid) | yes | Workspace id. |

Request body: `application/json`: any

| Status | Response |
|---|---|
| 200 | Webhook processed. — `application/json`: object |
| 400 | Malformed request. — `application/json`: [Error](#error) |
| 401 | Invalid signature. — `application/json`: [Error](#error) |
| 404 | Not found. — `application/json`: [Error](#error) |
| 413 | Payload too large. — `application/json`: [Error](#error) |
| 429 | Too many requests; retry later. — `application/json`: [Error](#error) |
| 500 | Processing failed; the CRM will retry (ingestion is idempotent). — `application/json`: [Error](#error) |

## MCP

Model Context Protocol endpoint for AI agents (read-only tools).

### GET /api/mcp

**MCP event stream (not supported).** Part of the Streamable HTTP transport. AdLedger's MCP server is stateless, so after authentication this always answers 405; clients fall back to POST. API keys need the `mcp` scope.

Auth: `Authorization: Bearer al_...` (or a dashboard session).

| Status | Response |
|---|---|
| 401 | Missing or invalid API key. — `application/json`: [Error](#error) |
| 405 | The server is stateless, so there is no server-initiated event stream (GET) or session to end (DELETE). — `application/json`: object |

### POST /api/mcp

**MCP endpoint (Streamable HTTP).** Model Context Protocol server for AI agents (Claude, Cursor, …). JSON-RPC 2.0 over Streamable HTTP; all tools are read-only. See docs/MCP.md for the tool list and client setup. The server is stateless: every request is handled on its own. API keys need the `mcp` scope.

Auth: `Authorization: Bearer al_...` (or a dashboard session).

Request body: `application/json`: object

| Status | Response |
|---|---|
| 200 | JSON-RPC response (JSON or a single server-sent event). — `application/json`: object · `text/event-stream`: string |
| 401 | Missing or invalid API key. — `application/json`: [Error](#error) |

### DELETE /api/mcp

**End an MCP session (not supported).** Part of the Streamable HTTP transport. AdLedger's MCP server is stateless, so after authentication this always answers 405; clients fall back to POST. API keys need the `mcp` scope.

Auth: `Authorization: Bearer al_...` (or a dashboard session).

| Status | Response |
|---|---|
| 401 | Missing or invalid API key. — `application/json`: [Error](#error) |
| 405 | The server is stateless, so there is no server-initiated event stream (GET) or session to end (DELETE). — `application/json`: object |

## System

Health and API description.

### GET /api/v1/health

**Health check.** Liveness + database check for load balancers and uptime monitors. No authentication.

Auth: none (public endpoint).

| Status | Response |
|---|---|
| 200 | App and database are up. — `application/json`: [Health](#health) |
| 503 | Database unreachable (`status: degraded`). — `application/json`: [Health](#health) |

### GET /api/v1/openapi.json

**This OpenAPI document.**

Auth: none (public endpoint).

| Status | Response |
|---|---|
| 200 | The API description. — `application/json`: object |

## Connect

One-click OAuth connect for ad platforms (browser flow, dashboard session).

### GET /api/v1/oauth/{provider}/start

**Start one-click connect.** Browser only. Needs a dashboard session with `workspace.settings` and the platform OAuth app env vars; sets a signed state cookie and redirects to the platform consent screen.

Auth: dashboard session only (API keys are refused).

| Parameter | In | Type | Required | Description |
|---|---|---|---|---|
| `provider` | path | `meta`, `google_ads`, `tiktok_ads`, `linkedin_ads` | yes | Ad platform. |

| Status | Response |
|---|---|
| 302 | Redirect to the platform consent screen, the account picker or the connect page with an error. |
| 404 | Not found. — `application/json`: [Error](#error) |

### GET /api/v1/oauth/{provider}/callback

**One-click connect callback.** The platform redirects here after consent. Verifies the state cookie, exchanges the code for tokens (kept in an encrypted short-lived cookie, never in URLs) and redirects to the account picker.

Auth: dashboard session only (API keys are refused).

| Parameter | In | Type | Required | Description |
|---|---|---|---|---|
| `provider` | path | `meta`, `google_ads`, `tiktok_ads`, `linkedin_ads` | yes | Ad platform. |
| `code` | query | string | no | Authorization code (TikTok: `auth_code`). |
| `state` | query | string | no | State echoed by the platform. |
| `error` | query | string | no | Set when the user declined. |

| Status | Response |
|---|---|
| 302 | Redirect to the platform consent screen, the account picker or the connect page with an error. |
| 404 | Not found. — `application/json`: [Error](#error) |

## Webhook events

Outbound: what AdLedger POSTs to the endpoints you add in Developers → Webhooks. Verify the signature before trusting a body (see docs/WEBHOOKS.md).

| Event | Summary |
|---|---|
| [`lead.created`](#leadcreated) | Lead created |
| [`contact.created`](#contactcreated) | Contact created |
| [`contact.updated`](#contactupdated) | Contact stage changed |
| [`payment.succeeded`](#paymentsucceeded) | Payment succeeded |
| [`payment.refunded`](#paymentrefunded) | Payment refunded |

### lead.created

**Lead created.** A form fill, lead-ads lead, WhatsApp chat or API lead was recorded. CSV imports don't fire it.

Sent as `POST` to your endpoint URL.

| Header | Description |
|---|---|
| `AdLedger-Signature` | `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>" with the endpoint's signing secret>`. |
| `AdLedger-Event` | The event type. |
| `AdLedger-Event-Id` | Same as the body's `id`. |
| `AdLedger-Delivery` | This delivery's id (changes on resend). |
| `AdLedger-Attempt` | 1 for the first try, then 2, 3… on retries. |

Body: `application/json`: [WebhookLeadCreated](#webhookleadcreated)

| Your response | Meaning |
|---|---|
| 2XX | Received. Answer within 10 seconds; any other status, a timeout or a redirect is retried (1 min, 5 min, 30 min, 2 h, 6 h, 12 h, 24 h). |

### contact.created

**Contact created.** A person appeared for the first time: from a lead, a payment or a pixel identify. CSV imports don't fire it.

Sent as `POST` to your endpoint URL.

| Header | Description |
|---|---|
| `AdLedger-Signature` | `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>" with the endpoint's signing secret>`. |
| `AdLedger-Event` | The event type. |
| `AdLedger-Event-Id` | Same as the body's `id`. |
| `AdLedger-Delivery` | This delivery's id (changes on resend). |
| `AdLedger-Attempt` | 1 for the first try, then 2, 3… on retries. |

Body: `application/json`: [WebhookContactCreated](#webhookcontactcreated)

| Your response | Meaning |
|---|---|
| 2XX | Received. Answer within 10 seconds; any other status, a timeout or a redirect is retried (1 min, 5 min, 30 min, 2 h, 6 h, 12 h, 24 h). |

### contact.updated

**Contact stage changed.** A contact moved to another pipeline stage: dragged on the board (`manual`), won by a payment (`payment`), or a move was undone (`undo`). Deleting a stage doesn't fire it.

Sent as `POST` to your endpoint URL.

| Header | Description |
|---|---|
| `AdLedger-Signature` | `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>" with the endpoint's signing secret>`. |
| `AdLedger-Event` | The event type. |
| `AdLedger-Event-Id` | Same as the body's `id`. |
| `AdLedger-Delivery` | This delivery's id (changes on resend). |
| `AdLedger-Attempt` | 1 for the first try, then 2, 3… on retries. |

Body: `application/json`: [WebhookContactUpdated](#webhookcontactupdated)

| Your response | Meaning |
|---|---|
| 2XX | Received. Answer within 10 seconds; any other status, a timeout or a redirect is retried (1 min, 5 min, 30 min, 2 h, 6 h, 12 h, 24 h). |

### payment.succeeded

**Payment succeeded.** A new payment from a revenue source or the conversions API. Replays of the same payment don't fire it again.

Sent as `POST` to your endpoint URL.

| Header | Description |
|---|---|
| `AdLedger-Signature` | `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>" with the endpoint's signing secret>`. |
| `AdLedger-Event` | The event type. |
| `AdLedger-Event-Id` | Same as the body's `id`. |
| `AdLedger-Delivery` | This delivery's id (changes on resend). |
| `AdLedger-Attempt` | 1 for the first try, then 2, 3… on retries. |

Body: `application/json`: [WebhookPaymentSucceeded](#webhookpaymentsucceeded)

| Your response | Meaning |
|---|---|
| 2XX | Received. Answer within 10 seconds; any other status, a timeout or a redirect is retried (1 min, 5 min, 30 min, 2 h, 6 h, 12 h, 24 h). |

### payment.refunded

**Payment refunded.** A new refund was recorded.

Sent as `POST` to your endpoint URL.

| Header | Description |
|---|---|
| `AdLedger-Signature` | `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>" with the endpoint's signing secret>`. |
| `AdLedger-Event` | The event type. |
| `AdLedger-Event-Id` | Same as the body's `id`. |
| `AdLedger-Delivery` | This delivery's id (changes on resend). |
| `AdLedger-Attempt` | 1 for the first try, then 2, 3… on retries. |

Body: `application/json`: [WebhookPaymentRefunded](#webhookpaymentrefunded)

| Your response | Meaning |
|---|---|
| 2XX | Received. Answer within 10 seconds; any other status, a timeout or a redirect is retried (1 min, 5 min, 30 min, 2 h, 6 h, 12 h, 24 h). |

## Schemas

Fields ending in `Minor` are integers in minor currency units (e.g. cents).

### Error

| Field | Type | Required | Description |
|---|---|---|---|
| `error` | string | yes | Machine-readable message. |
| `hint` | string | no | How to fix it. |

### ValidationError

| Field | Type | Required | Description |
|---|---|---|---|
| `error` | `"invalid parameters"` | yes |  |
| `details` | object[] | yes |  |

### Date

string — Calendar date.

### AttributionModel

`first_touch`, `last_touch`, `linear`

### Platform

`meta`, `google`, `microsoft`, `tiktok`, `linkedin`, `pinterest`, `snapchat`, `reddit`, `x`, `other`

### Health

| Field | Type | Required | Description |
|---|---|---|---|
| `status` | `ok`, `degraded` | yes |  |
| `db` | `ok`, `error` | yes |  |
| `database` | `embedded`, `postgres` | yes |  |
| `version` | string | yes |  |

### ReportResponse

| Field | Type | Required | Description |
|---|---|---|---|
| `start` | [Date](#date) | yes |  |
| `end` | [Date](#date) | yes |  |
| `model` | [AttributionModel](#attributionmodel) | yes |  |
| `currency` | string | yes | ISO 4217 reporting currency; every *Minor value is in this currency. |
| `timezone` | string | yes | Workspace IANA timezone the dates refer to. |
| `data` | [Overview](#overview) or [PerformanceRow](#performancerow)[] or [SeriesPoint](#seriespoint)[] or [ChannelRow](#channelrow)[] or [Comparison](#comparison) or object | yes | Shape depends on `report`. |

### Overview

| Field | Type | Required | Description |
|---|---|---|---|
| `currency` | string | yes |  |
| `model` | [AttributionModel](#attributionmodel) | yes |  |
| `start` | [Date](#date) | yes |  |
| `end` | [Date](#date) | yes |  |
| `spendMinor` | integer | yes | Ad spend. Integer minor units (cents) in the reporting currency. |
| `impressions` | integer | yes |  |
| `clicks` | integer | yes |  |
| `leads` | integer | yes | All leads. |
| `paidLeads` | number | yes | Lead credit attributed to ads (fractional for linear). |
| `customers` | integer | yes | All new customers. |
| `paidCustomers` | number | yes | Customer credit attributed to ads. |
| `revenueMinor` | integer | yes | All revenue. Integer minor units (cents) in the reporting currency. |
| `attributedRevenueMinor` | integer | yes | Revenue credited to ads. Integer minor units (cents) in the reporting currency. |
| `unattributedRevenueMinor` | integer | yes | Revenue with no touchpoint. Integer minor units (cents) in the reporting currency. |
| `roas` | number \\| null | yes | Attributed revenue / spend. |
| `blendedRoas` | number \\| null | yes | All revenue / spend. |
| `cplMinor` | integer \\| null | yes | Cost per paid lead. Integer minor units (cents) in the reporting currency. |
| `cacMinor` | integer \\| null | yes | Cost per paid customer. Integer minor units (cents) in the reporting currency. |
| `unattributedShare` | number \\| null | yes | Share of revenue without a touchpoint (0–1). |
| `warnings` | string[] | yes |  |

### PerformanceRow

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string (uuid) | yes |  |
| `name` | string | yes |  |
| `platform` | [Platform](#platform) | yes |  |
| `status` | string \\| null | yes |  |
| `parentId` | string \\| null (uuid) | yes |  |
| `parentName` | string \\| null | yes |  |
| `spendMinor` | integer | yes | Spend. Integer minor units (cents) in the reporting currency. |
| `impressions` | integer | yes |  |
| `clicks` | integer | yes |  |
| `leads` | number | yes | Attributed lead credit. |
| `customers` | number | yes | Attributed customer credit. |
| `revenueMinor` | integer | yes | Attributed revenue. Integer minor units (cents) in the reporting currency. |
| `roas` | number \\| null | yes |  |
| `cplMinor` | integer \\| null | yes | Cost per lead. Integer minor units (cents) in the reporting currency. |
| `cacMinor` | integer \\| null | yes | Cost per customer. Integer minor units (cents) in the reporting currency. |
| `ctr` | number \\| null | yes | Clicks / impressions. |

### SeriesPoint

| Field | Type | Required | Description |
|---|---|---|---|
| `date` | [Date](#date) | yes |  |
| `spendMinor` | integer | yes | Spend that day. Integer minor units (cents) in the reporting currency. |
| `revenueMinor` | integer | yes | All revenue that day. Integer minor units (cents) in the reporting currency. |
| `attributedRevenueMinor` | integer | yes | Revenue credited to ads. Integer minor units (cents) in the reporting currency. |
| `leads` | integer | yes |  |

### ChannelRow

| Field | Type | Required | Description |
|---|---|---|---|
| `channel` | string | yes | e.g. paid_social, paid_search, organic, direct, unattributed. |
| `leads` | number | yes |  |
| `customers` | number | yes |  |
| `revenueMinor` | integer | yes | Revenue credit. Integer minor units (cents) in the reporting currency. |

### Comparison

| Field | Type | Required | Description |
|---|---|---|---|
| `current` | [Overview](#overview) | yes |  |
| `previous` | [Overview](#overview) | yes |  |
| `movers` | object[] | yes |  |

### Contact

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string (uuid) | yes |  |
| `email` | string \\| null (email) | yes |  |
| `name` | string \\| null | yes |  |
| `lifecycle` | `lead`, `customer` | yes |  |
| `firstSeenAt` | string (date-time) | yes |  |
| `firstLeadAt` | string \\| null (date-time) | yes |  |
| `revenueMinor` | integer | yes | Lifetime revenue. Integer minor units (cents) in the reporting currency. |
| `firstChannel` | string \\| null | yes |  |
| `firstCampaign` | string \\| null | yes |  |
| `touchpoints` | integer | yes |  |

### Journey

| Field | Type | Required | Description |
|---|---|---|---|
| `contact` | object | yes |  |
| `items` | object or object or object[] | yes |  |
| `credits` | object[] | yes |  |

### SyncResult

| Field | Type | Required | Description |
|---|---|---|---|
| `provider` | string | yes |  |
| `status` | `success`, `error`, `skipped` | yes |  |
| `rows` | integer | yes | Rows upserted. |
| `error` | string | no |  |

### SpendRow

| Field | Type | Required | Description |
|---|---|---|---|
| `date` | [Date](#date) | yes |  |
| `campaign_name` | string | yes | (max length 300) |
| `spend` | string \\| number | yes | Decimal amount in `currency`, e.g. "12.34". |
| `currency` | string | no | ISO 4217; defaults to the reporting currency. (pattern `^[A-Za-z]{3}$`) |
| `platform` | string | no | Ad platform, e.g. meta, google, tiktok; unknown values become `other`. |
| `account_id` | string | no | (max length 120) |
| `account_name` | string | no | (max length 200) |
| `campaign_id` | string | no | (max length 120) |
| `ad_group_id` | string | no | (max length 120) |
| `ad_group_name` | string | no | (max length 300) |
| `ad_id` | string | no | (max length 120) |
| `ad_name` | string | no | (max length 300) |
| `impressions` | integer | no | (min 0) |
| `clicks` | integer | no | (min 0) |
| `conversions` | number | no | Platform-reported conversions. (min 0) |

### SpendImportResult

| Field | Type | Required | Description |
|---|---|---|---|
| `ok` | boolean | yes |  |
| `rows` | integer | yes | Rows stored. |
| `errors` | string[] | yes |  |

### ConversionEvent

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `payment`, `refund`, `lead` | yes |  |
| `external_id` | string | yes | Your id; idempotency key together with `source`. (max length 200) |
| `related_external_id` | string | no | For refunds: the payment's external_id. (max length 200) |
| `amount` | string \\| number | no | Decimal amount (payments/refunds), e.g. "49.00". |
| `currency` | string | no | ISO 4217; defaults to the reporting currency. (pattern `^[A-Za-z]{3}$`) |
| `occurred_at` | string (date-time) | no | Defaults to now. |
| `email` | string | no | (max length 320) |
| `phone` | string | no | (max length 40) |
| `name` | string | no | (max length 200) |
| `visitor_id` | string | no | Pixel visitor id (`al_vid`) to link the browser. (max length 64) |
| `source` | string | no | Source label, e.g. woocommerce. (default `"api"`, pattern `^[a-z0-9_-]{1,40}$`) |
| `form_name` | string | no | (max length 200) |

### ConversionImportResult

| Field | Type | Required | Description |
|---|---|---|---|
| `ok` | boolean | yes |  |
| `revenue` | integer | yes | Payments/refunds stored. |
| `leads` | integer | yes | Leads stored. |
| `errors` | string[] | yes |  |

### CollectPayload

| Field | Type | Required | Description |
|---|---|---|---|
| `site` | string | yes | Public site key (pk_...). (max length 64) |
| `vid` | string | yes | Anonymous visitor id. (max length 64) |
| `fbp` | string \\| null | no | (max length 200) |
| `fbc` | string \\| null | no | (max length 400) |
| `events` | object[] | yes | (max 50 items) |

### SearchResult

| Field | Type | Required | Description |
|---|---|---|---|
| `kind` | `contact`, `campaign`, `ad_group`, `ad` | yes |  |
| `id` | string (uuid) | yes |  |
| `title` | string | yes | Contact name (or email when there is no name), or the campaign / ad set / ad name. |
| `subtitle` | string \\| null | yes | The contact's email when a name is shown; the parent campaign for ad sets and the parent ad set for ads. |
| `platform` | string \\| null | yes | Ad platform for campaigns, ad sets and ads; null for contacts. |
| `status` | string \\| null | yes | `lead` or `customer` for contacts; the platform's delivery status for ads. |
| `url` | string | yes | Dashboard path that opens the result, e.g. `/contacts/{id}`. |

### Lead

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string (uuid) | yes |  |
| `occurredAt` | string (date-time) | yes |  |
| `source` | `pixel`, `webhook`, `api`, `csv` | yes |  |
| `formName` | string \\| null | yes |  |
| `contact` | object | yes |  |

### WebhookStage

A pipeline stage.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string (uuid) | yes |  |
| `name` | string | yes |  |
| `kind` | `open`, `won`, `lost` | yes |  |

### WebhookContact

A contact as sent in webhook events. `email` and `phone` are raw only for endpoints with Include personal data on; otherwise null, with the masked email and SHA-256 hashes for matching.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string (uuid) | yes |  |
| `name` | string \\| null | yes |  |
| `email` | string \\| null | yes | Raw email (personal data on) or null. |
| `email_masked` | string \\| null | yes | e.g. `p•••••@example.com`. |
| `email_sha256` | string \\| null | yes | SHA-256 hex of the lowercased, trimmed email. |
| `phone` | string \\| null | yes | Raw phone as submitted (personal data on, when known at the time of the event) or null. |
| `phone_sha256` | string \\| null | yes | SHA-256 hex of the phone's digits. |
| `lifecycle` | `lead`, `customer` | yes |  |
| `stage` | [WebhookStage](#webhookstage) or null | yes |  |
| `first_seen_at` | string (date-time) | yes |  |
| `url` | string \\| null | yes | Link to the contact in AdLedger (needs PUBLIC_URL). |

### WebhookPayment

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string (uuid) | yes |  |
| `source` | string | yes | stripe, shopify, paddle, api, csv… |
| `external_id` | string | yes | The payment's id in its source. |
| `amount_minor` | integer | yes | Always positive. Integer minor units (cents). |
| `currency` | string | yes | ISO 4217, upper case. |
| `occurred_at` | string (date-time) | yes |  |

### WebhookRefund

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string (uuid) | yes |  |
| `source` | string | yes | stripe, shopify, paddle, api, csv… |
| `external_id` | string | yes | The payment's id in its source. |
| `amount_minor` | integer | yes | Always positive. Integer minor units (cents). |
| `currency` | string | yes | ISO 4217, upper case. |
| `occurred_at` | string (date-time) | yes |  |
| `related_external_id` | string \\| null | yes | external_id of the refunded payment. |

### WebhookLead

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string (uuid) | yes |  |
| `source` | `pixel`, `webhook`, `api`, `csv` | yes |  |
| `form_name` | string \\| null | yes |  |
| `occurred_at` | string (date-time) | yes |  |

### LeadCreatedData

| Field | Type | Required | Description |
|---|---|---|---|
| `lead` | [WebhookLead](#webhooklead) | yes |  |
| `contact` | [WebhookContact](#webhookcontact) | yes |  |

### WebhookLeadCreated

Body of a lead.created delivery.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | evt_… Unique per event; retries and resends keep it (dedupe on it). |
| `type` | `"lead.created"` | yes |  |
| `api_version` | string | yes | Payload format version. |
| `created_at` | string (date-time) | yes |  |
| `workspace_id` | string (uuid) | yes |  |
| `test` | boolean | yes | true for Send test event (sample data). |
| `data` | [LeadCreatedData](#leadcreateddata) | yes |  |

### ContactCreatedData

| Field | Type | Required | Description |
|---|---|---|---|
| `contact` | [WebhookContact](#webhookcontact) | yes |  |

### WebhookContactCreated

Body of a contact.created delivery.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | evt_… Unique per event; retries and resends keep it (dedupe on it). |
| `type` | `"contact.created"` | yes |  |
| `api_version` | string | yes | Payload format version. |
| `created_at` | string (date-time) | yes |  |
| `workspace_id` | string (uuid) | yes |  |
| `test` | boolean | yes | true for Send test event (sample data). |
| `data` | [ContactCreatedData](#contactcreateddata) | yes |  |

### ContactUpdatedData

| Field | Type | Required | Description |
|---|---|---|---|
| `contact` | [WebhookContact](#webhookcontact) | yes |  |
| `changes` | object | yes |  |

### WebhookContactUpdated

Body of a contact.updated delivery.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | evt_… Unique per event; retries and resends keep it (dedupe on it). |
| `type` | `"contact.updated"` | yes |  |
| `api_version` | string | yes | Payload format version. |
| `created_at` | string (date-time) | yes |  |
| `workspace_id` | string (uuid) | yes |  |
| `test` | boolean | yes | true for Send test event (sample data). |
| `data` | [ContactUpdatedData](#contactupdateddata) | yes |  |

### PaymentSucceededData

| Field | Type | Required | Description |
|---|---|---|---|
| `payment` | [WebhookPayment](#webhookpayment) | yes |  |
| `contact` | [WebhookContact](#webhookcontact) or null | yes | null when the payment couldn't be matched to a person. |

### WebhookPaymentSucceeded

Body of a payment.succeeded delivery.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | evt_… Unique per event; retries and resends keep it (dedupe on it). |
| `type` | `"payment.succeeded"` | yes |  |
| `api_version` | string | yes | Payload format version. |
| `created_at` | string (date-time) | yes |  |
| `workspace_id` | string (uuid) | yes |  |
| `test` | boolean | yes | true for Send test event (sample data). |
| `data` | [PaymentSucceededData](#paymentsucceededdata) | yes |  |

### PaymentRefundedData

| Field | Type | Required | Description |
|---|---|---|---|
| `refund` | [WebhookRefund](#webhookrefund) | yes |  |
| `contact` | [WebhookContact](#webhookcontact) or null | yes | null when the payment couldn't be matched to a person. |

### WebhookPaymentRefunded

Body of a payment.refunded delivery.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | evt_… Unique per event; retries and resends keep it (dedupe on it). |
| `type` | `"payment.refunded"` | yes |  |
| `api_version` | string | yes | Payload format version. |
| `created_at` | string (date-time) | yes |  |
| `workspace_id` | string (uuid) | yes |  |
| `test` | boolean | yes | true for Send test event (sample data). |
| `data` | [PaymentRefundedData](#paymentrefundeddata) | yes |  |
