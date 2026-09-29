# AdLedger — Roadmap

The original plan (M0–M9 on a FastAPI/Celery/Redis stack) was re-scoped on 2026-09-26 to a single
Next.js app + Postgres for one-command installs (see ARCHITECTURE “Decisions”). v0.1 was built
end to end in that form. Status below.

## v0.1 — status

| Milestone | Status | Notes |
|---|---|---|
| M0 Repo, dev environment, CI | ✅ | `pnpm dev` with embedded DB; Docker image; CI: lint, typecheck, tests (embedded + real Postgres), build, Docker smoke test |
| M1 Data model, money helpers, auth | ✅ | 22 tables, one migration, auto-migrate; `allocate()` property tests; sessions + hashed API keys; first-run setup wizard |
| M2 Pixel, collection, identity, leads | ✅ | 1.7 KB pixel, channel rules, touchpoint de-dupe, stitching across devices, lead webhook with auto-detected fields, PII redaction |
| M3 Revenue (Stripe) | ✅ | Signature-verified webhooks, idempotent payments/refunds, checkout-session linking, 90-day backfill, mock mode |
| M4 Ad spend (Meta, Google) + matching | ✅ | Live connectors (Graph v26, Ads API v25) + mock; idempotent upserts; exact micros; ID→name matching |
| M5 Attribution + reporting API | ✅ | First/last/linear, exact revenue splits, unattributed bucket, LTV anchoring for repeat payments, timezone-correct filters |
| M6 Demo seed + dashboard | ✅ | Deterministic 90-day demo (8 campaigns, 42 ads, ~26k visitors); Overview, Performance (drill-down + CSV), Contacts + journey, Insights, Settings; dark mode |
| M7 AI insights (BYO model) | ✅ | Facts pack, AI SDK providers incl. Ollama, template fallback, weekly schedule, number check |
| M8 MCP server | ✅ | 14 read-only tools at `/api/mcp` (incl. `get_ad_receipt`, `contact_stage_funnel`), API-key auth with scopes, tests prove no writes |
| M9 Launch polish | 🟡 | README with screenshots, landing site (`site/`), docs, install script, compose + HTTPS profile, Render/Railway configs, Playwright e2e in CI. Remaining: README GIF, verify deploys on real accounts, public GHCR image, `v0.1.0` tag |

### Before the public launch
- [ ] Record the 20-second GIF (dashboard → “which ad made money” → MCP answer in Claude).
- [ ] Make the repo public (Settings → General → Danger zone → Change visibility).
- [ ] Make the container image public (GitHub → Packages → adledger → Package settings → Change visibility).
- [ ] Turn on the website: Settings → Pages → Source: **GitHub Actions**, then re-run the “Website” workflow → https://shubhamvankalas.github.io/adledger/
- [ ] Tag `v0.1.0` (`git tag v0.1.0 && git push --tags`) so the release workflow publishes `:latest` and `:0.1.0`.
- [ ] Test `install.sh` on a fresh VPS with a real domain.
- [ ] Connect a real Stripe test account, Meta ad account and Google Ads account end to end.
- [ ] Lighthouse accessibility pass on Overview (target ≥ 90).
- [x] `pnpm audit --prod`: no known vulnerabilities (2026-09-26).

## v0.2 — status

| Feature | Status | Notes |
|---|---|---|
| Organizations, workspaces, roles, invitations, audit log | ✅ | Owner / Admin / Analyst / Viewer / Client; workspace + organization switcher |
| Settings: Account, Workspace, Organization | ✅ | Profile, password, devices; integrations catalog; notifications; import; members |
| Ad platforms: Microsoft, TikTok, LinkedIn, Pinterest, Snapchat, Reddit, X | 🟡 Beta | Contract-tested against real-format fixtures; not yet verified on live accounts |
| Revenue: Shopify, WooCommerce, Paddle, Lemon Squeezy, Razorpay, PayPal | 🟡 Beta | Signed webhooks + tests; backfill for Shopify and WooCommerce |
| Stripe one-key setup | ✅ | Webhook created automatically on public https installs |
| CSV import, Spend API, Conversions API | ✅ | Covers any other ad network or checkout |
| Conversion upload: Meta Conversions API, Google Ads click conversions + enhanced conversions for leads (Data Manager API) | 🟡 Beta | Hourly, idempotent, retried with backoff; hashed PII only; consent-aware (Google consent, Meta LDU, skips without consent); not yet verified on live accounts |
| Pixel consent modes (opt-out, consent required, cookieless), GPC, CMP snippets, AI assistants channel | ✅ | Hotfix lane of the redesign addendum |
| Notifications: email, Slack, Discord, Teams, SMS, webhook | ✅ | Weekly report, daily digest, wasted spend, sync failed, new customer, large payment |
| Developer platform: Developers area, outbound webhooks, API reference, recipes | ✅ | `lead.created`, `contact.created`, `contact.updated`, `payment.succeeded`, `payment.refunded`; HMAC-signed, retried, delivery log with redeliver and test events; `GET /api/v1/leads` with cursor pagination. Next: `contact.updated` for owner/tag changes, webhook management through the API |
| WordPress/WooCommerce plugin, Shopify pixel, GTM tag, site-builder guides | ✅ | `integrations/`, `docs/integrations/` |
| First-run choice + guided setup checklist with live checks | ✅ | |
| Real brand logos | ✅ | Simple Icons (CC0) + drawn marks |
| Redesign phase 1c: Overview widget board | ✅ | Metric + widget registries, widgets 1–15 plus Live now, Goals & pacing, Funnel, Conversions heatmap, Truth gap and Profit after ads; briefing sentence, KPI sparklines (following `?compare=`), ROAS/MER target bars from Targets & goals, Metric explorer, five presets (Minimal, E-commerce, Lead gen, SaaS, Agency), edit mode (drag, sizes, sections), pinning, personal view / workspace default (`dashboards`). Next: NC-ROAS / AOV / Profit KPI tiles, spend by platform, quadrant widget, per-widget range override, mobile accordions |

## Redesign ("Quiet Ledger", docs/redesign/BRIEF.md)

| Phase | Status | Notes |
|---|---|---|
| 1a Tokens + shell | ✅ | OKLCH tokens, ink primary, restyled primitives; sidebar groups (Overview · Live, Analyze, Money: Profit · Receipts · Truth gap, CRM, pinned Views), workspace switcher, Live pulse + visitors-now badge, overdue-task and triggered-alert badges, setup ring, `[` rail; 52px header with demo pill and pending line; date presets + compare in the URL; floating phone tab bar; `/attribution`, `/customers` (old URLs redirect) |
| 1b ⌘K + hotkeys | ✅ | Base UI palette with every page, tab and settings section (incl. paths, time to convert, cohorts, payback, profit, time to money, receipts, truth gap, reports, verify, pipeline, tasks, security, alerts, sharing, goals, stages, import, duplicates), actions (date, compare, model, sync, pixel snippet, streamer mode, save view, new task, theme, invite), `POST /api/v1/search`, `?` sheet from the hotkey registry. Next: switch workspace, export this view, row actions |
| 1c Overview v2 | ✅ | See "Redesign phase 1c" above |
| 6 Automation, sharing, AI | ✅ | Alert rules (re-checked right after a successful sync) (CAC, CPL, ROAS, spend, revenue, leads × window × scope) + anomaly detection, hourly in `jobs.ts`, once per breach with cooldown; KPI digest daily/weekly/monthly per channel; share links with locked filters (`/share/[token]`); Insights tabs (action cards with number chips, Ask chat over read-only SQL tools, alert history). Next: share-link password / max views / ratios-only / frozen snapshot, PDF on share links, agency roll-up. Action cards skip campaigns that are too early to judge (time to money); share pages send `X-Robots-Tag: noindex` and `Referrer-Policy: no-referrer` |
| A Trust core (ADDENDUM §1.3 #4–14) | ✅ | PII masking by role + audited reveal; split export permissions; API key scopes + expiry; TOTP 2FA + recovery codes + Require 2FA + `ADLEDGER_BREAK_GLASS`; sessions (device, idle timeout, max lifetime, revoke, sign out everywhere, new-device email); NIST password policy; audit log v2 (hash chain + Verify, filters, CSV); `security_alert`; security posture checklist + key-storage warning; `security.txt`, CodeQL, dependency review, `pnpm audit`, Trivy, Dependabot, SBOM + provenance; `TRADEMARKS.md`, `docs/SECURITY.md`. Next: `export_log` + row caps + export reason (with the PDF slice), key rotation (`APP_SECRET_PREVIOUS`), actions pinned by SHA, OpenSSF Scorecard, DCO, per-client "sees contact details" toggle, audit feed to webhook/syslog |
| B Reports & PDF | ✅ | react-pdf + in-house SVG chart kit; 5 kinds (executive summary, weekly performance, attribution models, LTV & cohorts, wasted spend & budget moves) with methodology appendix; `/reports` gallery, download + weekly/monthly email schedules (`report_schedules`); `export_log`, "Prepared for" watermark, fingerprint + public `/verify`; print stylesheet. Next: truth report, share links, branding settings, Noto Sans Devanagari files, protected/archival PDFs, Slack/webhook delivery |
| 2 Live | ✅ | `/live`: counters with count-up, SSE feed (ad clicks, visits, leads, payments, refunds), today vs yesterday by hour, top pages and sources, streamer mode, sale toasts; `GET /api/v1/live` + `/api/v1/live/pulse`; sidebar pulse + nav badge, Overview "Live now" widget; pixel, lead and payment ingest nudge open Live tabs; simulated activity in sample workspaces. Next: "new data" pills on Overview/Contacts, milestone notifications, PWA shortcut |
| 2 Performance v2 + saved views | ✅ | Presets (Default, E-commerce, Lead gen, Creative, Custom), Display popover (drag to reorder, add/hide columns, density), CTR/CPM/CPC/CVR/AOV/NC-ROAS, platform vs verified conversions with gap %, Δ under values, capped ROAS bar, optional stoplights, sticky header/column/totals, peek sheet (trend, ad sets, people), Table / Quadrant, J/K/Space/Enter/X shortcuts, `saved_views` with shared/personal views and sidebar pins. Stoplights and the quadrant split follow Targets & goals; pinned views show in the sidebar; ⌘K "Save view…". Next: 14-day sparkline column, Trend overlay, cost per stage (phase 4), "Open in Meta Ads" |
| 3 CRM foundation | ✅ | `contact_stats` roll-up + keyset paging; Contacts v2 (starter + saved view tabs, filter chips, Display: sort/columns/density/group-by, footer totals, bulk bar: tag, owner, export, delete); preview sheet with J/K; record page v2 (highlights, properties incl. pipeline stage, unified timeline, notes & tasks, attribution, ad receipt) with optimistic edits and Undo; tags, owner, notes, tasks, My tasks (overdue badge in the sidebar), engagement score; emails masked on screen for everyone, with an audited "Show email" for `contacts.pii`; contact CSV needs `export.csv`, raw emails in it `export.contacts`. Next: split "Save for everyone" views, inline table cell edits, AND/OR filter groups, live "new contacts" pill, a phone bottom action bar on the record page, move `contact_views` onto `saved_views` (sidebar pins for contact views) |
| 4 Pipeline | ✅ | Configurable stages (`pipeline_stages`, `contacts.stage_id`, `contact_stage_events`), kanban with drag (mouse, touch, keyboard), multi-select, optimistic moves + Undo, weighted totals, rotting; payments move contacts to Won; stage settings; funnel + cost per stage per campaign / ad set / ad; MCP `contact_stage_funnel`. Stage pill on the contact record. Next: cost-per-stage columns in Performance, offline conversions per stage (off by default) |
| 2 Targets | ✅ | `goals` table, Settings → Targets & goals, `goalsPacing()` (MTD/QTD vs target, projection, budget), `<GoalsPacingWidget/>`, `stoplight()` / `targetFor()` helpers; Goals & pacing widget on the Overview (Lead gen, Agency presets), ROAS/MER KPI target bars, Performance stoplights |
| 4 Import & hygiene | ✅ | Contacts CSV import with column mapping and a new/update/invalid preview; duplicates review (same phone, Gmail variants, same name) with merge + re-attribution. Next: undo for merges (`contact_merges` snapshot), run very large imports as a job |
| 5 Analysis depth | ✅ | `/attribution/paths` (journeys + funnel), `/attribution/time-to-convert` (lag histograms, recommended window, weekday × hour heatmap, per-campaign lag), `/customers/cohorts` (retention / cumulative LTV / revenue heatmap), `/customers/payback` (LTV curves vs CAC); tab rows on Attribution and Customers; "Where the models disagree" dumbbell on Models; Funnel and Conversions heatmap widgets. Next: LTV by landing page / `utm_content`, New vs returning tab |
| C Money truth | ✅ | Ad receipts (`/receipts`, `/receipts/[paymentId]`, contact Receipt tab, REST + MCP `get_ad_receipt`; share-of-spend or clicks-only cost), Truth gap (`/truth`, platform-claimed vs verified value), Profit ledger (`/profit`, unit economics settings, POAS, break-even ROAS, waterfall), Time to money (`/profit/time-to-money`, "too early" rule used by Wasted spend and Insights cards, pause-draft CSVs); Money group in the sidebar; Truth gap and Profit widgets. Next: truth gap column pair on Performance, profit as conversion value (off by default) |
| Public site | ✅ | `site/index.html` in the Quiet Ledger look: tilting hero screenshot with the ad receipt, signature features, a scroll-driven product tour (sticky device frame, 11 areas, progress rail; stacked rows on phones and without JS), integrations, "Security & compliance ready" (GDPR/UK GDPR, CCPA/CPRA, ePrivacy/PECR, SOC 2-aligned controls, ISO 27001 mapping, OWASP; no certification claims), "Install your way" tabs (no-code Render/Railway, Docker Desktop, VPS one-liner, from source) with copy buttons, creator credit. Vanilla HTML/CSS/JS (`site.css`, `site.js`), reduced-motion aware + `site/trust.html`. Screenshots are copied from `docs/screenshots` at deploy time; to preview locally, copy them into `site/screenshots/` (gitignored) and serve `site/` with any static server |

## Next (v0.3)
- One-click OAuth “Connect with Meta / Google / TikTok / LinkedIn” (needs registered, approved apps).
- Verify conversion uploads (Meta CAPI, Google Ads) on live accounts; browser/server event-id sharing for Meta dedup.
- Verify beta connectors against live accounts; publish the WordPress plugin to wordpress.org.

## Backlog
- OAuth “Connect” buttons for Meta/Google instead of pasted tokens.
- WhatsApp click-to-chat attribution, Razorpay, Shopify, TikTok, LinkedIn.
- Meta Lead Ads webhook; sync to Twenty / HubSpot.
- Multi-user roles; agencies with many workspaces (schema is already multi-tenant).
- FX conversion across currencies; time-decay and position-based models.
- MCP write tools (always paused/draft by default, explicit confirmation).
