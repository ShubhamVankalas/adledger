# PDF reports

AdLedger turns your ledger into branded, print-ready PDF reports. Open **Reports** in the
dashboard, pick a period and choose **Download PDF**, or **Schedule** a report to be emailed to
your team every week or month. Nothing extra to install: PDFs are rendered inside the app (no
headless browser, no extra container).

## The reports

| Report | For | Pages | What's in it |
|---|---|---|---|
| **Executive summary** | Founders, client executives | 1 | Three plain statements, six KPIs with change and trend, spend vs revenue by day, top and bottom campaigns |
| **Weekly performance** | Marketing team, clients | 2–3 | Eight KPIs vs the previous period, daily spend and revenue with the previous period dashed, what changed, wasted spend, revenue by channel, platforms, every campaign |
| **Attribution model comparison** | Founders, analysts | 2 | ROAS under each model, a first-touch vs last-touch slope chart, journey starters and closers, revenue under every model per campaign |
| **LTV and cohorts** (landscape) | SaaS and subscription businesses | 2–3 | Cumulative revenue per customer by first-payment month (heatmap), LTV curves, LTV:CAC by acquiring channel, payback per cohort |
| **Wasted spend and budget moves** | Founders, media buyers | 2 | Waste at a glance, suggested budget moves as ranges with the assumptions printed, waste by campaign, campaigns too early to judge |
| **Channel mix and efficiency** | Founders, media buyers, agencies | 2 | Spend share against revenue share per platform, ROAS against the blend, daily spend by platform (stacked), revenue by channel with change |
| **Lead source quality** | Lead-gen, sales and marketing | 2 | Lead KPIs, close rate and revenue per lead by channel and campaign, "cheap leads that rarely buy", lead-to-payment timing |
| **Creative and ad leaderboard** | Creative teams, media buyers | 2 | Top ads by revenue, most efficient (≥ 2% of spend), click-through leaders (≥ 1,000 impressions), ads spending without return |
| **Funnel and time to convert** | Growth teams, analysts | 2 | Visitors → leads → customers with step rates vs the previous period, days and touches to convert, attribution-window check, timing per campaign |
| **Pipeline and CRM activity** | Sales-led and service businesses | 1–2 | New contacts by furthest stage reached, win rate, stage-by-stage conversion, ad spend per stage per campaign |
| **Profit and refunds** | Founders, finance | 2 | Net revenue, refunds, contribution and profit after ads vs the previous period, gross sales → profit waterfall, profit and refund rates per campaign |

Every report has:

- a masthead with your organization's logo (or its name as a wordmark) in its accent colour
  (Settings → Organization → Appearance), the report title and period;
- a methodology appendix: attribution model and window, the share of revenue with no tracked touch,
  currencies excluded from totals, when each data source last synced, pixel activity and the fingerprint;
- a footer on every page: *Confidential · Prepared for {person} · {workspace} · {date} · {fingerprint}*
  and page numbers as *n / total*;
- tables capped at 25 rows ("and N more", the full list is in the CSV exports) with the header
  repeated on every page.

All figures come from the same SQL as the dashboard (`src/lib/reports*.ts`). No number in a report is
written or calculated by AI.

## Downloading

- **Dashboard:** Reports → choose the period (last 7/14/30/90/180 days, last full month or a custom
  range) → **Download PDF**. The attribution model picker in the page header applies to every report
  that uses one.
- **API:** `GET /api/v1/reports/{kind}/pdf?start=YYYY-MM-DD&end=YYYY-MM-DD&model=linear&compare=previous`
  with `Authorization: Bearer al_…`. Kinds: `executive-summary`, `weekly-performance`,
  `attribution-models`, `ltv-cohorts`, `wasted-spend`, `channel-mix`, `lead-quality`,
  `ad-leaderboard`, `conversion-funnel`, `pipeline-activity`, `profit-refunds`. Without `start`/`end` the report's default
  range, ending on the latest day with data, is used. Responses are `application/pdf` with
  `Cache-Control: private, no-store` and `X-Export-Id` / `X-Report-Fingerprint` headers.

Who can download: everyone with the `reports.pdf` permission (owners, admins, analysts and viewers;
clients only while the organization's security policy allows it), and API keys with `reports:read`.
Session downloads must come from the dashboard
itself: a cross-site link (`Sec-Fetch-Site: cross-site`) is refused, so another site can't make a
signed-in browser render and log a report.

The server renders at most two PDFs at a time and queues two more for up to 15 seconds; beyond that
the API answers `429` with `Retry-After`. A report typically renders in 150–400 ms.

## AI documents

When no report in the library fits, ask for one: **Reports → Write an AI document**
(`/reports/ai-document`).

1. **Start from** one of the ready-made requests or write your own ("Make a one-page board update
   for September focused on Meta vs Google"). Templates: monthly client report, board or investor
   update, campaign post-mortem, budget reallocation memo, channel deep-dive (Meta vs Google), lead
   quality audit, weekly team stand-up, agency case study, creative performance brief,
   quarter-over-quarter review, funnel leak diagnosis, refund and churn analysis. Each has a
   recommended period, and the full instruction is editable before you send it.
2. **Pick the period** (compared with the period before) and the attribution model in the header.
3. **Write the document.** The workspace's AI model (Settings → AI model: OpenAI, Anthropic,
   Gemini or any OpenAI-compatible model such as Ollama) returns a *structured* document: title,
   summary, sections of paragraphs, bullets, callouts, KPI rows, tables and charts. It does not
   need to produce a PDF, and it can't put figures in KPIs, tables or charts: those blocks only
   name ids from the data pack, and AdLedger draws them from SQL.

**The data pack.** `src/lib/ai/document-data.ts` computes everything the document may show with
`src/lib/reports*.ts`: about 25 facts (spend, revenue, ROAS, MER, leads, customers, CPL, CAC,
wasted spend, funnel rates, gross sales, refunds, profit after ads, and per-platform spend, ROAS
and share), each with its previous-period value, and 11 datasets (daily trend, platforms,
channels, campaigns, top campaigns, wasted spend, biggest movers, top ads, funnel, profit
waterfall, pipeline stages). The model reads a formatted copy (no raw minor units, no contacts or
anything person-level) and references facts and datasets by id.

**The checks** (`sanitizeDocument` in `src/lib/ai/document.ts`):

- unknown fact or dataset ids are dropped; a chart type the dataset can't draw becomes its default;
- every number in the prose (title, summary, headings, paragraphs, bullets, callouts, captions)
  must appear in the data pack or in your own request, or the sentence is removed (the same check
  as the weekly insights, `src/lib/ai/numbers.ts`);
- sizes are capped (8 sections, 10 blocks each, 25 table rows) so a verbose model can't blow up
  the PDF.

The result page shows a preview of the document, what was removed or adjusted, and **Download
PDF**. The PDF uses the same frame as every report (logo, accent, watermark, fingerprint,
methodology), and its methodology says the text was written by the named model from SQL figures.

**Access and limits.** Needs `reports.pdf` and `insights.generate` (owners, admins and analysts
by default). Four documents per person per minute, twelve per workspace; rendering shares the PDF
limiter. Each document is written to the export log (`report_kind = ai-document`, with the
template id) and the audit log (`report.ai_document_generated`: ids, counts and the model name,
never the request or the document text). `/verify` shows it as "AI document".

Without a model the page explains how to connect one. For demos and tests, `LLM_MODEL=mock` (server
environment only) switches to a built-in writer that assembles a document from the data pack with
no model call. Other AI features fall back to their rule-based answers in that mode.

## Scheduling

Reports → **Schedule** on any report:

- **Weekly** on a chosen day and hour, covering the seven days before each send, or **monthly** on
  the 1st, covering the previous calendar month. Times are in the workspace timezone.
- **Send to** everyone who can open the workspace and download PDFs (the `reports.pdf` permission),
  or only the people you choose among them.
- **Skip quiet periods** (on by default): nothing is sent when the period had no ad spend and no revenue.

Scheduled reports go out by email through the workspace's **Email** channel (Settings →
Notifications). Without one, the server-wide `SMTP_URL` / `SMTP_FROM` settings are used. Recipients
get the PDF as an attachment (in Bcc when there are several) with the headline numbers in the email.
The first report goes out at the next scheduled time; **Send now** sends the latest period
immediately. Paused schedules keep their settings.

The `report-schedules` job runs hourly inside the app (no cron needed) and renders one report at a
time.

## Leak protection

- **Export log:** every PDF (download, API call or scheduled delivery) writes one `export_log` row:
  who (user, API key or schedule), which report and parameters, when, size, page count and the
  fingerprint. IDs only, never email addresses. Downloads are also in the audit log.
- **Watermark:** each page names the person the report was prepared for, the workspace, the date
  and the fingerprint.
- **Fingerprint:** a SHA-256 over the report kind, parameters, the report data, the export id, the
  exporter and the time, so every export is unique. A second hash over kind, parameters and data only
  (`data_hash`) is the same for two exports of the same numbers.
- **Verify:** anyone holding a PDF can paste its fingerprint (the 20 characters in the footer are
  enough) at `/verify` on your AdLedger. The page confirms whether this installation issued it and
  shows only what the cover already says: report, workspace, period and issue date. It never shows
  numbers or who exported it, and it is rate-limited. Set `PUBLIC_URL` to print the full verify link
  in the PDF.

## Logos

Upload a logo in Settings → Organization. PDFs embed PNG or JPEG only, so the browser also uploads
a 256 px PNG copy (`organizations.logo_png`). Logos uploaded before this release were stored as WebP:
re-upload once to see them in PDFs; until then reports show the organization name as a wordmark.

## Fonts and languages

PDFs embed Geist (Regular, Medium, SemiBold, Bold) from `src/lib/pdf/fonts/` under the SIL Open Font
License. Currency symbols Geist lacks (₩, ₺, ₦, ₫ and a few others) print as ISO codes (KRW, TRY, NGN…).

For Hindi or Marathi campaign names, add Noto Sans Devanagari: place `NotoSansDevanagari-Regular.ttf`
and `NotoSansDevanagari-Bold.ttf` (from [notofonts/devanagari](https://github.com/notofonts/devanagari/releases),
SIL OFL) in `src/lib/pdf/fonts/` and rebuild. It is registered automatically as a fallback font.
Chinese, Japanese, Korean and Arabic scripts are not supported in PDFs yet.

## Printing any page

Ctrl+P (⌘P) on any dashboard page prints without the sidebar, filters or buttons, in light colours,
without splitting cards or table rows. Overview widgets print at their natural height and charts
scale to the paper width. The rules live in `src/app/print.css` (its colour tokens mirror the light
palette in `globals.css`: keep them in sync when the palette changes).

## For developers

- Report kinds: `src/lib/report-kinds/` (`catalog.ts` metadata, one file per kind with `load` and
  `Body`, `index.ts` registry). Add a kind by writing its file and one registry line; `load` may only
  call `src/lib/reports*.ts`.
- Rendering: `render.tsx` (`generateReportPdf`), frame in `src/lib/pdf/document.tsx`, building blocks
  in `src/lib/pdf/components.tsx`, charts in `src/lib/pdf/charts/`, print colours in `src/lib/pdf/theme.ts`.
- User strings (campaign, workspace and organization names) pass through `safeText()` and are only
  ever drawn as text, never placed in drawing attributes.
- AI documents: `src/lib/ai/document-schema.ts` (zod schema), `document-data.ts` (data pack),
  `document-prompts.ts` (templates and system prompt), `document.ts` (generation, checks and the
  built-in writer), `document-preview.ts` (HTML preview); PDF in `src/lib/pdf/ai-document.tsx`;
  page and action in `src/app/(app)/reports/ai-document/`. Tests: `tests/ai-document.test.ts`,
  new kinds in `tests/reports-pdf-kinds.test.ts`.
- Tests: `tests/reports-pdf.test.ts` (every kind renders from demo data within its time budget and matches
  `reports*.ts`; verify reveals nothing else) and `tests/reports-pdf-routes.test.ts` (permissions,
  429 guard, export log, schedules, email attachments).
