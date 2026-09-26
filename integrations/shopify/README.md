# AdLedger for Shopify

Three pieces, about 10 minutes in total:

| File | What it does | Where it goes |
|---|---|---|
| `custom-pixel.js` | Page views on the store and checkout, and links the buyer's email to their visits | Shopify admin → Settings → Customer events |
| `cart-attribute.liquid` | Puts the visitor id on the cart, so each order carries it | Theme → Edit code → Snippets |
| Shopify connector | Imports paid orders and refunds (the revenue) | AdLedger → Settings → Connections |

## 1. Install the custom pixel

1. In AdLedger, open **Settings → Tracking** and copy your **site key** (`pk_…`).
2. In Shopify admin, go to **Settings → Customer events → Add custom pixel**. Name it `AdLedger`.
3. Paste the contents of [`custom-pixel.js`](custom-pixel.js).
4. At the top, set `ADLEDGER_URL` (your AdLedger address, e.g. `https://adledger.example.com`)
   and `SITE_KEY`.
5. Under **Customer privacy**, pick the permission that matches your consent setup
   (usually *Marketing* or *Analytics*). Click **Save**, then **Connect**.

Don't also paste the regular AdLedger `<script>` snippet into `theme.liquid`; that would count
every page view twice.

## 2. Add the cart attribute snippet

1. **Online Store → Themes → … → Edit code**.
2. Under **Snippets**, click **Add a new snippet**, name it `adledger`, and paste
   [`cart-attribute.liquid`](cart-attribute.liquid).
3. Open **layout/theme.liquid** and add this line just before `</head>`:

   ```liquid
   {% render 'adledger' %}
   ```

4. Save.

Every order now has a note attribute `adledger_vid`. You can see it on the order page under
**Additional details**.

## 3. Connect Shopify revenue in AdLedger

1. In AdLedger, go to **Settings → Connections → Shopify** and follow the steps on the card.
2. In Shopify admin, **Settings → Notifications → Webhooks → Create webhook** (format JSON)
   for these events, using the webhook URL shown on the AdLedger card:
   - `Order payment` (`orders/paid`)
   - `Refund create` (`refunds/create`)
3. Paste the webhook signing secret shown under the webhook list into AdLedger and save.

Orders are matched to ad clicks by `adledger_vid` first, then by the buyer's email.

## Check it works

1. Open your store in a private window with `?utm_source=test` on the URL.
2. In AdLedger, **Settings → Tracking** shows new page views within a minute.
3. Place a test order. The order shows up under revenue once the `orders/paid` webhook arrives.

## Troubleshooting

- **No page views.** Check the pixel is **Connected** in Customer events, and that
  `ADLEDGER_URL` has no trailing slash. Visitors who decline cookies in your consent banner are
  not tracked, depending on the permission you chose.
- **"Allowed domains" is set in AdLedger and nothing arrives.** Custom pixels run in a Shopify
  sandbox, so the browser may not send your store's domain as the origin. Leave **Allowed
  domains** empty for this site key, or create a separate site key for Shopify.
- **Orders have no `adledger_vid`.** Make sure `{% render 'adledger' %}` is in `theme.liquid`
  and that you edited the published theme. Headless or custom storefronts need to set the cart
  attribute themselves (`POST /cart/update.js` with `{"attributes": {"adledger_vid": "…"}}`).
- **Revenue missing.** Check the webhook deliveries in Shopify (Settings → Notifications →
  Webhooks) and the connection status in AdLedger.
