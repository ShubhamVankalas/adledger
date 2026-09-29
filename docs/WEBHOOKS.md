# Outbound webhooks

AdLedger can push events to your own tools the moment they happen: text a new lead, book a call,
post a payment to Slack, add a row to a sheet. Add endpoints in **Developers → Webhooks**.

- **Who can:** roles with the **Webhooks** permission (`developers.access`, owners and admins by
  default). It sends workspace data to outside URLs, so the role editor marks it "Exports data".
  Creating an endpoint is audited and raises a security alert.
- **Pull instead of push?** The REST API has the same data: see [API.md](API.md) (for example
  `GET /api/v1/leads` with cursor pagination).

## Events

| Event | When |
|---|---|
| `lead.created` | A form fill, lead-ads lead, WhatsApp chat or API lead was recorded. |
| `contact.created` | A person appeared for the first time: from a lead, a payment or a pixel identify. |
| `contact.updated` | A contact moved to another pipeline stage: dragged on the board, won by a payment, or a move was undone. |
| `payment.succeeded` | A new payment from any revenue source or `POST /api/v1/conversions`. |
| `payment.refunded` | A new refund was recorded. |

Replays of the same payment or lead (a re-sent Stripe webhook, a re-sync) never fire again. Bulk
operations don't fire events: contact CSV imports, merging duplicates, deleting a pipeline stage
(its contacts move in bulk) and demo data.

Every event has the same envelope:

```json
{
  "id": "evt_8f14e45fceea4b1c9d3a0b7e6c2d1f90",
  "type": "lead.created",
  "api_version": "2026-09-29",
  "created_at": "2026-09-29T09:41:13.000Z",
  "workspace_id": "0e5c…",
  "test": false,
  "data": {
    "lead": { "id": "c4d5…", "source": "webhook", "form_name": "Book a demo", "occurred_at": "2026-09-29T09:41:13.000Z" },
    "contact": {
      "id": "5b1f…",
      "name": "Priya Shah",
      "email": null,
      "email_masked": "p•••••@example.com",
      "email_sha256": "6bdb7e961d54ddc243ec721e6e211ac0a179b19a9ce2ad52a418198e146e69fe",
      "phone": null,
      "phone_sha256": "61c16289716534ac3a5992f613d7a9fefa5e9c12b8fd27f187387da9efeafd8c",
      "lifecycle": "lead",
      "stage": { "id": "7d2e…", "name": "New lead", "kind": "open" },
      "first_seen_at": "2026-09-29T09:41:12.000Z",
      "url": "https://adledger.example.com/contacts/5b1f…"
    }
  }
}
```

Full schemas for every event are in [API.md](API.md#webhook-events) and in the OpenAPI spec
(`/api/v1/openapi.json`, under `webhooks`). The dashboard's API reference shows an example of each.

- `contact.updated` carries `changes.stage = { from, to, source }` with `source` one of `manual`,
  `payment` or `undo`.
- `payment.succeeded` has `data.payment`, `payment.refunded` has `data.refund` (with
  `related_external_id`). `amount_minor` is always positive, in minor units (cents), with an ISO
  4217 `currency`. `contact` is `null` when the payment couldn't be matched to a person.
- `contact.url` needs `PUBLIC_URL` to be set on the server; otherwise it is `null`.

## Personal data

By default events carry **no raw email or phone**: `email` and `phone` are `null`, with the masked
email and SHA-256 hashes (lowercased, trimmed email; digits-only phone) so you can still match
people. Turn on **Include personal data** on an endpoint to receive the real `email` and `phone`
(needed to text or email a lead). Only members who may see contact emails (`contacts.pii`) can turn
it on.

How it is stored: the delivery log keeps the PII-free payload. For endpoints with personal data on,
the email and phone ride along AES-256-GCM encrypted and are added only when the request is sent;
the log is pruned after 30 days. A phone number is included when AdLedger saw it with the event (a
form, lead ad, WhatsApp chat or checkout); AdLedger never stores raw phone numbers otherwise.

## Verifying signatures

Each request has these headers:

| Header | Value |
|---|---|
| `AdLedger-Signature` | `t=<unix seconds>,v1=<hex HMAC-SHA256>` |
| `AdLedger-Event` | the event type |
| `AdLedger-Event-Id` | the envelope `id` |
| `AdLedger-Delivery` | this delivery's id (a resend gets a new one) |
| `AdLedger-Attempt` | `1`, then `2`, `3`… on retries |

`v1` is the HMAC-SHA256 of `<t>.<raw body>` keyed with the endpoint's signing secret
(`whsec_…`, shown once when you add the endpoint; **Reveal** and **Roll secret** are on the endpoint
page, both audited). Compute it over the raw bytes you received, before parsing JSON, compare in
constant time, and reject timestamps more than five minutes old.

Node.js:

```js
import crypto from "node:crypto";

export function verifyAdLedger(rawBody, header, secret, toleranceSec = 300) {
  const parts = Object.fromEntries((header ?? "").split(",").map((p) => p.trim().split("=")));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  const got = Buffer.from(parts.v1 ?? "", "hex");
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}
```

Python:

```python
import hashlib, hmac, time

def verify_adledger(raw_body: bytes, header: str, secret: str, tolerance: int = 300) -> bool:
    parts = dict(p.strip().split("=", 1) for p in (header or "").split(",") if "=" in p)
    try:
        t = int(parts.get("t", ""))
    except ValueError:
        return False
    if abs(time.time() - t) > tolerance:
        return False
    expected = hmac.new(secret.encode(), f"{t}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts.get("v1", ""))
```

Express (keep the raw body):

```js
app.post("/adledger", express.raw({ type: "application/json" }), (req, res) => {
  if (!verifyAdLedger(req.body.toString("utf8"), req.get("AdLedger-Signature"), process.env.ADLEDGER_WEBHOOK_SECRET)) {
    return res.status(400).send("bad signature");
  }
  const event = JSON.parse(req.body);
  res.sendStatus(200); // answer fast, work in the background; dedupe on event.id
  handle(event).catch(console.error);
});
```

## Delivery and retries

- Events are sent within a few seconds, from the app process itself (no extra service).
- Answer with any **2xx within 10 seconds**. Anything else (another status, a timeout, a network
  error, a redirect, which is never followed) is retried after 1 min, 5 min, 30 min, 2 h, 6 h, 12 h
  and 24 h: 8 attempts over about two days. Then the delivery is marked failed.
- Deliveries can arrive more than once and out of order. Use the envelope `id` to dedupe; a retry or a
  manual resend keeps it.
- The endpoint page has a 30-day **delivery log** (status, attempts, response code and the first
  1 KB of your response, PII-redacted), **Resend this event**, and **Send test event** (sample data,
  `"test": true`, sent once).
- **Pausing** an endpoint stops new events; queued deliveries for it fail. Deleting it removes its log.
- At most 20 endpoints per workspace.

## Network safety

Endpoint URLs must be `https://` and must not point at private, loopback, link-local or cloud
metadata addresses; the host is checked when you save and again before every request (DNS can
change). To deliver to something on your own network (a local n8n, a dev server), set
`ALLOW_PRIVATE_URLS=true` on the server: it also allows plain `http://` endpoints.

## Recipes

**Developers → Recipes** has copy-paste code for:

- **Text every new lead** with Twilio (`lead.created`, personal data on).
- **Send a Cal.com booking link** with name and email prefilled (`lead.created`, personal data on).
- **Celebrate payments in Slack** (`payment.succeeded`).
- **Zapier, Make or n8n**: a Catch Hook / Custom webhook / Webhook node URL as the endpoint, then any
  of their apps.
- **Google Sheets** through Zapier or Make, one row per lead, deduped on the event id.
