# WhatsApp click-to-chat & call tracking

Many businesses (especially in India and for local services) get leads through a "Chat on
WhatsApp" or "Call us" button instead of a form. AdLedger attributes those too:

- **Clicks** on WhatsApp and phone links are recorded automatically by the pixel as
  `whatsapp_click` and `call_click` events (visible in the visitor's timeline).
- **WhatsApp conversations** become leads, linked to the ad click that started them, through the
  WhatsApp Business Cloud API webhook.

## How the matching works

1. A visitor arrives from an ad and taps your WhatsApp button.
2. The pixel adds a short reference code to the prefilled message, e.g.

   ```
   Hi, I'd like to know more

   Ref: AL-7F3K9
   ```

   and records a `whatsapp_click` event with that code for this visitor.
3. The visitor sends the message. WhatsApp calls AdLedger's webhook; AdLedger finds the code,
   creates (or finds) a contact by the sender's phone number (stored hashed), links the visitor
   and records a lead with form name **WhatsApp**. From there it is attributed like any other lead.

Codes stay valid for 30 days. One code creates one lead, so follow-up messages and webhook retries
don't create duplicates. Messages without a code are ignored.

## 1. Website: tag your WhatsApp links

With the pixel installed, nothing else is required: links to `https://wa.me/…`,
`https://api.whatsapp.com/send?…` and `whatsapp://send?…` are tagged when clicked, and `tel:` links
are recorded as `call_click`.

```html
<a href="https://wa.me/919876543210?text=Hi%2C%20I%27d%20like%20a%20quote">Chat on WhatsApp</a>
<a href="tel:+919876543210">Call us</a>
```

For buttons built in JavaScript, call:

```js
adledger.whatsapp("919876543210", "Hi, I'd like a quote"); // opens the chat, returns the URL
```

To record a click without changing the message, add `data-adledger-noref` to the link (that
conversation then can't be matched to the visitor).

Numbers are the full international number, digits only (country code first, no `+` or `0`).

## 2. WhatsApp Business Cloud API webhook

You need a Meta app with the WhatsApp product. Meta's **test number** is free and can message up to
five verified recipients, which is enough to try the whole flow.

1. Go to [developers.facebook.com](https://developers.facebook.com/) → **My Apps → Create App →
   Business**, and add the **WhatsApp** product.
2. Copy **App settings → Basic → App secret**.
3. In AdLedger open **Settings → Integrations → WhatsApp Business**, paste the App secret and
   choose a verify token (any random text). Optionally enter the **Phone number ID** to only count
   messages to that number. Save.
4. In the Meta app go to **WhatsApp → Configuration → Webhook → Edit**:
   - Callback URL: `https://YOUR-ADLEDGER/api/v1/webhooks/whatsapp/<workspace id>`
   - Verify token: the same value as in AdLedger

   Click **Verify and save**, then **Manage** webhook fields and subscribe to **messages**.

AdLedger must be reachable over HTTPS from the internet for Meta to deliver webhooks.

## Check it works

1. Open your site with `?utm_source=test&utm_medium=cpc&utm_campaign=whatsapp-test`, tap the
   WhatsApp button and send the prefilled message (keep the `Ref:` line).
2. Within a few seconds a lead named **WhatsApp** appears under Leads, with the
   `whatsapp-test` campaign as its touchpoint.

## Security & privacy

- Every POST is verified with `X-Hub-Signature-256` (HMAC-SHA256 of the body with your App secret);
  unsigned or tampered requests get `401` and nothing is stored.
- The sender's phone number is only stored as a SHA-256 hash on the contact. Message text is not
  stored; the lead keeps only the reference code and WhatsApp message id.

## Troubleshooting

- **Meta says the callback URL couldn't be verified** — the verify token differs, WhatsApp
  Business isn't saved in AdLedger yet, or the workspace id in the URL is wrong.
- **Messages arrive but no lead** — the `Ref: AL-…` line was deleted before sending, the click
  happened more than 30 days ago, or the message went to a number other than the Phone number ID
  you entered.
- **The lead isn't linked to an ad** — the visitor had no ad touchpoint (direct visit), or they
  declined tracking consent (then no code is added).
