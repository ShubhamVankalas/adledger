# Squarespace

## Add the pixel

1. In AdLedger, open **Settings → Tracking** and copy the snippet.
2. In Squarespace, open **Settings → Advanced → Code Injection** (on newer sites:
   **Website → Pages → Custom code → Code injection**).
3. Paste the snippet into **Header** → **Save**.

Code injection needs a Core/Business plan or higher.

## Capture form leads

Squarespace form blocks can't take custom attributes, so also paste this into
**Code Injection → Footer**:

```html
<script>
  // AdLedger: record Squarespace form submissions that have an email field as leads.
  document.addEventListener("focusin", function (e) {
    var f = e.target && e.target.form;
    if (f && !f.hasAttribute("data-adledger-lead") && f.querySelector("input[type=email]")) {
      f.setAttribute("data-adledger-lead", document.title || "Squarespace form");
    }
  });
</script>
```

Another option: connect the form's **Storage** to Zapier and send it to an AdLedger lead
webhook (**Settings → Tracking → Lead webhooks**).

## Squarespace Commerce revenue

Use Zapier or Make with the AdLedger Conversions API: see [Zapier and Make](zapier-make.md).
If you sell with Stripe Payment Links, see [Stripe Payment Links](README.md#stripe-payment-links).

## Check it works

1. Log out (or use a private window) and open your site.
2. AdLedger → **Settings → Tracking** shows new page views within a minute.
3. Submit a form with a test email. It shows up as a lead.

## Troubleshooting

- **No page views:** code injection doesn't run while you're editing; view the live site
  logged out. Check the snippet is in *Header*, not in a Code Block.
- **"Allowed domains" is set in AdLedger:** include your domain and `yoursite.squarespace.com`
  if you test there.
