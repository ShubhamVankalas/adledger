# Zapier and Make

Use Zapier or Make to send AdLedger data from tools that don't have a built-in connector:

- **Conversions API:** payments, refunds and leads from any tool (Gumroad, PayPal, Paddle,
  Wix, Squarespace Commerce, Calendly, your CRM…).
- **Spend API:** daily ad spend from any ad network (TikTok, LinkedIn, Microsoft, Reddit,
  X, a spreadsheet…).

## Before you start

1. AdLedger → **Settings → API keys** → create a key. Copy it (`al_…`); it's shown once.
2. Every request uses:
   - Method: `POST`
   - Header `Authorization`: `Bearer al_YOUR_KEY`
   - Header `Content-Type`: `application/json`

**Zapier:** use the action **Webhooks by Zapier → Custom Request**. Paste the JSON below into
**Data** and insert fields from earlier steps where the example has values.

**Make:** use **HTTP → Make a request**. Body type **Raw**, content type **JSON
(application/json)**, paste the JSON into **Request content**.

## Conversions API

`POST https://YOUR-ADLEDGER/api/v1/conversions`

### Payment

```json
{
  "events": [
    {
      "type": "payment",
      "external_id": "ORDER-1001",
      "amount": "49.99",
      "currency": "USD",
      "occurred_at": "2026-09-26T14:03:00Z",
      "email": "jane@example.com",
      "name": "Jane Doe",
      "source": "gumroad"
    }
  ]
}
```

### Refund

```json
{
  "events": [
    {
      "type": "refund",
      "external_id": "REFUND-77",
      "related_external_id": "ORDER-1001",
      "amount": "49.99",
      "currency": "USD",
      "occurred_at": "2026-09-28T09:00:00Z",
      "source": "gumroad"
    }
  ]
}
```

### Lead

```json
{
  "events": [
    {
      "type": "lead",
      "external_id": "calendly-8f2c",
      "occurred_at": "2026-09-26T14:03:00Z",
      "email": "jane@example.com",
      "phone": "+15551234567",
      "name": "Jane Doe",
      "source": "calendly"
    }
  ]
}
```

### Fields

| Field | Required | Notes |
|---|---|---|
| `type` | yes | `payment`, `refund` or `lead` |
| `external_id` | yes | The tool's own id for this order/refund/lead. Must be unique within `source`. |
| `related_external_id` | refunds | The `external_id` of the payment being refunded |
| `amount` | payments, refunds | Text with a dot for decimals: `"49.99"`, `"1200"`. No currency symbols or commas. |
| `currency` | payments, refunds | 3-letter code: `USD`, `EUR`, `INR` |
| `occurred_at` | yes | Date and time, ISO 8601, e.g. `2026-09-26T14:03:00Z` |
| `email`, `phone`, `name` | recommended | Used to match the event to the visitor's ad clicks |
| `visitor_id` | optional | From `adledger.getVisitorId()`. Gives an exact match. |
| `source` | recommended | Where it came from, e.g. `gumroad`, `paypal`, `hubspot` |

Sending the same `source` + `external_id` twice is safe: AdLedger keeps one copy. So retries
and Zap replays don't double-count revenue.

## Spend API

`POST https://YOUR-ADLEDGER/api/v1/spend`

```json
{
  "rows": [
    {
      "platform": "other",
      "account_id": "tiktok-7012345",
      "account_name": "TikTok Ads",
      "campaign_id": "1789001",
      "campaign_name": "Spring Sale",
      "ad_group_id": "1789002",
      "ad_group_name": "US 25-44",
      "ad_id": "1789003",
      "ad_name": "UGC video 3",
      "date": "2026-09-25",
      "spend": "12.34",
      "currency": "USD",
      "impressions": 5321,
      "clicks": 87
    }
  ]
}
```

- Send **one row per ad (or per campaign) per day**. `ad_group_*`, `ad_*`, `impressions` and
  `clicks` are optional.
- `spend` is text with a dot for decimals, like `amount` above.
- Send each day after it's over. If the numbers change later, send the same day again with the
  new totals.
- Use the same `campaign_id` / `ad_id` values in your UTM tags
  (`utm_campaign`, `utm_content`) so visits and revenue line up with the spend.

### Example: spend from a Google Sheet

1. Keep a sheet with columns *date, account, campaign id, campaign name, spend, currency*.
2. Zapier trigger **Google Sheets → New Spreadsheet Row** (Make: **Google Sheets → Watch
   Rows**).
3. Action: the Custom Request / HTTP request above with one row, mapping the columns.

### Example: TikTok, LinkedIn or Microsoft Ads

Use Zapier's or Make's app for that network (for example a daily *Report* or *Campaign
insights* step on a schedule), then map its fields into a row as above.

## Check it works

- Zapier: **Test step** should return status `200`/`2xx`. Make: **Run once** and check the
  HTTP module's status code.
- Payments show up in AdLedger revenue; spend shows up in the performance table for the date
  you sent.

## Troubleshooting

- **401 Unauthorized:** the header must be exactly `Authorization: Bearer al_…` (with a space
  after `Bearer`). Check the key wasn't deleted in Settings → API keys.
- **400 Bad Request:** usually a number sent as a number instead of text (`"49.99"`), a
  missing `currency`, or a date in the wrong format. The response body says which field.
- **Revenue not linked to ads:** include `email` (or `visitor_id`). The buyer must have
  visited your site with the pixel installed.
