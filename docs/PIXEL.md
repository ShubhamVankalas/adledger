# The AdLedger pixel

A 1.7 KB (gzipped) script that records visits, marketing parameters and leads on your site.

## Install

Copy your snippet from **Settings → Tracking** into the `<head>` of every page:

```html
<script>window.adledger=window.adledger||{q:[]};["identify","lead","track","consent"].forEach(function(m){adledger[m]=adledger[m]||function(){adledger.q.push([m].concat([].slice.call(arguments)))}});</script>
<script async src="https://YOUR-ADLEDGER/p/al.js" data-site="pk_..."></script>
```

The first line is a tiny queue so you can call `adledger.*` before the script has loaded.

## What it captures

- Page views (including single-page-app navigation via `history.pushState`)
- Full landing URL and referrer → UTMs and click IDs (`gclid`, `gbraid`, `wbraid`, `fbclid`,
  `ttclid`, `msclkid`, `li_fat_id`)
- Meta `_fbp` / `_fbc` cookies (builds `_fbc` from `fbclid` if missing)
- A random visitor ID in a first-party cookie `_al_vid` (2 years; localStorage fallback),
  shared across your subdomains

It does **not** fingerprint, read form fields you didn't ask for, or store full IP addresses.

## API

```js
adledger.lead({ email, phone, name }, "Book a demo"); // record a lead + identify
adledger.identify({ email, phone, name });            // link this browser to a person
adledger.track("pricing_viewed", { plan: "pro" });    // custom event
adledger.getVisitorId();                              // pass to Stripe Checkout
adledger.consent(false);                              // stop tracking + clear the ID
adledger.consent(true);                               // resume
```

**Zero-code lead capture:** add `data-adledger-lead="Form name"` to any `<form>`; on submit the
pixel reads fields named like email / phone / name.

## Options (attributes on the script tag)

| Attribute | Default | |
|---|---|---|
| `data-site` | — | Your site key (required) |
| `data-endpoint` | script origin + `/api/v1/collect` | Custom collector URL |
| `data-dnt="true"` | off | Respect the browser's Do-Not-Track |

## Consent

If you need opt-in consent, call `adledger.consent(false)` before the pixel loads (it's queued)
and `adledger.consent(true)` once the visitor accepts.

## Delivery

Events are batched and sent with `navigator.sendBeacon` as `text/plain` JSON (no CORS
preflight), retried once with `fetch(keepalive)`. The collector drops known bots, rate-limits per
IP, validates the site key and (optionally) the allowed domains.
