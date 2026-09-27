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
| M8 MCP server | ✅ | 8 read-only tools at `/api/mcp`, API-key auth, tests prove no writes |
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
| WordPress/WooCommerce plugin, Shopify pixel, GTM tag, site-builder guides | ✅ | `integrations/`, `docs/integrations/` |
| First-run choice + guided setup checklist with live checks | ✅ | |
| Real brand logos | ✅ | Simple Icons (CC0) + drawn marks |
| Redesign phase 1c: Overview widget board | ✅ | Metric + widget registries, widgets 1–15, briefing sentence, KPI sparklines, Metric explorer, presets, edit mode (drag, sizes, sections), pinning, personal view / workspace default (`dashboards`). Next: widgets 16–24 (phase 2+), target settings UI, per-widget range override, mobile accordions |

## Redesign ("Quiet Ledger", docs/redesign/BRIEF.md)

| Phase | Status | Notes |
|---|---|---|
| 1a Tokens + shell | ✅ | OKLCH tokens, ink primary, restyled primitives; sidebar groups, workspace switcher, setup ring, `[` rail; 52px header with demo pill and pending line; date presets + compare in the URL; floating phone tab bar; `/attribution`, `/customers` (old URLs redirect); `/live`, `/pipeline`, `/tasks` placeholders |
| 1b ⌘K + hotkeys | ⏳ | The sidebar already dispatches `adledger:open-palette` / `adledger:open-shortcuts` |
| 1c Overview v2 | ⏳ | |
| B Reports & PDF | ✅ | react-pdf + in-house SVG chart kit; 5 kinds (executive summary, weekly performance, attribution models, LTV & cohorts, wasted spend & budget moves) with methodology appendix; `/reports` gallery, download + weekly/monthly email schedules (`report_schedules`); `export_log`, "Prepared for" watermark, fingerprint + public `/verify`; print stylesheet. Next: truth report, share links, branding settings, Noto Sans Devanagari files, protected/archival PDFs, Slack/webhook delivery |

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
