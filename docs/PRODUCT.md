# AdLedger — Product Spec

## One-liner
**The open-source Hyros.** See exactly which ad, campaign, and keyword produced leads,
customers, and revenue — self-hosted, free, with AI you bring yourself and an MCP server
so Claude/Codex can answer "which ads made money?"

## The problem
- Businesses spend on Meta and Google Ads but can't trust in-platform numbers (iOS privacy
  changes, short attribution windows, every platform takes credit for the same sale).
- Real answers need joining **ad spend** + **first-party clicks/visits** + **leads/CRM**
  + **actual revenue**. Tools that do this (Hyros, Triple Whale, Cometly, Wicked Reports)
  cost roughly $129 to $2,500+/month and often price by revenue tracked.
- No serious open-source, self-hosted option exists.

## Who it's for
1. **Startups and SaaS founders** running Meta/Google Ads with Stripe billing.
2. **D2C / e-commerce brands** (Shopify later) who want true ROAS.
3. **Performance marketing agencies** managing many clients (multi-workspace).
4. **Local businesses and lead-gen** (clinics, coaching, real estate) that collect leads
   via forms and close deals offline.

## Core user story (MVP)
> "I spent ₹2,00,000 on ads last month. AdLedger shows me that Campaign A brought 40 leads
> and ₹6,50,000 in Stripe revenue (ROAS 3.25), while Campaign B brought 90 leads and only
> ₹40,000 (ROAS 0.2). The AI summary tells me to move budget from B to A and why."

## MVP features (v0.1)
1. **Ad spend sync:** Meta Ads + Google Ads, daily spend/impressions/clicks at campaign,
   ad set/ad group, and ad level.
2. **First-party pixel:** one `<script>` tag. Captures page views, UTMs, click IDs
   (`fbclid`, `gclid`, `gbraid`, `wbraid`, `ttclid`), `_fbp`/`_fbc` cookies, referrer,
   landing page. Sets an anonymous visitor ID (first-party cookie + localStorage fallback).
3. **Lead capture:** `adledger.identify({email, phone, name})` in JS, plus a generic
   **webhook endpoint** for form tools (Typeform, Tally, Webflow, custom forms).
4. **Revenue sync:** Stripe (webhooks + backfill). Link payments to contacts by email.
5. **Identity stitching:** anonymous visitor → contact (on identify/lead) → customer
   (on payment). All earlier touchpoints of that visitor get attached.
6. **Attribution:** first-touch, last-touch, linear models. Switchable in the UI.
7. **Dashboard:** spend → leads → customers → revenue per campaign / ad set / ad, with
   ROAS, CAC, CPL, and a date range picker. A contact timeline ("journey") view.
8. **AI insights (BYO model):** weekly summary of what changed and why, wasted-spend flags,
   budget shift suggestions. Works with Ollama, LM Studio, or any API key.
9. **MCP server (read-only):** agents can query spend, attribution, top/bottom ads,
   contact journeys, and generate the AI report.
10. **Demo mode:** seeded realistic data + mock connectors so anyone can try it in 2 minutes.

## Explicitly NOT in v0.1 (later)
- Writing back to ad platforms (pause campaigns, change budgets)
- TikTok, LinkedIn, Shopify, Razorpay, HubSpot/Twenty sync (v0.2+)
- Full CRM (deal pipelines, tasks, email sending)
- Multi-user auth/roles beyond a single admin (v0.2)
- Data-driven/ML attribution models

## Success criteria for launch
- A non-technical person can install it: one command (`docker compose up -d` or `install.sh`), or a one-click deploy.
- `git clone` → `docker compose up` → working demo dashboard in under 5 minutes.
- A real Stripe test account + real Meta/Google account can be connected from the Settings page (no config files).
- README has a 20-second GIF: dashboard → "which ad made money" → MCP answer in Claude.
- Clear comparison table vs Hyros/Triple Whale/Cometly in README.

## Positioning / README headline options
- "AdLedger — the open-source Hyros. Know which ads actually make money."
- "Self-hosted ad attribution with AI and MCP. Free forever."
