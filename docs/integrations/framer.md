# Framer

## Add the pixel

1. In AdLedger, open **Settings → Tracking** and copy the snippet.
2. In Framer, open **Site Settings → General → Custom Code**.
3. Paste it into **End of `<head>` tag** → **Save**.
4. **Publish**.

Framer changes pages without a full reload; the pixel still records each page view.

## Capture form leads

1. In your Framer form, set the email input's **Name** to `email` (and the name input's to
   `name`, the phone input's to `phone`).
2. Paste this into **Custom Code → End of `<body>` tag**:

   ```html
   <script>
     // AdLedger: record Framer form submissions that have an email field as leads.
     document.addEventListener("focusin", function (e) {
       var f = e.target && e.target.form;
       if (f && !f.hasAttribute("data-adledger-lead") && f.querySelector("input[type=email], input[name=email]")) {
         f.setAttribute("data-adledger-lead", document.title || "Framer form");
       }
     });
   </script>
   ```

3. Publish.

Another option: AdLedger → **Settings → Tracking → Lead webhooks** → create one and paste the
URL in the Framer form's **Send To → Webhook** setting.

## Selling with Stripe Payment Links

See [Stripe Payment Links](README.md#stripe-payment-links).

## Check it works

1. Open the published site in a private window.
2. AdLedger → **Settings → Tracking** shows new page views within a minute.
3. Submit the form with a test email. It shows up as a lead.

## Troubleshooting

- **No page views:** custom code only runs on the published site, not in the Framer canvas or
  preview.
- **"Allowed domains" is set in AdLedger:** include your domain and `yoursite.framer.website`
  if you test there.
