# Google Tag Manager

If your site already uses Google Tag Manager (GTM), add AdLedger as a tag.

Files: [`integrations/gtm/`](../../integrations/gtm/)

## Steps

1. In AdLedger, open **Settings → Tracking** and note your AdLedger address and site key.
2. GTM → **Tags → New → Tag Configuration → Custom HTML**. Name it `AdLedger - Pixel`.
3. Paste [`adledger-tag.html`](../../integrations/gtm/adledger-tag.html) (or the snippet from
   Settings → Tracking). Replace `YOUR-ADLEDGER` and `pk_REPLACE_ME`.
4. **Triggering → All Pages** → **Save**.
5. **Submit → Publish**.

## Leads from the dataLayer

If a form pushes an event like `{ event: "lead_submitted", lead_email: "…" }`, create Data
Layer Variables and a Custom HTML tag that calls `adledger.lead(...)` on that event. The full
example is in [`integrations/gtm/README.md`](../../integrations/gtm/README.md#2-send-leads-from-the-datalayer-optional).

For regular HTML forms it's simpler to add `data-adledger-lead="Form name"` to the `<form>`.

## Check it works

1. GTM **Preview** → open your site → `AdLedger - Pixel` is listed under *Tags Fired*.
2. AdLedger → **Settings → Tracking** shows new page views within a minute.

## Troubleshooting

- **Tag fires, no events:** in the browser console run `adledger.getVisitorId()`. An id means
  the pixel loaded; then check the address, site key and **Allowed domains**.
- **`adledger` is undefined:** the container isn't published, or an ad blocker blocks GTM.
- **Consent:** fire the tag only after consent, or call `adledger.consent(false)` /
  `adledger.consent(true)` from your consent tags.
