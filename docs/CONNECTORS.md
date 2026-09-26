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

## Enable one-click connect

Pasting tokens is fine for one install, but if you run AdLedger for clients or a team you can let
people click **Connect with Meta / Google / TikTok / LinkedIn** instead: they sign in with the
platform, tick the ad accounts to import, and AdLedger saves the connection and starts a sync.

The install's admin registers one OAuth app per platform (once) and sets its credentials as
environment variables (`.env`, or your host's settings), then restarts AdLedger. Platforms without
env vars keep the manual form, with a note explaining how to enable this. The **redirect URI** to
register is always `<PUBLIC_URL>/api/v1/oauth/<provider>/callback` — set `PUBLIC_URL` so it's stable.

| Platform | Env vars | Redirect URI path | Where to create the app |
|---|---|---|---|
| Meta | `META_APP_ID`, `META_APP_SECRET` (+ `META_LOGIN_CONFIG_ID` for Business apps) | `/api/v1/oauth/meta/callback` | developers.facebook.com → Create app (Business) → add **Facebook Login for Business** + **Marketing API**; create a login configuration (User access token, permission `ads_read`) and set its ID as `META_LOGIN_CONFIG_ID` (without it the classic `scope=ads_read` is sent). `ads_read` needs Advanced Access / app review for accounts outside your business |
| Google Ads | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_ADS_DEVELOPER_TOKEN` | `/api/v1/oauth/google_ads/callback` | Google Cloud Console → enable Google Ads API → OAuth client (Web application); consent screen with scope `…/auth/adwords`. Developer token from Google Ads → API Center |
| TikTok | `TIKTOK_APP_ID`, `TIKTOK_APP_SECRET` | `/api/v1/oauth/tiktok_ads/callback` | business-api.tiktok.com → My apps → create an app with Ad Account Management + Reporting scopes; set the advertiser redirect URL |
| LinkedIn | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | `/api/v1/oauth/linkedin_ads/callback` | linkedin.com/developers → app with the **Advertising API** product; scopes `r_ads`, `r_ads_reporting`; add the redirect URL in the Auth tab |

How it works: `/api/v1/oauth/<provider>/start` checks the user may manage integrations, stores the
state (and a PKCE verifier for Google) in a signed, httpOnly cookie and redirects to the platform.
The callback verifies the state, exchanges the code, and keeps the tokens in an encrypted cookie for
15 minutes while the user picks accounts. The connection is then saved with the same keys as the
manual form (`accessToken`, `refreshToken`, `adAccountIds`, `customerIds`, …), encrypted with
`APP_SECRET`, so scheduled syncs work exactly the same. Token lifetimes: Google and LinkedIn (when
your app has refresh tokens) renew automatically; Meta user tokens last ~60 days and TikTok tokens
don't expire — reconnect from the same dialog when a sync reports an expired token.

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

## All integrations

| Category | Integration | Status | How data arrives |
|---|---|---|---|
| Ad platforms | Meta Ads, Google Ads | Stable | Scheduled sync every 6 h |
| Ad platforms | Microsoft Ads, TikTok, LinkedIn, Pinterest, Snapchat, Reddit, X | Beta | Scheduled sync every 6 h |
| Payments & stores | Stripe | Stable | Webhooks (auto-created) + 90-day backfill |
| Payments & stores | Shopify, WooCommerce | Beta | Signed webhooks + backfill |
| Payments & stores | Paddle, Lemon Squeezy, Razorpay, PayPal | Beta | Signed webhooks |
| Anything else | CSV import, Spend API, Conversions API | Stable | Upload or push (Zapier, Make, n8n, scripts) |
| Website | Pixel, WordPress plugin, Shopify custom pixel, GTM tag | Stable | Browser → `/api/v1/collect` |
| Notifications | Email (SMTP), Slack, Discord, Microsoft Teams, SMS (Twilio), webhook | Stable | Rules in Settings → Notifications |

“Beta” connectors follow each platform's official API documentation and are covered by contract tests
against real-format sample responses (`fixtures/`), but haven't yet been verified against every kind of
live account. Please open an issue if something doesn't match your account.

Every revenue webhook URL is shown in the integration's dialog:
`https://your-adledger/api/v1/webhooks/<provider>/<workspace-id>` (Stripe: `/api/v1/webhooks/stripe/<workspace-id>`).

## Trying integrations without real accounts

You don't need any ad or payment account to evaluate AdLedger — the demo workspace (and
`CONNECTOR_MODE=mock`) serves realistic data for every integration. When you're ready to test with
real APIs, all of these are free and use fake money:

| Platform | Free test option |
|---|---|
| Stripe | Test mode (toggle in the dashboard). Fake cards like `4242 4242 4242 4242`. |
| Shopify | A free development store from a Shopify Partners account. |
| PayPal | Sandbox accounts at developer.paypal.com. |
| Razorpay, Paddle, Lemon Squeezy | Test / sandbox mode in each dashboard. |
| Meta | A sandbox ad account from your Meta developer app (no real spend). |
| Google Ads | A test manager account; the test developer token works immediately. |
| TikTok | The TikTok for Business API sandbox. |
