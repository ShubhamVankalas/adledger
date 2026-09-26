# Shopify

Shopify needs three short steps: a custom pixel (visits), a theme snippet (links orders to
visits), and the Shopify connection in AdLedger (revenue).

Files: [`integrations/shopify/`](../../integrations/shopify/)

## 1. Custom pixel (tracks visits)

1. Copy your **site key** (`pk_…`) from AdLedger → **Settings → Tracking**.
2. Shopify admin → **Settings → Customer events → Add custom pixel** → name it `AdLedger`.
3. Paste [`custom-pixel.js`](../../integrations/shopify/custom-pixel.js).
4. At the top, set `ADLEDGER_URL` (your AdLedger address, no trailing slash) and `SITE_KEY`.
5. Choose the customer privacy permission that fits your consent setup → **Save** →
   **Connect**.

Don't also paste the regular AdLedger snippet into your theme; page views would be counted
twice.

## 2. Theme snippet (puts the visitor id on each order)

1. **Online Store → Themes → … → Edit code**.
2. **Snippets → Add a new snippet** → name it `adledger` → paste
   [`cart-attribute.liquid`](../../integrations/shopify/cart-attribute.liquid) → **Save**.
3. Open **layout/theme.liquid**. Just before `</head>`, add `{% render 'adledger' %}` →
   **Save**.

## 3. Revenue

1. AdLedger → **Settings → Connections → Shopify**. Follow the steps on the card.
2. Shopify admin → **Settings → Notifications → Webhooks → Create webhook** (JSON) with the
   URL from the AdLedger card, for **Order payment** and **Refund create**.
3. Copy the webhook signing secret shown on that page into AdLedger → **Save**.

## Check it works

1. Visit your store in a private window.
2. AdLedger → **Settings → Tracking** shows new page views within a minute.
3. Place a test order. In Shopify, the order's **Additional details** shows `adledger_vid`, and
   the order appears in AdLedger revenue.

## Troubleshooting

- **No page views:** the pixel must say **Connected**; check `ADLEDGER_URL` and `SITE_KEY`. If
  you set **Allowed domains** in AdLedger, leave it empty for this site key (Shopify's pixel
  sandbox may not send your store's domain).
- **Orders without `adledger_vid`:** the snippet is missing from the published theme's
  `theme.liquid`.
- **No revenue:** check webhook deliveries in Shopify and the connection status in AdLedger.

More detail: [`integrations/shopify/README.md`](../../integrations/shopify/README.md).
