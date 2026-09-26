# Connecting your data

All connections are set up in **Settings → Connections** and stored encrypted. Each card also
shows these steps. Every connector has a demo mode, so you can explore first and connect later.

## Stripe (revenue)

1. Stripe Dashboard → **Developers → API keys → Create restricted key** with **Read** access to
   *Charges*, *Customers* and *Checkout Sessions*. (A secret key `sk_…` also works.)
2. **Developers → Webhooks → Add endpoint**
   - URL: shown on the Stripe card (`https://your-adledger/api/v1/webhooks/stripe/<workspace-id>`)
   - Events: `charge.succeeded`, `charge.refunded`, `checkout.session.completed`
3. Paste the restricted key and the endpoint's **signing secret** (`whsec_…`) → **Save** →
   **Sync now** to import the last 90 days.

**Connect payments to ad clicks.** AdLedger matches payments to people by email automatically.
For exact matching, pass the visitor ID when you create a Checkout Session:

```js
const session = await stripe.checkout.sessions.create({
  // ...
  client_reference_id: visitorId, // from adledger.getVisitorId() in the browser
});
```

or `metadata: { adledger_vid: visitorId }` on Payment Intents / Payment Links.

**Local testing:** `stripe listen --forward-to localhost:3000/api/v1/webhooks/stripe/<workspace-id>`
and paste the printed `whsec_…` secret into Settings.

## Meta Ads (Facebook + Instagram spend)

1. [Business Settings](https://business.facebook.com/settings) → **Users → System users → Add**
   (role: Admin).
2. **Add assets → Ad accounts** → select your accounts → *View performance*.
3. **Generate new token** → choose an app (create a “Business” app at developers.facebook.com
   if you have none) → permission **`ads_read`** → copy the token (system-user tokens don't expire).
4. In AdLedger paste the token and your ad account IDs (`act_123…`, comma-separated) → Save →
   Sync now.

AdLedger reads daily ad-level insights (spend, impressions, clicks, leads/purchases as reported
by Meta) with Marketing API `v26.0` by default; override the version on the card if needed.

## Google Ads

Google requires a developer token and OAuth. It takes ~15 minutes once (plus Google's approval
time for the token — apply early).

1. **Developer token:** Google Ads → Tools → **API Center** (in a manager account). *Basic
   access* is enough.
2. **OAuth client:** Google Cloud Console → enable **Google Ads API** → Credentials → *Create
   OAuth client ID* (type **Web application**, redirect URI
   `https://developers.google.com/oauthplayground`).
3. **Refresh token:** open the [OAuth Playground](https://developers.google.com/oauthplayground),
   gear icon → *Use your own OAuth credentials* → scope
   `https://www.googleapis.com/auth/adwords` → Authorize → *Exchange authorization code for
   tokens* → copy the **refresh token**.
4. In AdLedger enter the customer IDs to import (`123-456-7890`), the manager (MCC) ID if you
   access them through one, the developer token, client ID, client secret and refresh token →
   Save → Sync now.

AdLedger queries `ad_group_ad` daily metrics via Google Ads API `v25` `searchStream`.
`cost_micros` is converted to exact minor units (no floating point), including zero-decimal
currencies like JPY.

## UTM templates (important)

IDs in UTMs let AdLedger match each visit to the exact ad even after you rename things:

- **Meta** (Ad → Tracking → URL parameters):
  `utm_source=facebook&utm_medium=paid_social&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}`
- **Google** (Account settings → Tracking → Final URL suffix):
  `utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_term={adgroupid}&utm_content={creative}`
  and keep **auto-tagging** (gclid) on.

Without IDs, AdLedger falls back to matching campaign/ad names (case-insensitive), and unmatched
visits still count at channel level.

## Lead forms

- **Your own site:** add `data-adledger-lead="Form name"` to the `<form>`, or call
  `adledger.lead({ email, phone, name }, "Form name")`.
- **Typeform / Tally / Webflow / Zapier / Make:** Settings → Tracking → *Lead webhooks* →
  create one and paste the URL into the tool's webhook settings. Email, phone and name are
  detected automatically; add a hidden field `al_vid` with `adledger.getVisitorId()` to link the
  lead to its ad clicks.

## Demo / mock mode

`CONNECTOR_MODE=mock` makes every connector return realistic demo data in the platforms' real
API formats (see `src/lib/demo/world.ts` and `fixtures/`). New workspaces created with
“Start with demo data” use mock connections until you enter real credentials.
