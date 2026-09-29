# FAQ

Short, honest answers, including what AdLedger can't do. Many of these are also on the
[website](https://shubhamvankalas.github.io/adledger/#faq).

**The basics**
- [Is it really free?](#is-it-really-free)
- [What does self-hosting cost?](#what-does-self-hosting-cost)
- [Do I need developer accounts?](#do-i-need-developer-accounts)
- [Does AdLedger change anything in my ad accounts?](#does-adledger-change-anything-in-my-ad-accounts)

**Data and accuracy**
- [Where does my data go?](#where-does-my-data-go)
- [Does it still work after Apple's iOS tracking changes?](#does-it-still-work-after-apples-ios-tracking-changes)
- [How accurate is it?](#how-accurate-is-it)
- [Why doesn't AdLedger match what Meta or Google report?](#why-doesnt-adledger-match-what-meta-or-google-report)
- [Which AI models can I use, and what do they see?](#which-ai-models-can-i-use-and-what-do-they-see)

**CRM, reports and clients**
- [Is there a CRM? Do I still need HubSpot?](#is-there-a-crm-do-i-still-need-hubspot)
- [How does the pipeline work?](#how-does-the-pipeline-work)
- [How do PDF reports work, and can a client tell one is genuine?](#how-do-pdf-reports-work-and-can-a-client-tell-one-is-genuine)
- [What can clients and viewers see?](#what-can-clients-and-viewers-see)

**Security and compliance**
- [Do I need a cookie banner? How does consent work?](#do-i-need-a-cookie-banner-how-does-consent-work)
- [Can I say we're SOC 2 or GDPR compliant because we use AdLedger?](#can-i-say-were-soc-2-or-gdpr-compliant-because-we-use-adledger)
- [I lost my phone and my recovery codes. How do I get back in?](#i-lost-my-phone-and-my-recovery-codes-how-do-i-get-back-in)
- [I forgot my password.](#i-forgot-my-password)

## Is it really free?

**Yes.** AdLedger is free to self-host and its source code is available on GitHub under the
[Functional Source License (FSL-1.1-ALv2)](../LICENSE). There is no paid edition, no
per-seat or revenue-based pricing and no feature held back: two-factor sign-in, the audit log,
unlimited team members and client logins, white-label PDF reports and the MCP server are all in the
free code. You pay only for the server you run it on.

### What is the licence, in plain words?

- **You can** install it, use it for your own business or your own ad accounts (agencies included),
  read and modify the code, and use it alongside professional services you provide to clients who run it.
- **You can't** sell AdLedger, sell a modified version of it, or offer it (or something built from it)
  as a competing product or hosted service.
- **After two years** each version converts to Apache-2.0, which is a fully permissive open source
  licence. Every release starts its own two-year clock.

This is a source-available, "Fair Source" licence. It is not an OSI-approved open source licence,
because it limits competing use. If your situation is unusual (for example you want to host AdLedger
for other companies as a paid service), open a Discussion or contact the maintainer first.

## What does self-hosting cost?

**The software is free**, so you pay only for where it runs. It needs about 1 GB of RAM, which a
small VPS covers for a few dollars a month. Render and Railway work too, at their own prices.

Your laptop is fine for trying it, but the pixel and payment webhooks need a public HTTPS address,
so use a server for real tracking. The one-line installer sets up HTTPS for free.

AI is optional. Ollama or LM Studio costs nothing, and a cloud model costs whatever its provider
charges for a short weekly note and the questions you ask.

## Do I need developer accounts?

**Not to try it.** The demo workspace fakes every integration, so you can explore everything first.

For real data:

- **Payment tools** mostly need no developer account. You paste a key or webhook secret from the
  dashboard (for Stripe, one restricted key). PayPal is the exception and needs a free REST app at
  developer.paypal.com.
- **Meta** needs a free Business app to create a system-user token with `ads_read`.
- **Google Ads** and **Microsoft Ads** need a developer token, and **X** needs Ads API access for
  your app. Google's and X's approvals can take a few days, so apply early.
- **TikTok, LinkedIn, Pinterest, Snapchat and Reddit** each need a free developer app.

Each integration card in the app walks you through the steps, and
[CONNECTORS.md](CONNECTORS.md) has the details.

Want to skip all of that? Export spend as a CSV from any ads manager and upload it, or send it to
the Spend API.

## Does AdLedger change anything in my ad accounts?

**No.** It only reads spend and, if you turn it on, uploads conversions (Meta Conversions API,
Google Ads) so the platforms can optimise on real sales. It never pauses ads or changes budgets.
When a campaign is old enough to judge and still losing money, **Profit → Time to money** gives you
a *pause draft*: a Meta bulk file or Google Ads Editor file that you review and import yourself.
MCP tools are read-only too.

## Where does my data go?

**It stays on your server.** AdLedger has no telemetry and sends nothing to us. The only outside
calls are the ones you set up: ad platform syncs, payment backfills, conversion uploads,
notifications, and your AI model if you pick a cloud one.

- Raw emails are kept in one table (`contacts`). Everywhere else, emails and phone numbers are
  stored as SHA-256 hashes (lowercased and trimmed).
- IP addresses are shortened before storage, and the pixel doesn't fingerprint.
- Connector credentials and 2FA secrets are encrypted at rest (AES-256-GCM). API keys and sessions
  are stored hashed.
- The AI model only sees campaign totals, never contacts. The MCP server is read-only and masks emails.

More in [SECURITY.md](SECURITY.md).

## Does it still work after Apple's iOS tracking changes?

**Mostly, because it doesn't rely on what Apple restricted.** App Tracking Transparency limits
tracking across apps, which hurts the ad platforms' own pixels. AdLedger uses a first-party pixel
on your own site and gets payments straight from Stripe or your store by webhook, so a sale is
recorded even when the ad platform can't see it.

Some limits remain:

- Safari keeps cookies set by scripts for 7 days at most. If someone clicks an ad and comes back
  more than a week later without having filled in a form, the first click can be missed.
- Safari's Link Tracking Protection strips click IDs such as `gclid` and `fbclid` in Mail,
  Messages and Private Browsing. UTM parameters are kept, which is why the
  [recommended UTM templates](CONNECTORS.md#utm-templates-important) carry campaign and ad IDs.
- Serving AdLedger from a subdomain of your site (for example `t.yourshop.com`) keeps the cookie
  first-party and makes ad blockers less likely to block it. See
  [SELF_HOSTING.md](SELF_HOSTING.md#first-party-cookies-recommended).

## How accurate is it?

**Exact about the money it can see, and open about what it can't.** Every payment is stored to
the cent, and split credit always adds up to the payment.

- **It counts clicks, not views.** Someone who saw an ad and later typed your address directly
  isn't credited to that ad, and there are no estimated or modelled conversions.
- **Some visits are invisible.** Ad blockers and strict browsers can stop the pixel, and in
  "consent required" mode nothing is recorded for people who don't agree.
- **Cross-device journeys** are joined only when the person leaves the same email (or phone
  number) on each device.
- **Revenue without a tracked click** is shown as unattributed rather than guessed.
- **Three rule-based models:** first touch, last touch and linear. There is no data-driven model yet.
- **Ad and payment connectors other than Meta, Google Ads and Stripe are in beta.** See
  [CONNECTORS.md](CONNECTORS.md#all-integrations).

## Why doesn't AdLedger match what Meta or Google report?

Because they count differently. Ad platforms include view-throughs, modelled conversions and their
own attribution windows, and every platform can claim the same sale. AdLedger counts payments it
received from people who clicked. The **Truth gap** page puts both side by side per platform and
campaign, so you can see how much each platform over- or under-claims, and why.

## Which AI models can I use, and what do they see?

Any of these, or none: **Ollama** or **LM Studio** running locally (free and private), OpenAI,
Anthropic, Gemini, OpenRouter, DeepSeek, or any OpenAI-compatible endpoint. Pick one in
**Settings → AI model**.

The model only writes words. Numbers come from SQL, the model sees aggregated figures (never
contacts), and any number it writes that isn't in the ledger is flagged. Without a model, insights
and Ask fall back to rule-based text and built-in lookups.

## Is there a CRM? Do I still need HubSpot?

AdLedger includes a CRM built around ad cost: **contacts** with saved views, filters and bulk
actions, a **record page** with a full timeline of ad clicks, visits, forms and payments, **notes**,
**tasks**, **tags**, **owners**, a **pipeline** kanban, **CSV import** and **duplicate merge**. Every
lead shows where it came from and what it cost.

It isn't a sales-automation suite: there are no email sequences, open tracking, quotes or a shared
inbox. If your team lives in HubSpot or Pipedrive, keep it and connect it: AdLedger reads won deals
from both, so revenue still gets attributed to the right ads.

## How does the pipeline work?

`/pipeline` is a kanban of contacts by stage. The default stages are New lead → Qualified →
Call booked → Proposal → Won → Lost; rename, recolour, reorder or add stages, and set a win
probability and a "rotting" limit per stage in **Settings → Pipeline stages**. Move contacts by
dragging (mouse, touch or keyboard) or in bulk, with Undo. A new payment moves the contact to Won
automatically. The **Funnel & cost** view shows how many contacts reached each stage and the ad
cost per stage by campaign, ad set or ad.

## How do PDF reports work, and can a client tell one is genuine?

Open **Reports**, pick a report (executive summary, weekly performance, attribution model
comparison, LTV and cohorts, wasted spend and budget moves) and a period, then **Download PDF** or
**Schedule** a weekly or monthly email. PDFs are rendered inside the app: no headless browser, no
extra container. Your organization's logo goes on the masthead.

Every page carries a "Prepared for" watermark and a **fingerprint**. Anyone holding the PDF can
paste the fingerprint at `/verify` on your AdLedger to confirm your install issued it; the page
shows only what the cover already says. Details in [REPORTS.md](REPORTS.md).

## What can clients and viewers see?

**Clients** see only the workspaces you pick, read-only. **Viewers** see every workspace,
read-only. Both see contact emails masked (`p•••@gmail.com`) and can't export or edit contacts.
Viewers can add notes and tasks; clients never see them. Owners decide in **Settings → Organization → Security policy**
whether clients may download PDF reports (aggregates only). For someone without an account, create
a **share link** (Settings → Sharing): a read-only dashboard of aggregates that expires and can be
revoked.

## Do I need a cookie banner? How does consent work?

Probably, if you have visitors in the EU or UK. AdLedger processes emails, click IDs and the
`_fbp`/`_fbc` cookies, so it doesn't qualify for the analytics exemptions some regulators offer.
Mention it in your privacy notice and cookie banner.

Each website has a **consent mode** (Settings → Tracking & forms):

- **Opt-out** (default): tracks until the visitor says no (`adledger.consent(false)`).
- **Consent required**: stores and sends nothing until `adledger.consent(true)`.
- **Cookieless**: a fresh ID per page load, weaker attribution.

Copy-paste snippets connect it to Cookiebot, CookieYes, Osano, Klaro or Google Consent Mode v2.
Global Privacy Control is honoured. Conversions uploaded to Meta and Google carry consent signals,
and people who said no are never uploaded. See [PIXEL.md](PIXEL.md#consent).

## Can I say we're SOC 2 or GDPR compliant because we use AdLedger?

**No, and neither do we.** SOC 2 and ISO 27001 audit an organisation running a service, not a piece
of software, and compliance with GDPR, UK GDPR, CCPA/CPRA or India's DPDP depends on how you
collect, use and protect data. When you self-host AdLedger, **you are the data controller**.

What you can say is that you use a tool **built to help you meet** those laws: it ships consent
modes, data export and erasure, retention, hashing, role-based masking, two-factor sign-in and a
tamper-evident audit log, and its controls map to common SOC 2 criteria. The project itself holds
no certification. [SECURITY.md](SECURITY.md#41-how-the-controls-help-with-privacy-laws) maps each
control to the obligation it helps with and what stays your job.

## I lost my phone and my recovery codes. How do I get back in?

If you're a **member**, ask an owner: they can reset your two-factor sign-in in
**Settings → Organization → Security policy**.

If you're the **owner** (break-glass):

1. Set `ADLEDGER_BREAK_GLASS=you@yourcompany.com` in the server environment (`.env` with Docker)
   and restart AdLedger (`docker compose up -d`).
2. On start, two-factor sign-in is turned off for that account (only if it owns an organization).
   The reset is written to the audit log and raises a security alert.
3. Sign in with your password, set up two-factor sign-in again, then **remove the variable** and
   restart.

Anyone who can change the server's environment already controls the install, so this doesn't open
a new way in. See [SECURITY.md](SECURITY.md#locked-out-of-two-factor-sign-in-break-glass).

## I forgot my password.

Set `ADMIN_EMAIL`, `ADMIN_PASSWORD` and `RESET_PASSWORD=true` in `.env`, run
`docker compose up -d`, sign in, then remove `RESET_PASSWORD`. See
[SELF_HOSTING.md](SELF_HOSTING.md#troubleshooting).
