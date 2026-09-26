# WordPress and WooCommerce

The AdLedger plugin adds the tracking pixel, records form leads and sends WooCommerce orders
and refunds to AdLedger. No theme editing.

## What you need

- Your AdLedger address, for example `https://adledger.example.com`
- Your **site key** (`pk_…`) from AdLedger → **Settings → Tracking**
- WooCommerce stores only: an **API key** (`al_…`) from AdLedger → **Settings → API keys**

## Install

1. Download [`integrations/wordpress/adledger.zip`](../../integrations/wordpress/adledger.zip)
   from the AdLedger repository.
2. In WordPress: **Plugins → Add New Plugin → Upload Plugin** → choose `adledger.zip` →
   **Install Now** → **Activate**.
3. Go to **Settings → AdLedger**.
4. Fill in **AdLedger URL** and **Site key**.
5. WooCommerce: paste the **API key** and keep **Send WooCommerce purchases and refunds**
   checked.
6. Click **Save Changes**.

## What the options do

| Option | Default | |
|---|---|---|
| Form leads | on | Records a lead when someone submits Contact Form 7, WPForms, Gravity Forms, Elementor, or any form with an email field. Plugin forms count only after a successful submission. |
| WooCommerce | on | Sends each paid order (status *Processing* or *Completed*) and each refund to AdLedger, in the background. |
| Administrators | on | Doesn't track you while you're logged in as an admin. |

For WooCommerce, the plugin also saves the visitor id on each order (`_adledger_vid`), so the
order is matched to the exact ad click, and links the buyer's email to their visits on the
thank-you page. It works with classic and block checkout and with HPOS.

## Check it works

1. Open your site in a private window (so you're not logged in).
2. In AdLedger, **Settings → Tracking** shows new page views within a minute.
3. Submit a form with a test email. It shows up as a lead.
4. WooCommerce: place a test order and mark it *Processing*. It shows up in revenue within a
   minute or two.

## Troubleshooting

- **No page views.** Log out or use a private window (admins aren't tracked by default).
  Clear any page cache (WP Rocket, LiteSpeed, Cloudflare) after saving the settings. View the
  page source and search for `al.js`.
- **Caching or "optimize JavaScript" plugins.** Exclude `al.js` and `adledger-wp.js` from
  combine/defer/delay settings.
- **A form isn't recorded.** It needs an email or phone field. For a custom form, add
  `data-adledger-lead="Form name"` to the `<form>` tag. To skip a form, add
  `data-adledger-ignore`.
- **Orders don't arrive.** Check **WooCommerce → Status → Logs**, source `adledger`. `HTTP 401`
  means the API key is wrong. Also check **Tools → Scheduled Actions**, group `adledger`: if
  actions stay *Pending*, WP-Cron isn't running on your host.
- **"Allowed domains" is set in AdLedger.** It must include your site's domain.
