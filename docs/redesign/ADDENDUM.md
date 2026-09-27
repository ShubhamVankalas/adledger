# AdLedger addendum: trust, reports, metrics, CRM and signature features

Status: approved · Date: 2026-09-27 · Companion to `BRIEF.md` ("Quiet Ledger"), which owns the design system, IA, Overview, CRM screens and Phases 1–6. This addendum adds compliance and security, leak protection, PDF reports, metrics, extra CRM features and the signature features, and plugs them into BRIEF's plan. It does not restate design tokens or page layouts.

Sources: `compliance-security.md`, `pdf-reports.md`, `industry-metrics.md`, `crm-paid-features.md`, `differentiators.md`, plus a repo check at `dc0b69f`.

**Two bugs to fix now, whatever else is decided (checked in code):**
1. `src/lib/capi/google.ts` still posts to `:uploadClickConversions`. Since 15 June 2026, Google rejects that endpoint for developer tokens that weren't already allowlisted. **Google offline conversions are therefore broken on every new install.** Move to the Data Manager API.
2. Nothing in `src/lib/capi` sends consent (Google `consent`, Meta `data_processing_options`), and the pixel ignores Global Privacy Control. That is a legal risk, and Google can drop EEA conversions that have no consent signal.

Both go in a **hotfix lane** that may merge at any time (§7). Neither touches BRIEF's Phase 1 files.

**How this plugs into BRIEF:**
- Table names follow BRIEF wherever it already names one: `share_links`, `report_schedules`, `goals`, `annotations`, `saved_views`, `contact_stats`, `contact_notes`, `tasks`, `pipeline_stages`, `alert_rules`.
- New report SQL goes in new files, per BRIEF's conflict rule 1:
  - `src/lib/reports-trust.ts`: data health, truth gap, consent coverage
  - `src/lib/reports-profit.ts`: receipts, POAS, payback, time to money, lead value
  - BRIEF's `reports-metrics.ts`: the base metrics
- Every metric in §4 is a `MetricKey` in BRIEF's Phase 1 metric registry. Every report section reuses those keys, so dashboard, PDF, share link, MCP and AI all show the same number.

---

## 1. Compliance and security

### 1.1 What we can and cannot claim

SOC 2 and ISO 27001 audit **an organisation running a service**, not a codebase. When someone self-hosts AdLedger, they are the controller and the processor. PostHog says the same about its self-hosted edition, and Sentry and GitLab both leave self-hosted installs out of their SOC 2 scope. AdLedger will therefore show **no certification badges, ever**, unless a future hosted service of ours is actually audited.

| Never say | Say |
|---|---|
| "SOC 2 compliant" / "ISO certified" | "Ships controls that map to common SOC 2 criteria. The project itself is not audited." |
| "GDPR compliant" | "Built to help you meet GDPR, UK GDPR, CCPA/CPRA and India's DPDP. When you self-host, you are the data controller." |
| "No consent needed" / "cookieless" (default mode) | "Consent modes built in. A cookieless mode is available, with weaker attribution." AdLedger processes emails, click IDs and `_fbp`/`_fbc`, so it doesn't qualify for the CNIL analytics exemption. |
| "Bank-grade / military-grade security" | Name the mechanism: AES-256-GCM secrets, scrypt passwords, hashed tokens, signed webhooks. |
| "HIPAA compliant" | "Not designed for health data, card data or children's data." |
| "Copy-proof" / "leak-proof" | "Leaks are deterred and traceable: permissions, watermarks, fingerprints, an audit trail." |

**EU Cyber Resilience Act.** From 11 Sep 2026, open-source stewards must keep a security policy and report actively exploited vulnerabilities. We meet that with `SECURITY.md`, GitHub private vulnerability reporting and `security.txt`. If AdLedger ever sells hosting or support, full manufacturer duties may apply (see decision D1).

**Licence.** Keep AGPL-3.0: its network clause stops closed hosted forks. Add `TRADEMARKS.md` (forks must rebrand, self-hosters may use the name for their own install) and a DCO sign-off.

**Name clearance.** A US "ADLEDGER" mark exists (serial 87788304, held by the ad-blockchain consortium). Its status wasn't confirmed. Run a clearance check before launch marketing.

### 1.2 What we already have (the baseline to advertise)

- scrypt passwords; hashed session and API tokens
- AES-256-GCM connector secrets; signed webhooks; SSRF guards
- CSP and other security headers
- PII hashing outside `contacts`; `redactPii`
- contact erasure, subject-access export, workspace export, raw-event retention
- an audit log
- MCP that is read-only and masks emails

### 1.3 Features ranked (value first, then effort)

Effort: S ≤ 2 days · M 3–7 days · L 2+ weeks. Phase letters refer to §7. "Paid elsewhere" names the cheapest tier that unlocks the feature at a major vendor. Here, all of it is free.

| # | Feature | Why | Paid elsewhere | Effort | Phase |
|---|---|---|---|---|---|
| 1 | **Google Data Manager API migration** (OAuth scope `datamanager`, batches of up to 2,000) | New installs can't upload offline conversions at all | — | M | Hotfix |
| 2 | **Consent-aware conversion upload.** Google `consent.adUserData`/`adPersonalization` on every upload. Meta `data_processing_options:["LDU"]` for opted-out or GPC visitors. Skip EEA/UK contacts who have no ads consent. Show sent / limited / skipped counts per connector | Legal risk plus lost signal | — | M | Hotfix |
| 3 | **Pixel consent modes:** `optout` (today's default), `required` (store and send nothing until `consent(true)`), `cookieless` (per-page ID). GPC honoured. Cookie lifetime 13 months, down from 2 years. Snippets for Cookiebot, CookieYes, Osano, Klaro and Google Consent Mode v2. Adds about 300 B, within the 5 KB budget | EU/UK sites need a real opt-in | — | S–M | Hotfix |
| 4 | **PII masking by role** (`contacts.pii` permission; viewer and client see `maskEmail()` output; reveal-on-click is audited) | Viewers and clients currently see raw emails on `/contacts` | HubSpot Enterprise, Freshsales Enterprise | S | A |
| 5 | **Split export permissions + API key scopes** (details in §2) | Any API key can download raw emails today | Pipedrive Ultimate (export alerts) | S–M | A |
| 6 | **TOTP 2FA + recovery codes + org-wide "Require 2FA"**, with an env/CLI break-glass for a locked-out owner | Absent today | Pipedrive Ultimate (enforcement), Twenty Pro | M | A |
| 7 | **Sessions:** list and revoke, "sign out everywhere", idle timeout (default 7 days) and max lifetime, new-device email | The sessions table has no IP, user agent or last-seen columns | Pipedrive Premium | S–M | A |
| 8 | **Audit log v2:** truncated IP and user agent, filters, CSV export, more events, **hash chain with a Verify button**, feed to webhook or syslog | Evidence for audits; supports verified reports | HubSpot, Attio, Twenty and Freshsales paid tiers; Salesforce +10% | M | A |
| 9 | **Security alerts** through existing notify channels (new event `security_alert`): bulk export, contact erasure, new API key, role change, 2FA disabled, login from a new device | Leak detection | Pipedrive Ultimate; Salesforce Shield | S | A |
| 10 | **Supply chain in CI:** Dependabot, CodeQL, dependency review, `pnpm audit`, Trivy image scan, SBOM + signed provenance, OpenSSF Scorecard, actions pinned by SHA | Credibility; CRA readiness | — | S | A |
| 11 | **`/.well-known/security.txt`** (RFC 9116), `SECURITY.md` response targets (3 working days to acknowledge, 10 to triage), `TRADEMARKS.md`, DCO | Low cost, high trust | — | S | A |
| 12 | **Security settings page + posture checklist:** 2FA coverage, key storage, HTTPS, backup profile, last audit verify | One place to harden an install | — | M | A |
| 13 | **Key management:** warn when the encryption key lives in `app_meta`; rotation via `APP_SECRET_PREVIOUS` with key IDs on ciphertext | Today the key can sit next to the data it encrypts | — | S | A |
| 14 | **NIST SP 800-63B-4 password policy:** 15 characters minimum (8 with 2FA), no complexity rules, common-password blocklist | Modern standard | Pipedrive Ultimate | S | A |
| 15 | **Privacy request inbox** (`privacy_requests`, due dates by jurisdiction: GDPR 1 month, CCPA 45 days, DPDP 90 days; one-click fulfilment through existing `eraseContact`/`exportContact`) | DSAR workflow | Matomo-level tooling | M | D |
| 16 | **Wider retention:** inactive contacts (erase or pseudonymise, with DPDP's 48-hour notice), raw lead payloads, AI reports; audit log kept at least 365 days. Stored in the existing retention `connections` row, so no migration | Data minimisation | — | S | D |
| 17 | **Compliance pack PDF**, generated from live configuration: GDPR Art. 30 record, recipients and sub-processors (from `connections`), privacy-policy paragraph, cookie table, DPIA starter, members and 2FA coverage, audit extract. Labelled "Draft, not legal advice" | New and free | Nobody | M | D |
| 18 | **Consent coverage report:** share of revenue whose journey had ads consent, per channel | Shows what consent costs in signal | Nobody | S | D |
| 19 | **OIDC SSO** (Google, Entra, Okta, Authentik, Keycloak): domain lock, just-in-time users, "Require SSO", owner break-glass | Agencies with staff | Twenty Org, Attio Pro, HubSpot Enterprise ("SSO tax") | M | D |
| 20 | **Passkeys (WebAuthn)**, offered only on HTTPS or localhost | Phishing-resistant | — | M | Later |
| 21 | IP allowlist with lockout protection; optional Postgres-backed rate limiter for multi-replica installs | Governance | Pipedrive Ultimate; Twenty $50k/yr | S–M | Later |
| 22 | Nonce-based CSP (drop `'unsafe-inline'` for scripts, via `src/proxy.ts`) | Hardening | — | M | Later |
| 23 | Opt-in backup profile (`docker compose --profile backup`, reusing the Postgres image, like the Caddy profile) | Stops data loss | — | S | Later |
| — | **Not building:** native SAML or SCIM (Node SAML libraries had 2025 signature-bypass CVEs; point people to an Authentik or Keycloak bridge); right-click or copy blocking (see §2.7) | | | | |

### 1.4 "Trust & Security" page outline

This lives on the docs/product site as `docs/SECURITY-OVERVIEW.md`, linked from the README. An in-app summary sits under Settings → Organization → Security.

1. **Your data stays in your database.** Open source (AGPL-3.0), self-hosted, with no AdLedger server in the loop. The only outbound calls are the ones you configure (ad platforms, revenue sources, your AI model, your notify channels), and they're listed live in Settings.
2. **Who is responsible for what.** The operator is the controller (and processor). One plain footnote: "We don't hold SOC 2 or ISO 27001. Those audit organisations running services. AdLedger's controls map to common SOC 2 criteria."
3. **Security built in, named precisely:** scrypt; hashed tokens; free 2FA, passkeys and OIDC SSO; five roles with PII masking; AES-256-GCM secrets with rotation; signed webhooks; SSRF guards; CSP; a tamper-evident audit log.
4. **Privacy by design:** hashing outside `contacts`; IP truncation; consent modes and GPC; consent-aware conversion uploads; access and erasure; request inbox; retention; compliance pack; local-model AI option; read-only MCP.
5. **Data you can't lose, and data that can't walk off:** exports and the backup profile; export permissions; watermarks and fingerprints; expiring share links; the download trail; why we don't block right-click.
6. **Supply chain:** tests including axe accessibility, Dependabot, CodeQL, SBOM and signed provenance, a Scorecard badge.
7. **Operator hardening checklist:** set `APP_SECRET`, use HTTPS (Caddy profile), require 2FA, enable backups, keep up to date.
8. **Reporting a vulnerability:** GitHub private reporting, 3/10 working-day response, safe harbour, `security.txt`.
9. **What it's not for:** health records, card data (Stripe holds it), children's data.
10. **Licence and name policy.**

---

## 2. Data-leak protection: decisions

The principle: **make leaks hard for honest mistakes, and traceable for deliberate ones.** No theatre.

### 2.1 Permissions (in `src/lib/permissions.ts`)

| Permission | Roles | Covers |
|---|---|---|
| `reports.view` (exists) | all 5 | Viewing aggregates on screen |
| `reports.pdf` (new) | all 5; client only while the org setting "Clients may download PDFs" is on (default **on**) | Branded aggregate PDFs. Contact-level sections are always masked |
| `reports.export` (exists, **narrowed**) | owner, admin, analyst | Aggregate CSVs (campaigns, channels, cohorts). **No longer covers contacts** |
| `contacts.pii` (new) | owner, admin, analyst | Seeing unmasked email and phone. Everyone else sees `p•••@gmail.com` |
| `contacts.export` (new) | owner, admin | Contact CSV with raw emails. Analysts get a hashed/masked export instead |
| `workspace.data` (exists) | owner, admin | Full workspace JSON export and erasure |
| `reports.share`, `reports.schedule` (new) | owner, admin, analyst | Share links and schedules |
| `security.manage` (new) | owner | 2FA/SSO policy, sessions of others, IP allowlist, export caps |

Agencies: a per-client toggle "Client sees contact details" (default **off**) lives on the membership.

### 2.2 API keys

- New columns `api_keys.scopes text[]`, `expires_at` and `last_used_ip_trunc`.
- **Scopes:** `reports:read`, `contacts:read` (masked), `contacts:pii`, `ingest:write`, `mcp`.
- **New keys** default to `reports:read`.
- **Existing keys** migrate to every scope except `contacts:pii`. From that release on, `api/v1/exports/contacts` returns masked or hashed emails unless the key carries `contacts:pii`, and the changelog says so.

### 2.3 Export log, caps and alerts

- New table `export_log`. Every CSV, PDF, workspace export, scheduled run and share-link PDF writes one row.
- **Caps:** non-owner contact exports are limited to **5,000 rows per user per day** by default, configurable by the owner. Beyond that the export needs the owner.
- **Reason field:** optional, off by default; the owner can require one.
- **Alert:** any contact export of more than 1,000 rows, and any workspace export, sends `security_alert` to the owner.

### 2.4 Watermarks and fingerprints

- **PDF, visible:**
  - Footer on every page: "Confidential · Prepared for {workspace} · {exporter name} · {date} · Export {short id}".
  - Metadata: title, author (the org), creator ("AdLedger"), language.
  - The fingerprint (SHA-256 of kind + params + `ReportData`) is printed and stored.
- **PDF encryption:**
  - Default is **off**. Permission flags are stripped trivially, and they break accessibility tools and legitimate client reuse.
  - "Protected" mode is opt-in per schedule or share link: owner-password permissions, `copying:false`, `printing:"highResolution"`, `contentAccessibility:true`. The UI states it is a deterrent, not real protection.
  - "Password" mode adds a user password that the recipient receives separately.
- **CSV:**
  - Export ID in the filename.
  - The file's SHA-256 is stored in `export_log`.
- **Identify a leaked file:** Settings → Security → drop a file. We hash it (and read the footer ID) and show who exported it, when, and with which filters.
- **Canary rows:** opt-in at org level, default **off**. When on, each contact CSV gets one unique synthetic contact tied to the export. If that address ever receives mail or appears in a list, the leak is proven. It stays off by default because it puts a fake row in data the owner hands to people.

### 2.5 Share links (BRIEF's `share_links`, `/share/[token]`)

- **Aggregates only.** Contact-level sections are never shareable, not even masked.
- **Token:** 256-bit, stored hashed like sessions.
- **Defaults:** expiry 30 days; frozen snapshot of the data by default ("live" is optional); filters locked (BRIEF); optional password (scrypt); optional max views; revocable; `noindex` + `X-Robots-Tag`; rate-limited; the same security headers as the dashboard.
- **View log:** every view and PDF download writes `audit()` with truncated IP.
- **Watermark:** the page shows "Shared by {org} · link expires {date}".
- **Optional ratios-only mode:** hides absolute money and shows only ROAS, POAS and percentages.

### 2.6 Client view settings

A per-client choice of which pages are visible, and whether spend and contact detail are shown. Stored on `memberships`.

### 2.7 What we will not build

We won't block right-click, text selection or screenshots, or add DevTools traps. View-source, extensions and OCR get around all of it, and it breaks accessibility and would fail our axe test gate. The Trust page says this openly.

---

## 3. Reports and PDF

### 3.1 Rendering approach: `@react-pdf/renderer` on the server, an in-house SVG chart kit, and a print stylesheet

**Decision:** react-pdf 4.9 renders every PDF (downloads, schedules, share links, the compliance pack). A print stylesheet makes Ctrl+P look right on every page. No Chromium.

**Why:**
- **Install simplicity.**
  - react-pdf is pure JS: it runs the same on Windows, glibc and Alpine musl.
  - node_modules grows by 34 MB (measured); the server image by roughly 10–30 MB; nothing reaches the browser.
  - Headless Chromium adds 105–170 MB to the image and 200–600 MB RAM per render, plus system fonts and a sandbox decision. That breaks "docker compose up just works". Gotenberg or Browserless would mean a new container, which the rules forbid.
- **Measured locally:** 3-page A4 with Geist fonts, a combo chart, an 80-row table split over pages, a fixed header and footer and "n / total" page numbers took **336 ms cold / 159 ms warm** and produced **35 KB**, encrypted.
- **Works headless inside `jobs.ts`,** so schedules need no browser pool.
- **Security features built in:** encryption, permissions, PDF/A (`conformance`), metadata. PDF/A and encryption rule each other out, so a schedule offers either "Archival" or "Protected".
- **Recharts can't render on the server (v3, issue #5997).** PDF charts are drawn with react-pdf `<Svg>` primitives by `src/lib/pdf/charts/`:
  - `scale.ts` with nice ticks, about 80 lines, no d3
  - `line`, `bars` (grouped, stacked, horizontal), `combo`, `donut`, `funnel`, `heatmap`, `waterfall`, `bullet`, `scatter`, `slope`, `sparkline`

  Web and PDF read the same `ReportData`, so the numbers are identical.

**Implementation rules:**
- `serverExternalPackages: ["@react-pdf/renderer"]` and `runtime = "nodejs"` on PDF routes.
- Fonts:
  - Register the static Geist TTFs (Regular, Medium, SemiBold, Bold), copied into `src/lib/pdf/fonts/` with the OFL licence, at module load.
  - Add **Noto Sans Devanagari** Regular and Bold (OFL, about 200 KB each) for Indian campaign names.
  - Currencies Geist lacks (₩ ₺ ₦) print their ISO code.
  - CJK and Arabic are a documented limitation in v1.
- `src/lib/pdf/theme.ts` holds light-theme hex equivalents of BRIEF's OKLCH tokens, plus the org accent colour.
- **Logos:** react-pdf takes only PNG or JPEG. Store `organizations.logo_png` (256 px) at upload time. For existing WebP logos, fall back to the org name as a wordmark until someone re-uploads.
- **CPU guard:** an in-process semaphore allows 2 concurrent renders, with a small queue and then 429. Scheduled renders run one at a time. Move to `worker_threads` only if profiling demands it.
- **Tables:** rows use `wrap={false}` with a repeated `fixed` header. Tables are capped at the top 25 rows plus "and N more, see CSV". Don't use `minPresenceAhead`: it has known loop bugs.
- **Never pass unescaped user strings into SVG attributes.** CVE-2026-94545 was the same bug class in Satori.
- **Routes:**
  - `GET /api/v1/reports/{kind}/pdf?start&end&model&compare`. Session: `reports.pdf`. API key: `reports:read` scope.
  - Responses send `Cache-Control: private, no-store`.
  - Each download writes `export_log` and `audit()`, with IDs only.

### 3.2 Report catalog

- **Registry:** `src/lib/report-kinds/`, built like the connector registry. Each kind declares:
  - meta
  - its sections
  - a `load(db, ws, params)` that calls only `reports*.ts`
- **Methodology appendix on every report:** model and window, unattributed share, excluded currencies, last sync per platform, pixel coverage, CAPI success rate.
- **Page size:** A4 or Letter by workspace locale.
- **"Needs" column:** anything other than "exists" is new data or SQL.

| # | Report | Audience | Key sections | Needs | Phase |
|---|---|---|---|---|---|
| 1 | **Executive summary** (1 page) | Founder, client exec | 6 KPI tiles with Δ + sparkline, spend-vs-revenue combo, top/bottom 3 campaigns, 3-bullet AI summary (numbers verified), goal bullets | exists (+ BRIEF `goals`) | B |
| 2 | **Weekly performance** | Team, client | WoW KPI grid, daily combo with annotations, channel donut, campaign table, wasted-spend callout, AI "what changed / why / next" | exists | B |
| 3 | **Monthly client report** (white-label) | Agency client | Branded cover, exec page, goals and pacing, platform bars, campaign deep dive, commentary blocks, annotations timeline, next month's plan, appendix | 1 + 2 + notes | C |
| 4 | Channel & platform mix | Marketer | 100% stacked spend and revenue by platform, platform table incl. NC-ROAS, paid vs organic trend | SQL | D |
| 5 | Campaign deep dive | Media buyer | KPIs, trend, ad set → ad table, spend-vs-ROAS quadrant, CTR/CPC/CPM trend, starter/closer role | SQL (campaign filter) | D |
| 6 | Creative leaderboard | Creative team | Revenue by ad, fatigue flag, thumbnails when BRIEF Phase 5 creative sync lands | BRIEF P5 | D |
| 7 | **Attribution model comparison** | Founder, analyst | Slope chart first → last, table across all models, starters vs closers | exists | B |
| 8 | **LTV & cohorts** (landscape) | SaaS, subscription | Cohort heatmap, LTV curves, LTV:CAC by channel, payback table | exists + payback SQL | B |
| 9 | Funnel | Growth | Visit → lead → customer bars with step %, by platform, time to convert | SQL (+ `traffic_daily` for long ranges) | D |
| 10 | **Wasted spend & budget moves** | Founder, buyer | Waste table, cumulative waste, "move ₹X from B to A" as a range with stated assumptions, "too early" exclusions | exists + time-to-money | B |
| 11 | **Ad profit P&L** | Founder, finance | Waterfall (revenue → refunds → COGS → fees → shipping → ad spend → contribution), POAS by platform, break-even line | unit-economics setting | C |
| 12 | **Truth report** (platform claims vs verified) | Founder, sceptical client | Claimed vs verified conversions and value per platform, over-claim ratio bars, why they differ | `platform_conversion_value_minor` column | B |
| 13 | Lead source & quality | Lead-gen, local business | Leads by source/form, lead → customer rate, revenue per lead, speed to lead, value score distribution | CRM data | D |
| 14 | **Customer quality by ad** | E-com, SaaS | New vs returning, NC-ROAS, refund rate and repeat rate per acquiring ad, 90-day LTV | SQL | C |
| 15 | **Agency portfolio roll-up** | Agency owner | One row per client: spend, revenue, ROAS, MoM Δ, goal status, sync health, alerts | loop over accessible workspaces | C |
| 16 | **Single customer dossier** | Owner, DSAR | Ad receipt + journey + payments (reuses the subject-access export); needs `contacts.pii` | receipts | C |
| 17 | **Compliance pack** | Owner, DPO | See §1.3 #17 | config | D |

**Section types for the custom builder (Phase D):** `kpis`, `combo_chart`, `line_chart`, `bar_chart`, `donut`, `table`, `funnel`, `cohort_heatmap`, `waterfall`, `goals`, `annotations`, `note` (Markdown subset), `ai_summary`, `methodology`, `page_break`.

- Templates are **per workspace**, with "Copy to all client workspaces". There are no org-wide templates, so no new schema-test exemption.
- Sections reorder with up/down buttons; the dnd-kit drag from BRIEF is optional.

### 3.3 Scheduling and delivery

This replaces BRIEF Phase 6's "Scheduled digests" item, using the same table name.

- **Schedule options** (`report_schedules`):
  - cadence: weekly, monthly or quarterly, at an hour in the workspace timezone
  - period rule: last week, last month, MTD or last 30 days
  - compare: previous period or previous year
  - channels: any configured `notify_*` connection
  - conditional send: "only if spend > 0", "only if ROAS moved ±20%"
- **Runner:** a `report-schedules` job in `jobs.ts`, hourly, under an advisory lock. It renders, writes `export_log`, then delivers.
- **Email:**
  - Add `attachments?: {filename, content: Buffer, contentType}[]` to `NotificationMessage`; the email driver passes them to nodemailer.
  - Body: a KPI table in HTML, the AI summary and an "Open live report" share link.
  - Attachments stay under 10 MB; typical reports are 50–300 KB.
- **Slack, Teams, Discord, webhook:** a summary plus an expiring share link, because incoming webhooks can't upload files.
- **Delivery history:** read from `export_log`: status, recipient count, bytes, SHA-256, error. The PDF itself is kept (≤ 5 MB) for 90 days through the retention job.

### 3.4 White-label (free; AgencyAnalytics charges $59–349/mo)

- **Settings → Organization → Branding:** logo (exists) plus `logo_png`, accent colour, report footer text, cover style, and a free "Hide *Powered by AdLedger*" toggle.
- **Per-client cover page:** uses the client workspace name and an optional client logo.
- **Sender name:** comes from the email connection.
- **Not doing:** custom domains. The self-hoster already owns the domain.

### 3.5 Verified numbers (signature #5)

- **Footer line:** "All figures computed by SQL from your ledger · AI narrative checked: 0 unverified numbers · Fingerprint 7f3a…".
- **`/verify`:** for signed-in users, or holders of a share token. Paste a fingerprint or drop the PDF, and it confirms whether the fingerprint matches a real `export_log` row on this instance.
- **Audit chain head:** the PDF also prints the current audit hash-chain head.

---

## 4. Metrics: top 25

- **Formulas:** all computed in SQL, in the reporting currency, as `*_minor` integers. Ratios are SQL `numeric`, formatted only in the UI.
- **"Spend":** Σ `ad_insights_daily.spend_minor` for the range, including `platform='other'` rows.
- **"Credits":** `attribution_credits` for the selected model.
- **Data flags:**
  - ✅ SQL on today's schema
  - ⚙️ needs a workspace setting (`connections` row, no migration)
  - 🆕 needs a migration

**Widget A: "Money in, money out"** (Overview pinned strip)

| # | Metric | Formula | Data |
|---|---|---|---|
| 1 | Ad spend | Σ spend | ✅ shipped |
| 2 | Net revenue | Σ `revenue_events.amount_minor` (payments + refunds; refunds are stored negative) | ✅ shipped |
| 3 | **MER** (rename "blended ROAS") | net revenue ÷ spend | ✅ shipped, relabel |
| 4 | Attributed ROAS + break-even line | Σ credited revenue ÷ spend; break-even ROAS = 1 ÷ gross margin % | ✅ + ⚙️ for the line |
| 5 | **POAS** / contribution profit | contribution = net revenue × margin% − (fee% × gross payments + fee_fixed × orders) − shipping; POAS = contribution ÷ spend (break-even 1.0); profit after ads = contribution − spend | ⚙️ `unit_economics` |
| 6 | Blended CAC (nCAC) | spend ÷ contacts whose first payment falls in range (any channel) | ✅ |

**Widget B: "Acquisition efficiency"** (Performance columns + quadrant)

| # | Metric | Formula | Data |
|---|---|---|---|
| 7 | CPM | spend ÷ impressions × 1,000 | ✅ |
| 8 | CTR | clicks ÷ impressions | ✅ shipped |
| 9 | CPC | spend ÷ clicks | ✅ |
| 10 | CPL | paid spend ÷ Σ lead credits on paid touchpoints | ✅ shipped |
| 11 | Paid CAC | paid spend ÷ Σ customer credits on paid touchpoints | ✅ shipped |
| 12 | **NC-ROAS** | credited revenue of each contact's *first* payment ÷ spend | ✅ (BRIEF's optional `revenue_events.is_first_payment` speeds it up) |

**Widget C: "Funnel"** (Attribution → Time to convert, Reports 9)

| # | Metric | Formula | Data |
|---|---|---|---|
| 13 | Visit → lead CVR | leads ÷ distinct visitors with events | ✅ within raw-event retention; 🆕 `traffic_daily` roll-up for longer history |
| 14 | Lead → customer CVR | leads (cohorted by lead month) whose contact paid within the attribution window ÷ leads | ✅ |
| 15 | Time to convert (median, p80, histogram) | first payment − first touch; also lead → first payment | ✅ |
| 16 | Lead velocity rate | (leads this month − last month) ÷ last month | ✅ |

**Widget D: "Revenue quality"**

| # | Metric | Formula | Data |
|---|---|---|---|
| 17 | AOV | Σ payments ÷ count(payments) | ✅ |
| 18 | New vs returning revenue | first-payment revenue vs later payments (share of net revenue) | ✅ |
| 19 | Refund rate | abs(Σ refunds) ÷ Σ payments | ✅ |

**Widget E: "Retention & LTV"** (Customers)

| # | Metric | Formula | Data |
|---|---|---|---|
| 20 | Cohort retention heatmap | cohort customers with ≥ 1 payment in month k ÷ cohort size | ✅ (add `count(distinct contact_id)` to `ltv()`) |
| 21 | LTV:CAC by channel | cumulative net revenue per customer ÷ CAC of the acquiring channel | ✅ shipped |
| 22 | CAC payback (months) | first month k where cumulative revenue per customer (× margin when set) ≥ cohort CAC | ✅ revenue payback; ⚙️ margin payback |
| 23 | Repeat purchase rate | customers with ≥ 2 payments ÷ customers | ✅ |

**Widget F: "Can I trust these numbers?"** (Data health; BRIEF Settings → Data)

| # | Metric | Formula | Data |
|---|---|---|---|
| 24 | Unattributed share + identity coverage | unattributed revenue ÷ revenue; revenue events with `contact_id` ÷ all revenue events | ✅ shipped + ✅ |
| 25 | **Platform over-claim ratio** | Σ `platform_conversions` ÷ AdLedger-verified conversions (same platform and range); value variant = Σ platform conversion value ÷ credited revenue | ✅ count; 🆕 `ad_insights_daily.platform_conversion_value_minor` for value |

**Summary:** 22 of the 25 need no migration.

**Charts:**
- Recharts 3.8 covers every chart on the web: combo, scatter + `ZAxis` quadrant, waterfall (range bars), funnel as horizontal bars, bullet graphs for pacing, Sankey after a "top paths" list.
- The cohort heatmap is an HTML `<table>` with `color-mix()` cells: accessible and printable.
- No dual axes; ROAS goes in its own small multiple.

**Next tier (after migrations):** frequency, hook rate and hold rate (reach and video columns); budget pacing (BRIEF `goals`); MRR, NRR and churn (a `subscriptions` table, deferred); win rate and velocity (after pipeline stages); lead response time (after BRIEF tasks).

**Also in Data health (signature support):**
- **Signal Quality score** per platform: share of uploads carrying email, phone, fbc/fbp, IP and user agent. Needs 🆕 `conversion_uploads.match_keys jsonb`.
- CAPI delivery rate
- sync freshness
- paid-touchpoint ad-match rate, plus a "UTM doctor" listing top unmatched `utm_campaign` values

---

## 5. CRM features ranked

BRIEF already schedules notes, tasks, tags, owner, pipeline stages and kanban, saved views and segments, CSV import, and dedupe/merge. They are listed here only so the ranking is complete. Value: H/M/L. **FREE★** = paid tier elsewhere, free here.

| Rank | Feature | Value | Effort | Paid elsewhere → free here | Where |
|---|---|---|---|---|---|
| 1 | Notes + unified timeline | H | S | table stakes | BRIEF P3 |
| 2 | Tasks + My tasks + `task_due` notify | H | S–M | table stakes (G2's #1 buying theme) | BRIEF P3 |
| 3 | Pipeline stages + kanban + cost per stage | H | L | FREE★ multiple pipelines: HubSpot Starter+ | BRIEF P4 |
| 4 | Saved views / segments | H | M | FREE★ Attio/folk tiers | BRIEF P2–4 |
| 5 | **Ad-to-cash receipt:** per-customer ad cost + payback on the record | H | M | FREE★ nobody does it per record | **Addendum C** |
| 6 | **Revenue-trained lead value score** with reasons. Replaces BRIEF's engagement score as the headline; engagement stays as a secondary signal | H | M | FREE★ Pipedrive Premium $49, Freshsales Pro $39, HubSpot Enterprise predictive | **Addendum C** |
| 7 | **More attribution models:** time-decay, U-shaped 40/20/40, W-shaped, ad-only last click | H | S–M | FREE★ HubSpot Marketing Hub Enterprise only | **Addendum C** (pulled forward from BRIEF P6 "optional") |
| 8 | PII masking by role + reveal log | H | S | FREE★ HubSpot Enterprise Sensitive Data | **Addendum A** |
| 9 | Audit v2 + export and security alerts | H | S–M | FREE★ Pipedrive Ultimate; Salesforce Shield +10% | **Addendum A** |
| 10 | PDF + scheduled white-label reports | H | M | FREE★ AgencyAnalytics $59–349/mo | **Addendum B** |
| 11 | 2FA + enforcement | H | M | FREE★ Pipedrive Ultimate | **Addendum A** |
| 12 | Dedupe & merge (suggested, manual, reversible) | M–H | M | FREE★ HubSpot Pro / Data Hub | BRIEF P4 (add a `contact_merges` snapshot for undo) |
| 13 | **Manual "Mark as won" sale + offline/phone CSV matching** on phone hash | M–H | S | FREE★ call tracking $50–195/mo | **Addendum C** |
| 14 | **Booking attribution:** Cal.com / Calendly webhooks as `LeadConnector`s; conversion type `booking`; "Cost per booked call" | M–H | S–M | FREE★ Hyros call tracking | **Addendum D** |
| 15 | **Custom fields** (contact; typed; `pii` flag; lead-webhook mapping) | M–H | M | FREE★ HubSpot Free capped at 10 | **Addendum D** |
| 16 | **Speed-to-lead leak report:** time from lead to first human action (task, note, stage change) per campaign and owner, with the revenue gap between < 1 h and > 24 h | M–H | S (after tasks) | FREE★ nobody ties it to ad cost | **Addendum D** |
| 17 | **Companies** (grouped by email domain; free-mail excluded) + free local enrichment (free-mail flag, country from phone prefix, device and geo from first touch) | M | M | FREE★ folk/Pipedrive enrichment credits | **Addendum D** |
| 18 | **Hosted/embeddable forms** with built-in attribution (`/f/{id}`, lazy-loaded by the pixel) | M | M | FREE★ HubSpot branding on Free; Zoho Standard | **Addendum D** |
| 19 | **Automation rules v1:** 5 triggers (new lead, new customer, stage change, score ≥ N, refund) × 6 actions (assign owner, create task, move stage, notify, webhook, tag); idempotent; runs in `jobs.ts` | M–H | M (v1) | FREE★ HubSpot Pro, Pipedrive Growth, Close Growth | **Addendum D** |
| 20 | AI record brief ("Summarize", "Draft follow-up"; facts from `journey()`; MCP `contact_brief`, read-only and masked) | M | S–M | FREE★ HubSpot Breeze credits, Freddy $49/100 sessions | **Addendum D** (alongside BRIEF P6 Ask) |
| 21 | OIDC SSO | M | M | FREE★ the "SSO tax" | **Addendum D** |
| 22 | AI-assistant channel (`claude.ai`, `chatgpt.com`, `perplexity.ai`, `gemini.google.com`, `copilot.microsoft.com` split out of organic search) | M | S | new | **Hotfix lane** |
| 23 | `ctwa_clid` capture from WhatsApp referrals + Conversions API for Business Messaging | M–H (India) | M | FREE★ | **Addendum D** |

**Deferred:**
- A separate `deals` table (multiple deals per contact). BRIEF's contact-stage pipeline covers v1; revisit on B2B demand.
- Subscriptions (MRR, NRR).

**Not building:** email sequences and open tracking; quotes and invoices; a shared WhatsApp/SMS inbox; native mobile apps (PWA only); sandboxes.

---

## 6. Signature features: top 5

One-line positioning:
> **AdLedger: every sale gets a receipt. See which ad earned it, what it really made you, and prove it, on your own server, free forever.**

| # | Feature | One-line positioning | Built from | Phase |
|---|---|---|---|---|
| 1 | **Ad Receipts** | "Every payment shows which ads earned it, what that customer cost, and when they paid it back." | `attribution_credits` + `touchpoints` + `ad_insights_daily`. Cost = Σ credit share × (spend ÷ clicks) for that ad and day, split with `allocate()`; unmatched spend goes to an "unallocated" line so totals reconcile. Contact Receipt tab, payment drawer, dossier PDF, MCP `get_ad_receipt` | C |
| 2 | **Truth Gap** | "Meta says 212 sales, your bank saw 118. See every platform's over-claim, reconciled to real payments." | `platform_conversions` (exists) + new `platform_conversion_value_minor`. Overview widget, Performance column pair, Truth report | B |
| 3 | **Profit Ledger** | "Stop optimising ROAS. See profit per ad after refunds, fees and COGS, plus which ads bring buyers who refund." | `unit_economics` setting, POAS, P&L waterfall, customer quality by ad; optional "send profit as CAPI value" (default off) | C |
| 4 | **Time-to-Money guardrails** | "Don't kill an ad that hasn't paid out yet. Per-campaign payback lag, 'too early' badges, and pause drafts that never act on their own." | Lag distribution (median/p80) per campaign; a "too early" badge on waste alerts and BRIEF's Insights action cards; a draft pause as a deep link plus a Meta/Google Editor bulk CSV. No write scopes; API write-back later, paused/draft only and confirmed | C |
| 5 | **Verified Reports** | "White-label client reports whose numbers anyone can verify. Fingerprinted, watermarked, backed by a tamper-evident audit log." | react-pdf reports, `/verify`, `export_log`, audit hash chain, share links; later an opt-in public "Proof of ROAS" badge (ratios only) as the growth loop | B (+ chain in A) |

**Supporting cast (not headline):**
- **No SSO tax:** 2FA, SSO, audit log, masking and export alerts, all free.
- **Consent-aware attribution:** the only free attribution tool that sends consent signals correctly.
- **Private AI analyst:** BRIEF P6 Ask, local model allowed, numbers verified.

---

## 7. Phased plan (after BRIEF Phase 1)

**The hotfix lane runs any time.** It touches only `src/lib/capi/*`, `pixel/al.ts`, `src/lib/tracking/utm.ts` and the connector dialogs, none of which are BRIEF Phase 1 files.

**Hotfix lane scope:**
- Google Data Manager API migration (mock mode updated to the new API format)
- consent-aware uploads + GPC
- pixel consent modes + 13-month cookie
- AI-assistant channel

**Schema:**
- `visitors.consent text` (`granted` | `denied` | `unknown`), `visitors.gpc boolean`
- `contacts.ads_consent text`
- `conversion_uploads.skip_reason text`, `consent_mode text`, `match_keys jsonb`

**Acceptance:**
- In mock mode, a Google upload hits the Data Manager endpoint shape with `consent` set.
- A GPC visitor's Meta upload carries `LDU`.
- An EEA contact with `ads_consent='denied'` is skipped with a `skip_reason`.
- The pixel in `required` mode sets no cookie or storage and sends nothing before `consent(true)` (e2e).
- Pixel stays < 5 KB gzipped.
- A `chatgpt.com` referral lands in channel `ai_assistant`.

### Mapping to BRIEF

| Addendum phase | Starts after | Runs in parallel with | Replaces in BRIEF |
|---|---|---|---|
| A: Trust core | BRIEF P1 | BRIEF P2 and P3 (different files: `permissions.ts`, `auth.ts`, `security/`, settings pages) | — |
| B: Reports & PDF | BRIEF P2 metrics (needs the metric registry and new metrics) | BRIEF P3 and P4 | BRIEF P6 "Scheduled digests" and "Share links" (pulled forward, same tables) |
| C: Money truth | BRIEF P3 (record page) + Addendum B (PDF kit) | BRIEF P4 and P5 | BRIEF P6 "Optional extra attribution models" (made firm) |
| D: CRM plus & governance | BRIEF P4 (pipeline, tasks) | BRIEF P5 and P6 | — |

Schema-changing branches still merge one at a time (BRIEF rule 2).

### Phase A: Trust core (≈ 2 weeks)

**Scope:**
- `contacts.pii` masking + reveal audit
- permission split (§2.1) + API key scopes
- `export_log` + CSV fingerprints + caps + `security_alert`
- TOTP 2FA + recovery codes + Require 2FA + break-glass
- sessions list/revoke/idle timeout
- audit log v2 + hash chain + Verify + CSV export
- NIST password policy
- key-storage warning + rotation
- Security settings page + posture checklist
- `security.txt`, `SECURITY.md`, `TRADEMARKS.md`, DCO, CI supply chain
- `docs/SECURITY-OVERVIEW.md` (the Trust page)

**Schema:**
- `users`: `totp_secret_enc text`, `totp_enabled_at timestamptz`, `recovery_codes text[]` (scrypt hashes). The `users` table is exempt from the workspace_id test.
- `organizations`: `security jsonb` (zod: `require2fa`, `sessionIdleMinutes`, `exportRowCap`, `requireExportReason`, `clientsCanDownloadPdf`, `canaryRows`).
- `memberships`: `client_view jsonb` (pages, showSpend, showContacts).
- `sessions`: `ip_trunc text`, `user_agent text`, `last_seen_at timestamptz`, `auth_method text`.
- `api_keys`: `scopes text[] not null default '{reports:read}'`, `expires_at`, `last_used_ip_trunc`. The data migration gives existing keys every scope except `contacts:pii`.
- `audit_log`: `ip_trunc`, `user_agent`, `seq bigint`, `prev_hash text`, `hash text`. The chain is per organization. Inserts take `pg_advisory_xact_lock(org)` in `audit()`, and a backfill hashes existing rows at migration.
- New `export_log` (workspace_id, actor_user_id, api_key_id, share_link_id, schedule_id, kind, report_kind, params jsonb, rows, bytes, sha256, fingerprint, canary_hash, status, error, file bytea null, created_at).

**Deps:** `uqr` (QR codes, 79 KB, zero dependencies). TOTP is written on `node:crypto`.

**Acceptance:**
- A viewer and a client see masked emails on `/contacts`, the record page and the preview sheet. An analyst's reveal writes `contact.pii_revealed` (e2e + unit).
- An API key without `contacts:pii` gets masked emails from `/api/v1/exports/contacts`. A new key defaults to `reports:read` (test).
- An analyst's contact export is hashed/masked. A 6,000-row export by an admin is blocked at the default cap. A 1,500-row export fires `security_alert` in mock notify.
- Enabling 2FA then logging in requires a TOTP code. A replayed code is rejected. A recovery code works once. With "Require 2FA" on, a user without 2FA is forced to enrol. `ADLEDGER_BREAK_GLASS` resets an owner's 2FA.
- "Sign out everywhere" invalidates other sessions. An idle session past its timeout redirects to login.
- Editing an `audit_log` row by hand makes Verify report the first broken `seq`.
- `/.well-known/security.txt` has `Contact` and `Expires`. CI runs CodeQL, dependency review and Trivy, and publishes an SBOM on release.
- axe passes on all new settings pages at 375 px. `pnpm lint`, `typecheck` and `test` are green.

### Phase B: Reports & PDF (≈ 2–3 weeks)

**Scope:**
- print stylesheet (BRIEF's `globals.css` gets an additive `@media print` block)
- `@react-pdf/renderer` + chart kit + theme/fonts + `logo_png`
- report-kind registry with kinds 1, 2, 7, 8, 10, 12 + methodology appendix
- PDF route + Download buttons in BRIEF's `PageHeader`
- watermark footer + fingerprint + `/verify`
- `report_schedules` + job + email attachments + conditional sends
- `share_links` (§2.5) at `/share/[token]` with a PDF download
- branding settings
- Truth Gap widget + Performance column pair
- time-to-money SQL (for kind 10's "too early")

**Schema:**
- `organizations`: `branding jsonb` (accent, footer, coverStyle, hidePoweredBy), `logo_png bytea`
- `ad_insights_daily`: `platform_conversion_value_minor bigint null`. Meta `action_values`, Google `conversions_value` and TikTok value are mapped in connectors and mock mode.
- `report_schedules` (workspace_id, name, report_kind, params jsonb, cadence jsonb, period_rule, compare, recipients jsonb {userIds, connectionIds}, external_recipients_enc text null, protect text, password_enc text null, condition jsonb, enabled, last_run_at, next_run_at, created_by)
- `share_links` (workspace_id, token_hash, report_kind or view ref, params jsonb, locked_filters jsonb, snapshot jsonb null, ratios_only bool, password_hash, max_views, view_count, expires_at, revoked_at, last_viewed_at, created_by)

**Deps:** `@react-pdf/renderer` 4.9 (server only, via `serverExternalPackages`).

**Acceptance:**
- Each of the 6 kinds renders from demo data in < 1.5 s. The text extracted from each PDF contains no raw email (test). Fonts are embedded. Page count > 0.
- Every number in a PDF equals the matching `reports*.ts` output: the same `ReportData` object is snapshot-tested.
- The Docker image grows by ≤ 40 MB. `docker compose up -d` needs no new env var. A PDF renders in the PGlite single-container trial.
- A weekly schedule in mock mode sends one email with the PDF attached and writes an `export_log` row with its SHA-256. Slack gets a summary + share link. A conditional schedule with spend 0 sends nothing.
- A share link:
  - expires on time
  - can't remove its locked filters
  - never exposes a contact section
  - counts views
  - is `noindex`
  - works in snapshot mode after the data changes
  - returns 404 once revoked
- `/verify` accepts a genuine PDF's fingerprint and rejects an edited one.
- The Truth Gap shows Meta's claimed-vs-verified numbers in mock mode.
- Ctrl+P on Overview prints without sidebar or controls, in light colours.

### Phase C: Money truth (≈ 2–3 weeks)

**Scope:**
- **Ad Receipts:** contact Receipt tab in BRIEF's record page, payment drawer, payback, MCP `get_ad_receipt` (read-only, masked)
- **Profit Ledger:** Settings → Workspace → Profit settings, POAS/contribution in the metric registry, P&L waterfall, customer quality by ad, optional profit-as-CAPI-value
- **Time-to-Money:** lag columns, "too early" badges on waste alerts and Insights cards, draft pause (deep link + bulk CSV)
- **Revenue-trained lead value score:** nightly job; stored on `contact_stats`
- time-decay, U-shaped and W-shaped models
- manual "Mark as won" + offline CSV matching
- report kinds 3, 11, 14, 15, 16

**Schema:**
- `contact_stats` (BRIEF P3): `acq_cost_minor bigint`, `payback_days int`, `value_score_minor bigint`, `score_reasons jsonb`, `scored_at timestamptz`
- `attribution_credits.model` gains `time_decay`, `u_shaped`, `w_shaped`, `ad_last_click` (enum or text + recompute)
- `revenue_events.source` accepts `manual`
- the unit-economics setting is a `connections` row with provider `unit_economics`, config `{grossMarginPct, feePct, feeFixedMinor, shippingPerOrderMinor, sendProfitToCapi}`, following the retention precedent, so no migration

**Acceptance:**
- For demo data, Σ per-customer `acq_cost_minor` + unallocated spend = total spend, to the minor unit (test).
- A receipt's per-ad amounts sum to the payment under every model.
- POAS on the waterfall equals the Performance column and the PDF (test). Break-even ROAS draws at 1 ÷ margin.
- A campaign younger than its p80 lag shows "too early" and is excluded from waste alerts. The draft pause CSV imports into Meta Ads Manager's bulk format; the fixture is validated.
- The lead score is reproducible from SQL. Reasons list the top 3 lifts. With fewer than 30 historical conversions it shows "not enough history" instead of a score.
- The new models' credits sum to 1 per conversion (test), and the model comparison shows all of them.
- A manual sale needs `guard("workspace.settings")`, writes `audit()` and is attributed on the next run.

### Phase D: CRM plus & governance (≈ 3 weeks)

**Scope:**
- custom fields
- companies + local enrichment
- hosted forms
- booking attribution (Cal.com, Calendly)
- `ctwa_clid` + business-messaging CAPI
- automation rules v1
- speed-to-lead report
- AI record brief
- OIDC SSO
- privacy request inbox + wider retention + compliance pack PDF + consent coverage report
- custom report builder + per-workspace templates
- report kinds 4, 5, 6, 9, 13, 17
- `traffic_daily` roll-up

**Schema:**
- `field_definitions` (workspace_id, entity, key, label, type, options jsonb, pii bool); `contacts.custom jsonb`
- `companies` (workspace_id, domain, name); `contacts.company_id`
- `forms` (workspace_id, name, fields jsonb, redirect_url, notify jsonb)
- `automations` (workspace_id, trigger jsonb, conditions jsonb, actions jsonb, enabled, runs, last_error); `automation_runs` (workspace_id, automation_id, entity_id, unique on (automation_id, entity_id, trigger_key))
- `privacy_requests` (workspace_id, type, jurisdiction, subject_email_hash, contact_id, status, due_at, verified_at, fulfilled_at)
- `report_templates` (workspace_id, name, kind, definition jsonb, created_by)
- `traffic_daily` (workspace_id, date, channel, platform, campaign_id, visitors, sessions, page_views), filled by the daily job before retention deletes events
- `leads.source` accepts `booking` and `form`
- SSO config lives in `organizations.security` (client secret encrypted via `crypto.ts`)

**Deps:** `openid-client` (server only).

**Acceptance:**
- A custom field marked `pii` is masked for viewers and excluded from MCP and AI.
- A hosted form submission creates a lead carrying visitor ID, UTMs and click IDs.
- A Calendly webhook in mock mode yields a `booking` conversion and a "Cost per booked call" column.
- An automation "new Meta lead → task for owner in 1 h" fires exactly once per lead, including across a restart (idempotency test).
- The speed-to-lead report matches a direct SQL check.
- SSO login against a mock OIDC issuer creates a just-in-time user. "Require SSO" blocks password login except the owner's break-glass.
- An erasure request created in the inbox gets the right due date per jurisdiction, and fulfilment calls `eraseContact` and writes `audit()`.
- The compliance pack lists every configured connection as a recipient and carries the "Draft, not legal advice" label.
- A template copied to 3 client workspaces renders in each.

---

## 8. Owner decisions (max 5, with recommended defaults)

| # | Decision | Recommended default | Why |
|---|---|---|---|
| D1 | **Is a paid hosted or support offering planned?** It decides DCO vs CLA, whether the CRA's manufacturer rules may apply, and whether SOC 2 ever matters. | **No for now: DCO + AGPL-3.0 + `TRADEMARKS.md`, and run a clearance check on the "AdLedger" name before launch marketing.** | Keeps the project simple and honest. A CLA can only be introduced before outside contributions arrive, so decide within the next month if paid plans are likely. |
| D2 | **Client (agency) access to contact data and PDFs.** | **Contacts masked for clients by default, with a per-client toggle. Aggregate PDFs allowed by default. Share links carry aggregates only, never contacts.** | Branded client PDFs are the core agency use case; contact PII is the leak risk. |
| D3 | **Scheduled reports to people outside the team.** External recipient emails would be stored outside `contacts`/`users`, which bends the PII rule. | **Allow them, encrypted with AES-GCM (`external_recipients_enc`), never logged, and listed in the compliance pack.** Members and notify connections stay the primary recipients. | Agencies must email clients who aren't members; encryption keeps the spirit of the rule. |
| D4 | **Default pixel consent mode.** | **Keep `optout` globally. Onboarding asks "Do you have visitors from the EU/UK?" and a yes switches to `required`. GPC is always honoured. The cookie lifetime drops to 13 months for everyone.** | Doesn't break existing US/India installs, and puts EU installs on the legal path by default. |
| D5 | **New dependencies:** `@react-pdf/renderer` (Phase B, about 34 MB node_modules, server only), `uqr` (Phase A, 79 KB, QR codes for 2FA), `openid-client` (Phase D, SSO). | **Approve all three.** No Chromium, and no new services or containers. | Each replaces far heavier options (Chromium ~110–170 MB) or hand-rolled crypto-adjacent code (OIDC). `@dnd-kit` is already covered by BRIEF's decision 1. |
