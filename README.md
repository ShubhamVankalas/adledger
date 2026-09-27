<div align="center">

<img src="public/icon.svg" width="72" alt="AdLedger logo" />

# AdLedger

### Every sale gets a receipt.

**See which ad actually made you money, what that customer really cost, and prove it.**<br />
Open-source, self-hosted ad attribution and revenue ledger with a built-in CRM.

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-0f766e)](LICENSE)
[![CI](https://github.com/ShubhamVankalas/adledger/actions/workflows/ci.yml/badge.svg)](https://github.com/ShubhamVankalas/adledger/actions/workflows/ci.yml)
[![Docker image](https://img.shields.io/badge/ghcr.io-shubhamvankalas%2Fadledger-2496ED?logo=docker&logoColor=white)](https://github.com/ShubhamVankalas/adledger/pkgs/container/adledger)
[![Self-hosted](https://img.shields.io/badge/self--hosted-your%20server%2C%20your%20data-111827)](docs/SELF_HOSTING.md)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-16a34a)](CONTRIBUTING.md)

[Quick start](#quick-start) · [Features](#features) · [Screenshots](#screenshots) · [Security](#security-and-compliance) · [Docs](#documentation) · [Roadmap](docs/ROADMAP.md) · [Website](https://shubhamvankalas.github.io/adledger/)

<br />

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/overview-dark.png" />
  <img src="docs/screenshots/overview.png" alt="AdLedger Overview: a briefing line naming the most profitable campaign, KPI tiles for revenue, ad spend, ROAS, MER, customers and unattributed share, and a revenue chart against the previous period" width="920" />
</picture>

</div>

---

AdLedger joins **ad spend** (Meta, Google and 7 more networks), **first-party website events** from
a 2.4 KB pixel, **leads**, and **real payments** (Stripe and 12 more) into one ledger. Every number
is computed in SQL from that ledger, split to the cent, and shown per campaign, ad set and ad. It
runs as one container plus PostgreSQL on a server you control.

## Why AdLedger

|   |   |
|---|---|
| **A free alternative to Hyros, Triple Whale, Cometly and Northbeam.** No per-seat or revenue-share pricing. Unlimited users, workspaces and client logins. | **Your data never leaves your server.** No telemetry, no licence check, no phone-home. The only outbound calls are the integrations you switch on. |
| **One command to install.** `docker compose up -d`, or a one-line script with automatic HTTPS. Migrations run on start; everything else is configured in the dashboard. | **Bring your own AI, or none.** Local Ollama or LM Studio, OpenAI, Anthropic, Gemini, OpenRouter, DeepSeek. The model writes words; SQL writes the numbers. |

## Quick start

**Try it with demo data in about a minute.** You need [Docker](https://docs.docker.com/get-docker/).

```bash
git clone https://github.com/ShubhamVankalas/adledger.git && cd adledger
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=adledger-demo-123 DEMO_DATA=true docker compose up -d
```

Open **http://localhost:3000** and sign in. You get 90 days of realistic Meta, Google, TikTok,
LinkedIn, Microsoft and Stripe data, served by mock connectors in each platform's real API format.
(Or run plain `docker compose up -d`, create your account and pick **Explore with demo data**.)

**On a server with a domain**, with automatic HTTPS (Docker, PostgreSQL and Caddy, random secrets
generated for you):

```bash
curl -fsSL https://raw.githubusercontent.com/ShubhamVankalas/adledger/main/install.sh | DOMAIN=ads.yourcompany.com sh
```

<details>
<summary><b>More ways to run it</b>: Render, Railway, a single container, or no Docker at all</summary>

<br />

| Where | How |
|---|---|
| **Render** | [![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/ShubhamVankalas/adledger) uses [`render.yaml`](render.yaml): web service, managed PostgreSQL 16 and a generated `APP_SECRET`. |
| **Railway** | Deploy from your fork (uses the `Dockerfile` and [`railway.json`](railway.json)), add PostgreSQL, set `DATABASE_URL=${{Postgres.DATABASE_URL}}`. |
| **Coolify, Dokploy, CapRover, Portainer** | Deploy [`docker-compose.yml`](docker-compose.yml) as-is. |
| **Single container, no PostgreSQL** | `docker run -d -p 3000:3000 -v adledger:/data ghcr.io/shubhamvankalas/adledger` (embedded database; fine for trials, use PostgreSQL for production). |
| **No Docker** (Node 20+) | `pnpm install && pnpm dev` uses an embedded database in `./.data`. |

Upgrade with `docker compose pull && docker compose up -d`. Full guide, backups and every setting:
[docs/SELF_HOSTING.md](docs/SELF_HOSTING.md).

</details>

## Features

### A dashboard you arrange yourself

The **Overview** is a widget board. Press **Customize** (or `E`) to drag widgets, resize them, group
them into sections and pin up to six KPI tiles. Start from a preset (Minimal, E-commerce, Lead gen,
Agency), keep a personal view, or set the workspace default for the whole team.

- A **briefing line** at the top names what mattered, built from SQL numbers, not a language model.
- **KPI tiles** with change vs the previous period (or last year), polarity-aware colours and sparklines.
- A **metric explorer**: click any tile to chart it against the comparison period.
- Widgets for spend vs revenue, revenue by channel, top campaigns, wasted spend, a platform
  scorecard, the funnel, a conversions heatmap, live visitors, goals and pacing, truth gap, profit
  after ads, recent leads and customers, and the latest insight.
- Date presets, compare, platform filter and attribution model all live in the URL, so every view is a link.

### Live

<img src="docs/screenshots/live.png" alt="Live view with visitors on the site now, revenue, spend, leads and customers today vs yesterday, and a real-time activity feed of ad clicks, leads and payments" width="100%" />

Visitors on your site right now, today vs the same time yesterday, and a real-time feed of ad
clicks, visits, leads, payments and refunds (server-sent events, no extra service). **Streamer
mode** (`S`) hides names; **sale alerts** (`A`) pop a toast for every payment.

### Performance

| | |
|---|---|
| <img src="docs/screenshots/performance.png" width="520" alt="Performance table with spend, clicks, leads, CPL, customers, CAC, platform gap, revenue and ROAS per campaign" /> | Campaigns, ad sets and ads with **column presets** (Default, E-commerce, Lead gen, Creative) or your own columns, reordered by drag or keyboard. CTR, CPM, CPC, CVR, AOV and **NC-ROAS**, change under every value, and a **platform gap** column: what the ad platform reports next to what AdLedger verified. Switch to the **quadrant** to sort campaigns into scale, test, fix and kill. Save and pin **views**; open a **peek** with the trend, top ad sets and the people a campaign brought in. |

### Attribution

| | |
|---|---|
| <img src="docs/screenshots/attribution-paths.png" width="520" alt="Top customer journeys as channel chips with revenue, median days and touches, beside a visit-to-revenue funnel" /> | **First touch, last touch and linear**, switchable anywhere, with exact integer-cent splits that always add up to the payment. **Paths** shows the journeys customers actually took. **Time to convert** shows lag histograms, the weekday-by-hour heatmap and whether your attribution window is long enough. The **model comparison** marks which campaigns start journeys and which close them. Unattributed revenue is always shown, never hidden. |

### Customers: LTV and cohorts

| | |
|---|---|
| <img src="docs/screenshots/customers-cohorts.png" width="520" alt="Cohort heatmap by first-payment month with retention, CAC and a dot where each cohort paid back its acquisition cost" /> | Lifetime value by acquiring channel, LTV:CAC, and a **cohort heatmap** by first-payment month in three views (retention, cumulative LTV, revenue), with a dot where each cohort paid back its CAC. Renewals are credited to the journey that first acquired the customer. |

### Signature money features

<table>
<tr>
<td width="50%" valign="top">

**Ad Receipts.** Every payment shows which ads earned it, what that customer cost in ad spend and
when they paid it back. Spend always reconciles: customer costs plus unallocated equal total spend
to the cent.

<img src="docs/screenshots/receipts.png" alt="Receipts: where the ad spend went, then each payment with the ad that mostly earned it, the cost to acquire and a payback tag" />

</td>
<td width="50%" valign="top">

**Profit Ledger.** Enter cost of goods, payment fees and shipping once. Get contribution, profit
after ads, **POAS**, break-even ROAS and a P&L waterfall, plus which platforms, campaigns and ads
bring buyers who refund.

<img src="docs/screenshots/profit.png" alt="Profit ledger with net revenue, contribution, profit after ads, POAS and a profit and loss waterfall" />

</td>
</tr>
<tr>
<td valign="top">

**Truth Gap.** "Meta says its ads made you this much; real payments from people who clicked them
were that much." Claimed vs verified conversions and value per platform and campaign, with a plain
explanation of why platforms over-claim.

</td>
<td valign="top">

**Too-early guardrails.** Median and p80 days from first click to first payment per campaign, a
"too early to judge" tag on young campaigns, and **pause drafts** you download as a Meta or Google
Ads Editor bulk file. AdLedger never writes to your ad accounts.

</td>
</tr>
</table>

**Verified reports** round this out: every PDF is fingerprinted and watermarked, and anyone holding
one can check it at `/verify` on your install (see [Reports](#reports-and-pdf)).

### A CRM that knows what each lead cost

| | |
|---|---|
| <img src="docs/screenshots/contacts.png" width="520" alt="Contacts table with view tabs, status, first touch, revenue and owner" /> | **Contacts**: view tabs (All, Customers, Open leads, High value) and saved views, filter chips, sort, group, density and column choice, footer totals from SQL, keyset paging that stays fast at 10k+ contacts, and a bulk bar (tag, owner, export, delete with undo). |
| <img src="docs/screenshots/journey.png" width="520" alt="Contact record with highlights, properties and a unified activity timeline of ad clicks, page views, forms and payments" /> | **Record page**: highlights (net revenue, first touch, days to convert, engagement), editable status, owner and tags, a unified timeline of ad clicks, visits, forms, payments and refunds, **notes**, **tasks** and per-model attribution. `J`/`K` step through contacts. |
| <img src="docs/screenshots/pipeline.png" width="520" alt="Pipeline kanban with New lead, Qualified, Call booked and Proposal columns, weighted value and rotting counts" /> | **Pipeline**: configurable stages, drag by mouse, touch or keyboard, multi-select moves with undo, weighted value, rotting flags, and a **funnel & cost** view with ad cost per stage by campaign, ad set or ad. Payments move contacts to Won automatically. |

Also: **My tasks** with overdue, today and upcoming; **CSV import** with column mapping and a
preview before anything is written; **duplicate review and merge** (same phone, Gmail variants,
same name) with re-attribution.

### Reports and PDF

| | |
|---|---|
| <img src="docs/screenshots/reports.png" width="520" alt="Report library with executive summary, weekly performance, attribution model comparison, LTV and cohorts, and wasted spend reports" /> | Five print-ready reports: **executive summary**, **weekly performance**, **attribution model comparison**, **LTV and cohorts**, **wasted spend and budget moves**. Your organization's logo on the masthead, a methodology appendix, a "Prepared for" watermark and a fingerprint on every page. Download, call the API, or **schedule** weekly or monthly emails. Rendered in-process: no headless browser, no extra container. [docs/REPORTS.md](docs/REPORTS.md) |

### Insights and Ask AI

| | |
|---|---|
| <img src="docs/screenshots/insights.png" width="520" alt="Insights action cards: move budget, room to grow and a revenue drop, with every figure linked to its source" /> | **Action cards** (move budget, room to grow, revenue drop, CAC up) where every figure links to its source row, a weekly report marked **All numbers verified**, and **Ask**: plain-language questions answered from read-only SQL tools, with the table each answer came from. Any number a model invents is flagged. Works with no model at all (rule-based answers), a local model, or any cloud provider you choose. |

### Alerts, sharing and goals

- **Alert rules** on CAC, CPL, ROAS, spend, revenue or leads, per workspace, platform or campaign,
  over a window you choose, with cooldowns and a "resolved" notice. Optional **anomaly detection**
  flags unusual days against the previous 28 days.
- **Notifications** by email, Slack, Discord, Microsoft Teams, SMS (Twilio) or signed webhook:
  weekly report, KPI digest (daily, weekly or monthly), alerts, sync failures, new customers,
  large payments and security events.
- **Share links**: read-only aggregate dashboards at `/share/…` with locked filters, an expiry
  date, a view count and one-click revoke. Contact details are never shared.
- **Targets and goals**: monthly or quarterly targets per metric with pacing, projection to period
  end and ad-budget pacing.

### Built for speed

- **Ctrl K / ⌘K** finds any page, setting, contact, campaign, ad set or ad. Type `>` for actions,
  `?` to ask AI.
- `G` then a letter jumps between pages, `/` focuses the page search, `[` collapses the sidebar,
  and `?` lists every shortcut for the page you are on.
- Installable on your phone (PWA) with a bottom tab bar, and a dark mode that follows your system.

### MCP server for AI assistants

Ask Claude, Cursor or any MCP client *"which ads made money last month?"* against your own ledger.
Create a key in **Settings → API & MCP**, then:

```bash
claude mcp add --transport http adledger https://your-adledger/api/mcp --header "Authorization: Bearer al_..."
```

<details>
<summary>14 read-only tools</summary>

<br />

`get_overview`, `get_performance`, `find_wasted_spend`, `compare_periods`, `get_platform_breakdown`,
`get_timeseries`, `search_campaigns`, `contact_stage_funnel`, `list_contacts`, `get_contact_journey`,
`get_ad_receipt`, `get_latest_insights`, `get_sync_status`, `list_integrations`.

Every tool is annotated read-only and a test proves none of them changes data. Emails are masked.
Setup for Claude Desktop and Cursor: [docs/MCP.md](docs/MCP.md). The same data is on the REST API
(`/api/v1/...`, OpenAPI 3.1 at `/api/v1/openapi.json`): [docs/API.md](docs/API.md).

</details>

### Integrations

Everything is connected from **Settings → Integrations**, with step-by-step instructions on each
card and a mock mode for every connector.

| | |
|---|---|
| **Ad platforms** | Meta Ads, Google Ads, Microsoft Ads, TikTok Ads, LinkedIn Ads, Pinterest Ads, Snapchat Ads, Reddit Ads, X Ads. Anything else by CSV or the Spend API. |
| **Payments and stores** | Stripe (paste one key, the webhook is created for you), Shopify, WooCommerce, Paddle, Lemon Squeezy, Razorpay, PayPal, Chargebee, Recurly, Gumroad, Cashfree, Instamojo, PhonePe. Anything else by CSV or the Conversions API. |
| **CRMs** | Won deals from HubSpot and Pipedrive. |
| **Lead forms** | Any form with `data-adledger-lead`, webhooks from Typeform, Tally, Webflow, Zapier or Make, native Meta Lead Ads, Google Ads lead forms, TikTok Lead Generation, and WhatsApp click-to-chat. |
| **Your website** | One `<script>` tag (2.4 KB gzipped), a [WordPress/WooCommerce plugin](integrations/wordpress), a [Shopify custom pixel](integrations/shopify), a [GTM template](integrations/gtm) and [guides](docs/integrations/) for Webflow, Wix, Squarespace, Framer and Next.js. |
| **Back to the ad platforms** (beta) | Consent-aware conversion upload to the Meta Conversions API and Google Ads (Data Manager API), hashed identifiers only. |
| **Notifications** | Email, Slack, Discord, Microsoft Teams, SMS (Twilio), signed webhook. |

Connectors other than Meta, Google Ads and Stripe are in beta: tested against real-format fixtures,
not yet verified on live accounts. Details: [docs/CONNECTORS.md](docs/CONNECTORS.md).

## Screenshots

| Overview in dark mode | Revenue and ROAS by attribution model |
|---|---|
| <img src="docs/screenshots/overview-dark.png" alt="Overview in dark mode" /> | <img src="docs/screenshots/attribution.png" alt="Revenue and ROAS under first touch, last touch and linear per campaign, with journey starters and closers" /> |
| **Time to convert** | **Time to money and pause drafts** |
| <img src="docs/screenshots/time-to-convert.png" alt="Lag histograms from first touch to lead and payment, with a recommended attribution window" /> | <img src="docs/screenshots/time-to-money.png" alt="Median days from first click to payment, pause drafts for Meta and Google Ads Editor, and payback lag by campaign" /> |
| **Ask your numbers** | **Security policy and posture checklist** |
| <img src="docs/screenshots/insights-ask.png" alt="Ask panel with suggested questions answered from the ledger" /> | <img src="docs/screenshots/settings-security.png" alt="Security policy checklist: encryption key storage, HTTPS, two-factor coverage, session limits and audit verification" /> |
| **30+ integrations** | **Guided setup checklist** |
| <img src="docs/screenshots/settings-integrations.png" alt="Integrations catalog" /> | <img src="docs/screenshots/onboarding.png" alt="Setup checklist that adapts to your website builder, payment tools and ad platforms" /> |

<details>
<summary>More: tracking, team, alerts, audit log, two-factor sign-in, notifications, report verification</summary>

<br />

| Tracking snippet and consent modes | Members and roles |
|---|---|
| <img src="docs/screenshots/settings-tracking.png" alt="Tracking settings" /> | <img src="docs/screenshots/settings-members.png" alt="Members and roles" /> |
| **Alert rules and anomaly detection** | **Hash-chained audit log** |
| <img src="docs/screenshots/settings-alerts.png" alt="Alerts settings" /> | <img src="docs/screenshots/settings-audit.png" alt="Audit log with export and verify chain" /> |
| **Two-factor sign-in and devices** | **Notification channels** |
| <img src="docs/screenshots/settings-account-security.png" alt="Account security with two-factor sign-in and signed-in devices" /> | <img src="docs/screenshots/settings-notifications.png" alt="Notification channels" /> |
| **Verify a PDF report** | |
| <img src="docs/screenshots/verify.png" alt="Public verify page for report fingerprints" /> | |

</details>

**On your phone**: installable as an app, with a floating tab bar and a one-tap filter sheet.

<p>
  <img src="docs/screenshots/mobile-overview.png" alt="Overview on a phone" width="200" />
  <img src="docs/screenshots/mobile-live.png" alt="Live on a phone" width="200" />
  <img src="docs/screenshots/mobile-performance.png" alt="Performance on a phone" width="200" />
  <img src="docs/screenshots/mobile-settings.png" alt="Integrations on a phone" width="200" />
</p>

## Security and compliance

AdLedger holds no certifications and makes no compliance claims for you. It is **built to help you
meet GDPR, UK GDPR, CCPA/CPRA and India's DPDP. When you self-host, you are the data controller.**
Its controls map to common SOC 2 criteria, but the project itself is not audited. What it ships,
named precisely:

| Area | Controls |
|---|---|
| **Sign-in** | Free two-factor sign-in (TOTP + recovery codes) that owners can require org-wide, with a documented break-glass for a locked-out owner. scrypt passwords under a NIST SP 800-63B-4 policy. |
| **Sessions** | Hashed tokens, idle timeout and maximum lifetime, a device list with sign out one or everywhere, new-device emails. |
| **Access** | Five roles (owner, admin, analyst, viewer, client). Contact emails **masked by role**, with every reveal audited. Separate permissions for aggregate CSVs, contact exports and PDFs. |
| **PII** | Raw emails only in the contacts table; SHA-256 hashes everywhere else. IPs truncated. Stored payloads redacted. |
| **Secrets and keys** | Connector credentials and 2FA secrets encrypted with AES-256-GCM. API keys stored hashed, with **scopes** and optional expiry. |
| **Audit** | Tamper-evident, **hash-chained audit log** with Verify, filters and CSV export. **Security alerts** for new keys, role changes, 2FA resets, bulk exports and new-device sign-ins. |
| **Consent** | Pixel consent modes (opt-out, consent required, cookieless) and **Global Privacy Control**. Conversion uploads carry consent signals, and people who said no are never uploaded. |
| **Data rights** | Per-contact export and erasure (UI and API), full workspace export, raw-event retention. |
| **Leak deterrence** | Watermarked, fingerprinted PDFs verifiable at `/verify`, an export log, aggregate-only share links. |
| **Web and supply chain** | CSP and security headers, SSRF guards, signed webhooks. CodeQL, dependency review, `pnpm audit`, Trivy image scans, Dependabot, SBOM and provenance on release images. |
| **Disclosure** | `/.well-known/security.txt` on every install and private vulnerability reporting ([SECURITY.md](SECURITY.md)). |

Read the full [Trust & security page](docs/SECURITY.md), including what AdLedger is not for (health
records, card data, children's data) and the operator hardening checklist.

## How it compares

|   | **AdLedger** | Hyros | Triple Whale | Cometly | Northbeam |
|---|---|---|---|---|---|
| Price | **Free** (AGPL-3.0) | Paid plans | Paid plans | Paid plans | Paid plans |
| Open source, auditable code | **Yes** | No | No | No | No |
| Runs on your own server | **Yes** | No | No | No | No |
| Your data stays with you | **Yes** | Vendor cloud | Vendor cloud | Vendor cloud | Vendor cloud |
| Use a local AI model (Ollama, LM Studio) | **Yes** | No | No | No | No |
| MCP server on your own infrastructure | **Yes**, read-only | No | No | No | No |
| Seats, workspaces, client logins | **Unlimited** | Check plan | Check plan | Check plan | Check plan |
| White-label PDF reports | **Included** | Check plan | Check plan | Check plan | Check plan |

<sub>Competitor details as publicly listed in 2026; check their sites for current pricing and features.
Some hosted tools offer things AdLedger doesn't yet, such as data-driven attribution models. The long version, with AdLedger's current limits: [docs/COMPARISON.md](docs/COMPARISON.md).</sub>

## Architecture

One Next.js app and PostgreSQL. The dashboard, REST API, pixel collector, webhooks, MCP server,
live stream, PDF rendering and background jobs (syncs, attribution, alerts, scheduled reports) all
run in a single container.

```
 your website ──al.js──▶ /api/v1/collect ─────┐
 forms, CRMs ──webhook─▶ /api/v1/webhooks ────┤
 Stripe, stores ─webhook▶ /api/v1/webhooks ───┼──▶  AdLedger (Next.js)  ──▶  PostgreSQL 16
 ad platforms ◀── scheduled sync / uploads ───┤        ▲ dashboard, /share, /verify
 Claude, Cursor ──MCP──▶ /api/mcp ────────────┘
```

**Stack:** Next.js 16 · React 19 · TypeScript · PostgreSQL 16 (Drizzle ORM, embedded PGlite for
trials) · Tailwind CSS v4 + shadcn/ui · Recharts · react-pdf · Vercel AI SDK · MCP SDK · vitest ·
Playwright. Details and design decisions: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Documentation

| Doc | What's in it |
|---|---|
| [Features](docs/FEATURES.md) | Every page and setting, grouped |
| [Self-hosting](docs/SELF_HOSTING.md) | Install options, HTTPS, upgrades, backups, configuration |
| [Connectors](docs/CONNECTORS.md) | Setting up each integration, UTM templates, mock mode |
| [Pixel](docs/PIXEL.md) | The tracking script, its API and consent |
| [Reports](docs/REPORTS.md) | PDF reports, schedules, watermarks and verification |
| [MCP](docs/MCP.md) · [API](docs/API.md) | AI assistant tools and the REST API |
| [Trust & security](docs/SECURITY.md) | Controls, privacy, hardening checklist, disclosure |
| [Comparison](docs/COMPARISON.md) | AdLedger vs Hyros, Triple Whale, Cometly and Northbeam |
| [FAQ](docs/FAQ.md) | Data, accuracy, iOS, cost, 2FA lockout, compliance questions |
| [Architecture](docs/ARCHITECTURE.md) · [Product](docs/PRODUCT.md) · [Roadmap](docs/ROADMAP.md) | How it's built, who it's for, what's next |

## Contributing

```bash
pnpm install
pnpm dev                   # http://localhost:3000, embedded database, no Docker needed
pnpm test                  # vitest on an embedded Postgres, every connector mocked
pnpm lint && pnpm typecheck
pnpm build && pnpm e2e     # Playwright browser tests with axe accessibility checks
```

Bug reports, connectors and docs fixes are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md)
and the [roadmap](docs/ROADMAP.md).

## License

[AGPL-3.0](LICENSE). Free to use, modify and self-host. If you offer a modified version as a
network service, share your changes. The name and logo are covered by [TRADEMARKS.md](TRADEMARKS.md).

<div align="center">
<br />

**If AdLedger shows you which ad made you money, give it a star.** It helps other founders find it.

</div>
