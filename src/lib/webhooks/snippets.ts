import type { WebhookEventType } from "./catalog";

// Copy-paste code for the Developers pages and docs/WEBHOOKS.md: signature verification and the
// recipes. Plain strings (no server imports) so client components can render them.

export const VERIFY_NODE = `import crypto from "node:crypto";

// rawBody: the request body exactly as received (a string or Buffer), before JSON.parse.
export function verifyAdLedger(rawBody, header, secret, toleranceSec = 300) {
  const parts = Object.fromEntries((header ?? "").split(",").map((p) => p.trim().split("=")));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = crypto.createHmac("sha256", secret).update(\`\${t}.\${rawBody}\`).digest();
  const got = Buffer.from(parts.v1 ?? "", "hex");
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}`;

export const VERIFY_PYTHON = `import hashlib, hmac, time

def verify_adledger(raw_body: bytes, header: str, secret: str, tolerance: int = 300) -> bool:
    parts = dict(p.strip().split("=", 1) for p in (header or "").split(",") if "=" in p)
    try:
        t = int(parts.get("t", ""))
    except ValueError:
        return False
    if abs(time.time() - t) > tolerance:
        return False
    expected = hmac.new(secret.encode(), f"{t}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts.get("v1", ""))`;

export const VERIFY_EXPRESS = `import express from "express";
import { verifyAdLedger } from "./verify-adledger.js";

const app = express();

// Keep the raw body: the signature covers the exact bytes AdLedger sent.
app.post("/adledger", express.raw({ type: "application/json" }), (req, res) => {
  const ok = verifyAdLedger(req.body.toString("utf8"), req.get("AdLedger-Signature"), process.env.ADLEDGER_WEBHOOK_SECRET);
  if (!ok) return res.status(400).send("bad signature");
  const event = JSON.parse(req.body);
  // Answer fast (within 10 s); do slow work in the background. Dedupe on event.id.
  res.sendStatus(200);
  handle(event).catch(console.error);
});`;

export type Recipe = {
  id: string;
  title: string;
  summary: string;
  tool: string;
  events: WebhookEventType[];
  /** Needs "Include personal data" on the endpoint (raw email or phone). */
  pii: boolean;
  steps: string[];
  code?: { label: string; code: string };
};

export const RECIPES: Recipe[] = [
  {
    id: "twilio-sms",
    title: "Text every new lead within a minute",
    summary: "Reply to a lead by SMS while they still remember filling in your form.",
    tool: "Twilio",
    events: ["lead.created"],
    pii: true,
    steps: [
      "Add an endpoint for lead.created pointing at your server and turn on Include personal data (the phone number is needed).",
      "Store the signing secret and your Twilio credentials as environment variables.",
      "Deploy the handler below. Leads without a phone number are skipped.",
    ],
    code: {
      label: "sms-on-lead.js (Node 18+)",
      code: `import { verifyAdLedger } from "./verify-adledger.js";

export async function handle(rawBody, signature) {
  if (!verifyAdLedger(rawBody, signature, process.env.ADLEDGER_WEBHOOK_SECRET)) throw new Error("bad signature");
  const event = JSON.parse(rawBody);
  if (event.type !== "lead.created" || !event.data.contact.phone) return;

  const { name, phone } = event.data.contact;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const body = new URLSearchParams({
    From: process.env.TWILIO_FROM,          // your Twilio number, e.g. +14155550100
    To: phone,
    Body: \`Hi \${name?.split(" ")[0] ?? "there"}, thanks for reaching out! Reply here or book a call: https://cal.com/you/intro\`,
  });
  const res = await fetch(\`https://api.twilio.com/2010-04-01/Accounts/\${sid}/Messages.json\`, {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(\`\${sid}:\${process.env.TWILIO_AUTH_TOKEN}\`).toString("base64") },
    body,
  });
  if (!res.ok) throw new Error(\`Twilio \${res.status}\`); // non-2xx back to AdLedger = retried later
}`,
    },
  },
  {
    id: "calcom",
    title: "Send a booking link to hot leads",
    summary: "Email each new lead a Cal.com link with their name and email already filled in.",
    tool: "Cal.com",
    events: ["lead.created"],
    pii: true,
    steps: [
      "Add an endpoint for lead.created with Include personal data on (the email is needed).",
      "Build the prefilled link from the contact: Cal.com fills name and email from the query string.",
      "Send it with your email provider (Resend, Postmark, SES) or return it to your CRM.",
    ],
    code: {
      label: "booking-link.js",
      code: `export function bookingLink(event) {
  const { name, email } = event.data.contact;
  const url = new URL("https://cal.com/your-team/intro-call");
  if (name) url.searchParams.set("name", name);
  if (email) url.searchParams.set("email", email);
  // Keep the source so you can see which form produced the call.
  url.searchParams.set("metadata[adledger_contact]", event.data.contact.id);
  return url.toString();
}

// e.g. with Resend:
// await resend.emails.send({ from: "you@yourco.com", to: email, subject: "Pick a time", html: \`<a href="\${bookingLink(event)}">Book a call</a>\` });`,
    },
  },
  {
    id: "slack",
    title: "Celebrate payments in Slack",
    summary: "Post every new payment with the amount and the contact's stage to a channel.",
    tool: "Slack",
    events: ["payment.succeeded"],
    pii: false,
    steps: [
      "Create a Slack incoming webhook for the channel (api.slack.com/apps → Incoming Webhooks).",
      "Add an AdLedger endpoint for payment.succeeded pointing at a small function that reformats the event.",
      "No personal data needed: the masked email and the name are enough for a shout-out.",
    ],
    code: {
      label: "payment-to-slack.js",
      code: `export async function handle(event) {
  if (event.type !== "payment.succeeded") return;
  const { amount_minor, currency, source } = event.data.payment;
  const amount = new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount_minor / 100);
  const who = event.data.contact?.name ?? event.data.contact?.email_masked ?? "Someone";
  await fetch(process.env.SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: \`:tada: \${who} paid *\${amount}* via \${source}\` }),
  });
}`,
    },
  },
  {
    id: "no-code",
    title: "Zapier, Make or n8n",
    summary: "Catch events in a no-code tool and branch to 7,000+ apps: CRMs, email, calendars, spreadsheets.",
    tool: "Zapier · Make · n8n",
    events: ["lead.created", "payment.succeeded"],
    pii: false,
    steps: [
      "Zapier: Webhooks by Zapier → Catch Hook. Make: Webhooks → Custom webhook. n8n: Webhook node (POST).",
      "Copy the URL it gives you into a new AdLedger endpoint and pick the events you need.",
      "Click Send test event so the tool learns the fields, then map event.data.contact and friends.",
      "Turn on Include personal data only if the next step really needs the email or phone.",
    ],
    code: {
      label: "n8n: verify the signature in a Code node (optional)",
      code: `const crypto = require("crypto");
const header = $input.first().json.headers["adledger-signature"];
const raw = JSON.stringify($input.first().json.body); // enable "Raw body" on the Webhook node for an exact match
const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
const expected = crypto.createHmac("sha256", $env.ADLEDGER_WEBHOOK_SECRET).update(parts.t + "." + raw).digest("hex");
if (expected !== parts.v1) throw new Error("bad signature");
return $input.all();`,
    },
  },
  {
    id: "sheets",
    title: "Log leads to Google Sheets",
    summary: "Append one row per lead to a sheet your sales team already lives in.",
    tool: "Google Sheets",
    events: ["lead.created"],
    pii: false,
    steps: [
      "In Zapier (Catch Hook) or Make (Custom webhook), create a scenario and copy its URL.",
      "Add it as an AdLedger endpoint for lead.created, then click Send test event.",
      "Add a Google Sheets step: Create Spreadsheet Row (Zapier) or Add a Row (Make), and map the columns below.",
      "Tip: add a column for the event id and skip rows you already have, so a retried delivery never adds a duplicate.",
    ],
    code: {
      label: "Column mapping",
      code: `Received at   →  created_at
Event id      →  id
Name          →  data.contact.name
Email         →  data.contact.email_masked   (data.contact.email with personal data on)
Form          →  data.lead.form_name
Stage         →  data.contact.stage.name
Open in AdLedger → data.contact.url`,
    },
  },
];
