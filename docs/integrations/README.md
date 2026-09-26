# Integrations

Pick your platform. Every guide starts from the snippet and site key in AdLedger →
**Settings → Tracking**, and ends with how to check that events arrive.

## Website builders and stores

| Platform | Guide | What you get |
|---|---|---|
| WordPress / WooCommerce | [wordpress.md](wordpress.md) | Plugin: pixel, form leads (CF7, WPForms, Gravity Forms, Elementor), WooCommerce orders and refunds |
| Shopify | [shopify.md](shopify.md) | Custom pixel, visitor id on orders, revenue via webhooks |
| Webflow | [webflow.md](webflow.md) | Pixel + form leads |
| Wix | [wix.md](wix.md) | Pixel + form leads via automation webhook |
| Squarespace | [squarespace.md](squarespace.md) | Pixel + form leads |
| Framer | [framer.md](framer.md) | Pixel + form leads |
| Google Tag Manager | [gtm.md](gtm.md) | Pixel as a Custom HTML tag + dataLayer leads |
| Next.js / React | [nextjs-react.md](nextjs-react.md) | SPA install, leads, visitor id on Stripe Checkout |
| Zapier / Make | [zapier-make.md](zapier-make.md) | Conversions API (payments, refunds, leads) and Spend API (any ad network) |
| WhatsApp | [whatsapp.md](whatsapp.md) | Click-to-chat and call clicks; WhatsApp conversations as leads linked to the ad click |

Any other site: paste the snippet from **Settings → Tracking** into the `<head>` of every
page. See [PIXEL.md](../PIXEL.md) for the full pixel API.

## Ready-made files

| File | Use |
|---|---|
| [`integrations/wordpress/adledger.zip`](../../integrations/wordpress/adledger.zip) | WordPress plugin, upload in Plugins → Add New → Upload Plugin |
| [`integrations/wordpress/adledger/`](../../integrations/wordpress/adledger/) | Plugin source |
| [`integrations/shopify/custom-pixel.js`](../../integrations/shopify/custom-pixel.js) | Shopify Customer Events custom pixel |
| [`integrations/shopify/cart-attribute.liquid`](../../integrations/shopify/cart-attribute.liquid) | Shopify theme snippet (visitor id on orders) |
| [`integrations/gtm/adledger-tag.html`](../../integrations/gtm/adledger-tag.html) | Google Tag Manager Custom HTML tag |

## Stripe Payment Links

If you sell with Stripe Payment Links (`buy.stripe.com/…`) on any site builder, add this after
the AdLedger snippet. It adds the visitor id to every Payment Link on the page, so AdLedger can
match the payment to the exact ad click:

```html
<script>
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest('a[href^="https://buy.stripe.com/"]');
    var vid = window.adledger && adledger.getVisitorId && adledger.getVisitorId();
    if (!a || !vid) return;
    var url = new URL(a.href);
    url.searchParams.set("client_reference_id", vid);
    a.href = url.toString();
  }, true);
</script>
```

Then connect Stripe in **Settings → Connections** (see [CONNECTORS.md](../CONNECTORS.md)).

## Checking any install

1. Open your site in a private window (no ad blocker, not logged in as admin).
2. AdLedger → **Settings → Tracking** shows new page views within a minute.
3. In the browser console, `adledger.getVisitorId()` returns an id.

If nothing arrives: check the site key, the AdLedger address, and **Allowed domains** (leave it
empty or include your site's domain).
