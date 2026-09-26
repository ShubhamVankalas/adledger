# Webflow

## Add the pixel

1. In AdLedger, open **Settings → Tracking** and copy the snippet (it already contains your
   address and site key).
2. In Webflow, open **Site settings → Custom code**.
3. Paste the snippet into **Head code** → **Save**.
4. **Publish** the site. Custom code only runs on the published site, not in the Designer.

Custom code needs a paid Site plan (or a Workspace plan that allows it).

## Capture form leads

1. In the Designer, select your form. Click the **Form** element inside the Form Block (not
   the outer Form Block).
2. **Settings panel (gear icon) → Custom attributes → +**.
3. Name: `data-adledger-lead`. Value: a name for the form, for example `Contact`.
4. Make sure the email field's **Name** contains "email" (Webflow's default `Email` works).
5. Publish.

Another option: AdLedger → **Settings → Tracking → Lead webhooks** → create one, then in
Webflow add a webhook with the trigger *Form submission* (Site settings → Apps & Integrations →
Webhooks) and paste the URL.

## Selling with Stripe Payment Links

See [Stripe Payment Links](README.md#stripe-payment-links) to pass the visitor id to Stripe.

## Check it works

1. Open the published site in a private window.
2. AdLedger → **Settings → Tracking** shows new page views within a minute.
3. Submit the form with a test email. It shows up as a lead.

## Troubleshooting

- **No page views:** check that you published after saving, and that you're looking at the
  published site, not the Designer preview.
- **"Allowed domains" is set in AdLedger:** add both your custom domain and
  `your-site.webflow.io` if you test on the staging domain.
- **Form not recorded:** the attribute must be on the `<form>` element. Check with your
  browser's *Inspect* tool that `<form … data-adledger-lead="Contact">` is there.
