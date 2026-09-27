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

Every report has:

- a masthead with your organization's logo (or its name as a wordmark), the report title and period;
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
  `attribution-models`, `ltv-cohorts`, `wasted-spend`. Without `start`/`end` the report's default
  range, ending on the latest day with data, is used. Responses are `application/pdf` with
  `Cache-Control: private, no-store` and `X-Export-Id` / `X-Report-Fingerprint` headers.

Who can download: owners, admins and analysts (the `reports.pdf` permission), and API keys.
Viewers and clients see reports on screen only.

The server renders at most two PDFs at a time and queues two more for up to 15 seconds; beyond that
the API answers `429` with `Retry-After`. A report typically renders in 150–400 ms.

## Scheduling

Reports → **Schedule** on any report:

- **Weekly** on a chosen day and hour, covering the seven days before each send, or **monthly** on
  the 1st, covering the previous calendar month. Times are in the workspace timezone.
- **Send to** everyone who can open the workspace and download PDFs (owners, admins and analysts;
  viewers and clients never receive one), or only the people you choose among them.
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
without splitting cards or table rows. The rules live in `src/app/print.css`.

## For developers

- Report kinds: `src/lib/report-kinds/` (`catalog.ts` metadata, one file per kind with `load` and
  `Body`, `index.ts` registry). Add a kind by writing its file and one registry line; `load` may only
  call `src/lib/reports*.ts`.
- Rendering: `render.tsx` (`generateReportPdf`), frame in `src/lib/pdf/document.tsx`, building blocks
  in `src/lib/pdf/components.tsx`, charts in `src/lib/pdf/charts/`, print colours in `src/lib/pdf/theme.ts`.
- User strings (campaign, workspace and organization names) pass through `safeText()` and are only
  ever drawn as text, never placed in drawing attributes.
- Tests: `tests/reports-pdf.test.ts` (every kind renders from demo data in under 3 s and matches
  `reports*.ts`; verify reveals nothing else) and `tests/reports-pdf-routes.test.ts` (permissions,
  429 guard, export log, schedules, email attachments).
