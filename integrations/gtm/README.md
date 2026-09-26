# AdLedger for Google Tag Manager

Use this if your site already runs Google Tag Manager (GTM). You add AdLedger once in GTM and
it runs on every page, no site code changes.

## 1. Add the pixel tag

1. In AdLedger, open **Settings → Tracking** and note your AdLedger address and **site key**
   (`pk_…`).
2. In GTM, go to **Tags → New → Tag Configuration → Custom HTML**. Name it `AdLedger - Pixel`.
3. Paste [`adledger-tag.html`](adledger-tag.html). Replace `YOUR-ADLEDGER` with your AdLedger
   address and `pk_REPLACE_ME` with your site key.
4. **Triggering → All Pages** (the built-in *Initialization - All Pages* trigger also works and
   fires a little earlier).
5. Optional: **Advanced settings → Tag firing priority** `100`, so the pixel loads before your
   other AdLedger tags.
6. **Save → Submit → Publish**.

Single-page apps work without extra triggers: the pixel records route changes itself.

## 2. Send leads from the dataLayer (optional)

Forms with an email field are easiest to capture by adding `data-adledger-lead="Form name"`
to the `<form>` tag. If you can't edit the form but it pushes to the dataLayer, use a tag:

Your site (or form tool) pushes something like:

```js
window.dataLayer.push({
  event: "lead_submitted",
  lead_email: "jane@example.com",
  lead_phone: "+15551234567",
  lead_name: "Jane Doe",
  form_name: "Book a demo",
});
```

In GTM:

1. **Variables → New → Data Layer Variable** for `lead_email`, `lead_phone`, `lead_name`
   and `form_name` (name them `DLV - lead_email`, etc.).
2. **Triggers → New → Custom Event**, event name `lead_submitted`.
3. **Tags → New → Custom HTML**, name `AdLedger - Lead`, with the trigger above:

   ```html
   <script>
     window.adledger && adledger.lead(
       { email: {{DLV - lead_email}}, phone: {{DLV - lead_phone}}, name: {{DLV - lead_name}} },
       {{DLV - form_name}} || "GTM lead"
     );
   </script>
   ```

4. Publish.

The same pattern works for custom events: `adledger.track("pricing_viewed", { plan: "pro" })`.

## Consent

If you use Consent Mode or a consent banner, either fire the pixel tag only after consent, or
add a tag on page load with `adledger.consent(false)` and one on consent granted with
`adledger.consent(true)`.

## Check it works

1. Click **Preview** in GTM and open your site. `AdLedger - Pixel` should be under
   *Tags Fired*.
2. In AdLedger, **Settings → Tracking** shows new page views within a minute.

## Troubleshooting

- **Tag fired but no events.** Open the browser console on your site and type
  `adledger.getVisitorId()`. If it returns an id, the pixel loaded; check the AdLedger address
  and site key. If "Allowed domains" is set in AdLedger, it must include this site's domain.
- **Nothing in the console / `adledger` is undefined.** The container isn't published, or an
  ad blocker is blocking GTM. Test in a private window without extensions.
- **Leads not showing.** In GTM Preview, check the `lead_submitted` event fired and the
  variables have values. The lead needs an email or a phone.
