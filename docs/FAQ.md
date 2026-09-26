# FAQ

Short, honest answers, including what AdLedger can't do. The same questions are on the
[website](https://shubhamvankalas.github.io/adledger/#faq).

- [Where does my data go?](#where-does-my-data-go)
- [Does it still work after Apple's iOS tracking changes?](#does-it-still-work-after-apples-ios-tracking-changes)
- [How accurate is it?](#how-accurate-is-it)
- [What does self-hosting cost?](#what-does-self-hosting-cost)
- [Do I need developer accounts?](#do-i-need-developer-accounts)

## Where does my data go?

**It stays on your server.** AdLedger has no telemetry and sends nothing to us. The only outside
calls are the ones you set up: ad platform syncs, payment backfills, notifications, and your AI
model if you pick a cloud one.

- Raw emails are kept in one table (`contacts`). Everywhere else, emails and phone numbers are
  stored as SHA-256 hashes (lowercased and trimmed).
- IP addresses are shortened before storage, and the pixel doesn't fingerprint.
- Connector credentials are encrypted at rest (AES-256-GCM). API keys and sessions are stored hashed.
- The pixel supports consent (`adledger.consent(false)`) and, optionally, Do-Not-Track. See
  [PIXEL.md](PIXEL.md#consent).
- The AI model only sees campaign totals, never contacts. The MCP server is read-only and masks emails.

As with any analytics tool, mention AdLedger in your privacy notice and cookie banner.

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
- **Your numbers won't match Meta's or Google's reports.** Those include view-throughs, modelled
  conversions and their own attribution windows.
- **Some visits are invisible.** Ad blockers and strict browsers can stop the pixel.
- **Cross-device journeys** are joined only when the person leaves the same email (or phone
  number) on each device.
- **Revenue without a tracked click** is shown as unattributed rather than guessed.
- **Three rule-based models:** first touch, last touch and linear. There is no data-driven model yet.
- **Ad and payment connectors other than Meta, Google Ads and Stripe are in beta.** See
  [CONNECTORS.md](CONNECTORS.md#all-integrations).

## What does self-hosting cost?

**The software is free** ([AGPL-3.0](../LICENSE)), with no per-seat or revenue-based pricing. You
pay only for where it runs. It needs about 1 GB of RAM, which a small VPS covers for a few dollars
a month. Render and Railway work too, at their own prices.

Your laptop is fine for trying it, but the pixel and payment webhooks need a public HTTPS address,
so use a server for real tracking. The one-line installer sets up HTTPS for free.

AI is optional. Ollama or LM Studio costs nothing, and a cloud model costs whatever its provider
charges for one short note a week.

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
