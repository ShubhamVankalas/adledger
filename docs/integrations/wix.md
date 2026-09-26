# Wix

## Add the pixel

1. In AdLedger, open **Settings → Tracking** and copy the snippet.
2. In your Wix dashboard, go to **Settings → Custom code** (under *Advanced*) →
   **+ Add Custom Code**.
3. Paste the snippet. Name it `AdLedger`.
4. **Add Code to Pages:** *All pages* → *Load code once*.
5. **Place Code in:** *Head* → **Apply**.

Custom code needs a Premium plan and a connected domain. Wix changes pages without a full
reload; the pixel still records each page view.

## Capture form leads

Wix Forms don't expose a normal HTML form, so use a lead webhook:

1. AdLedger → **Settings → Tracking → Lead webhooks** → create one and copy the URL.
2. Wix dashboard → **Automations → + Create Automation**.
3. Trigger: **Form submitted** (pick your form).
4. Action: **Send HTTP request** (called *Send a webhook* on some sites) → paste the URL →
   method POST → body: all form fields → **Activate**.

The lead is matched to the visitor by email.

## Wix Stores / Wix Payments revenue

There's no direct Wix revenue connector yet. Use Zapier or Make with the AdLedger Conversions
API: see [Zapier and Make](zapier-make.md).

## Check it works

1. Open your published site in a private window.
2. AdLedger → **Settings → Tracking** shows new page views within a minute.

## Troubleshooting

- **No page views:** custom code doesn't run in the Wix Editor or preview; test the published
  site. Check the code is set to *All pages* and *Head*.
- **"Allowed domains" is set in AdLedger:** include your Wix domain (and
  `yourname.wixsite.com` if you use it).
