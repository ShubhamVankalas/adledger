<!-- Generated from public/openapi.json by scripts/api-docs.ts. Do not edit by hand. -->

# AdLedger API reference (v0.1.0)

The machine-readable spec is served by every install at `/api/v1/openapi.json` (OpenAPI 3.1) —
load it into Postman, Insomnia, Scalar or an SDK generator.

REST API of a self-hosted AdLedger install. Reporting endpoints read the same SQL as the dashboard and the MCP server, so numbers always agree.

**Authentication.** Create an API key in Settings → API & MCP and send it as `Authorization: Bearer al_...`. Each key carries scopes: `reports:read` (the default for new keys), `mcp`, `contacts:read` (emails masked), `contacts:pii` (raw emails) and `ingest:write` (push data, trigger syncs, erase contacts). A call without the scope it needs gets 403. A dashboard session cookie also works for same-origin calls and is held to the member's role. Ingestion endpoints called by third parties (pixel, webhooks) are authenticated by their own site key, URL token or signature instead.

**Money** is always an integer in minor units (e.g. cents) plus an ISO 4217 currency code. **Dates** in query strings are `YYYY-MM-DD` in the workspace timezone (end inclusive); timestamps in responses are ISO 8601 UTC.

## Endpoints

| Method | Path | Summary | Auth |
|---|---|---|---|
| GET | [`/api/v1/health`](#get-apiv1health) | Health check | public |
| GET | [`/api/v1/openapi.json`](#get-apiv1openapijson) | This OpenAPI document | public |
| GET | [`/api/v1/reports/{report}`](#get-apiv1reportsreport) | Run a report | API key |
| GET | [`/api/v1/contacts`](#get-apiv1contacts) | List contacts | API key |
| GET | [`/api/v1/contacts/{id}/journey`](#get-apiv1contactsidjourney) | Contact journey | API key |
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
