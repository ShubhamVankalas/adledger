=== AdLedger ===
Contributors: adledger
Tags: attribution, analytics, woocommerce, ads, leads
Requires at least: 6.0
Tested up to: 6.6
Requires PHP: 7.4
Stable tag: 0.1.0
License: AGPL-3.0-or-later
License URI: https://www.gnu.org/licenses/agpl-3.0.html

See which ad actually made you money. Connects WordPress and WooCommerce to your self-hosted AdLedger.

== Description ==

[AdLedger](https://github.com/ShubhamVankalas/adledger) is a free, open-source, self-hosted ad attribution tool. It joins your ad spend, website visits, leads and revenue so you can see real ROAS per campaign and ad.

This plugin:

* Adds the AdLedger tracking pixel to every page (no theme editing).
* Records leads from Contact Form 7, WPForms, Gravity Forms, Elementor forms and any regular form with an email field. Plugin forms are recorded only after a successful submission.
* WooCommerce: saves the visitor id on each order, sends paid orders and refunds to AdLedger from your server, and links the buyer to their visits on the thank-you page. Works with classic and block checkout and with High-Performance Order Storage (HPOS).
* Optionally skips logged-in administrators so your own visits don't count.

You need a running AdLedger instance. This plugin sends data only to the AdLedger URL you enter.

== Installation ==

1. Plugins → Add New → Upload Plugin → choose `adledger.zip` → Install → Activate.
2. Go to Settings → AdLedger.
3. Enter your AdLedger URL (for example `https://adledger.example.com`) and your site key (`pk_…`) from AdLedger → Settings → Tracking.
4. WooCommerce stores: create an API key in AdLedger → Settings → API keys and paste it into "API key". Keep "Send WooCommerce purchases" checked.
5. Save. Open your site in a private window, then check AdLedger → Settings → Tracking for new events.

== Frequently Asked Questions ==

= Does it slow down my site? =

No. The pixel is under 2 KB and loads async. WooCommerce orders are sent in the background with Action Scheduler (built into WooCommerce), never during checkout.

= Where do I see errors? =

WooCommerce → Status → Logs, source "adledger". Failed sends are retried up to 3 times.

= A form is not recorded as a lead =

The form needs an email or phone field. For a custom form, add `data-adledger-lead="Form name"` to the `<form>` tag. To exclude a form, add `data-adledger-ignore`.

= Do I need a cookie banner? =

That depends on your country and setup. The pixel sets one first-party cookie (`_al_vid`). If you need opt-in consent, call `adledger.consent(false)` until the visitor accepts, then `adledger.consent(true)`.

= Developer hooks =

* `adledger_tracking_enabled` (filter, bool): turn tracking off for a request.
* `adledger_conversion_event` (filter, array $event, WC_Order $order, string $kind): change the event sent to AdLedger.

== Changelog ==

= 0.1.0 =
* First release: pixel, form leads, WooCommerce payments and refunds.
