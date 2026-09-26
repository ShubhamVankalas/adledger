import { createHash, timingSafeEqual } from "node:crypto";
import { arr, obj, str, verifyHmac } from "./revenue/shared";
import type { IntegrationMeta } from "./types";

// WhatsApp click-to-chat attribution.
//
// The pixel's `adledger.whatsapp()` (and auto-tagged wa.me links) append a short reference code
// ("Ref: AL-7F3K9") to the prefilled message and record a `whatsapp_click` event carrying that
// code. When the visitor sends the message, the WhatsApp Business Cloud API webhook delivers it
// here; the code links the conversation back to the visitor and their ad touchpoints.
// https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples

export const WHATSAPP_PROVIDER = "whatsapp";
export const WHATSAPP_CLICK_EVENT = "whatsapp_click";
export const CALL_CLICK_EVENT = "call_click";

/** No 0/O, 1/I: codes are read and sometimes retyped by people. Must match pixel/al.ts. */
export const REF_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const REF_RE = /\bAL-([2-9A-HJ-NP-Z]{5})\b/i;

/** A fresh reference code like "AL-7F3K9" (the pixel generates these in the browser). */
export function generateRefCode(random: () => number = Math.random): string {
  let s = "AL-";
  for (let i = 0; i < 5; i++) s += REF_ALPHABET[Math.floor(random() * REF_ALPHABET.length)];
  return s;
}

/** The reference code in a message, normalized to upper case, or null. */
export function extractRefCode(text: string | null | undefined): string | null {
  const m = text ? REF_RE.exec(text) : null;
  return m ? `AL-${m[1].toUpperCase()}` : null;
}

/** Meta signs the raw body: `X-Hub-Signature-256: sha256=<hex HMAC-SHA256(body, app secret)>`. */
export function verifyWhatsAppSignature(rawBody: string, appSecret: string | undefined, header: string | null): boolean {
  if (!header || !header.startsWith("sha256=")) return false;
  return verifyHmac(rawBody, appSecret, header.slice(7), "hex");
}

/**
 * Webhook subscription handshake: Meta calls GET ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…
 * and expects the challenge echoed back. Returns the challenge, or null if the token doesn't match.
 */
export function verifySubscription(params: URLSearchParams, verifyToken: string | undefined): string | null {
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");
  if (params.get("hub.mode") !== "subscribe" || !verifyToken || !token || !challenge) return null;
  // Hash both sides so the comparison is constant-time regardless of length.
  const a = createHash("sha256").update(token).digest();
  const b = createHash("sha256").update(verifyToken).digest();
  if (!timingSafeEqual(a, b)) return null;
  return /^[\w-]{1,200}$/.test(challenge) ? challenge : null;
}

export type WhatsAppInbound = {
  messageId: string;
  from: string; // sender's WhatsApp number, E.164 digits without "+"
  name: string | null; // WhatsApp profile name
  text: string | null;
  ref: string | null;
  occurredAt: Date;
  phoneNumberId: string | null; // the business number that received it
};

/** Inbound user messages from a Cloud API webhook payload (statuses and other fields are ignored). */
export function parseWhatsAppWebhook(payload: unknown): WhatsAppInbound[] {
  const p = obj(payload);
  if (str(p?.object) !== "whatsapp_business_account") return [];
  const out: WhatsAppInbound[] = [];
  for (const entry of arr(p?.entry)) {
    for (const change of arr(obj(entry)?.changes)) {
      const c = obj(change);
      if (str(c?.field) !== "messages") continue;
      const value = obj(c?.value);
      const phoneNumberId = str(obj(value?.metadata)?.phone_number_id);
      const names = new Map<string, string>();
      for (const ct of arr(value?.contacts)) {
        const waId = str(obj(ct)?.wa_id);
        const name = str(obj(obj(ct)?.profile)?.name);
        if (waId && name) names.set(waId, name);
      }
      for (const message of arr(value?.messages)) {
        const m = obj(message);
        const id = str(m?.id);
        const from = str(m?.from);
        if (!m || !id || !from) continue;
        // Prefilled chats arrive as text; quick-reply buttons and interactive replies carry text too.
        const text =
          str(obj(m.text)?.body) ??
          str(obj(m.button)?.text) ??
          str(obj(obj(m.interactive)?.button_reply)?.title) ??
          str(obj(m.image)?.caption) ??
          null;
        const ts = str(m.timestamp);
        out.push({
          messageId: id,
          from: from.replace(/\D/g, ""),
          name: names.get(from) ?? null,
          text,
          ref: extractRefCode(text),
          occurredAt: ts && /^\d+$/.test(ts) ? new Date(Number(ts) * 1000) : new Date(),
          phoneNumberId,
        });
      }
    }
  }
  return out;
}

export const whatsappIntegration: IntegrationMeta & { category: "leads" } = {
  provider: WHATSAPP_PROVIDER,
  name: "WhatsApp Business",
  category: "leads",
  description: "Attribute click-to-chat leads: WhatsApp conversations are matched to the ad click that started them.",
  status: "beta",
  color: "#25d366",
  docsUrl: "https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks",
  fields: [
    {
      name: "appSecret",
      label: "App secret",
      secret: true,
      hint: "Meta App Dashboard → App settings → Basic → App secret. Used to verify X-Hub-Signature-256.",
    },
    {
      name: "verifyToken",
      label: "Verify token",
      secret: true,
      hint: "Any random text; paste the same value into the webhook setup in Meta.",
    },
    {
      name: "phoneNumberId",
      label: "Phone number ID",
      optional: true,
      placeholder: "106540352242922",
      hint: "Only count messages to this business number (leave empty for all numbers on the app).",
    },
  ],
  steps: [
    "Create a Meta app with the WhatsApp product (developers.facebook.com → My Apps → Create App → Business). The free test number and up to 5 test recipients work without verification.",
    "Paste the app's App secret and a verify token of your choice here and save.",
    "In the app go to WhatsApp → Configuration → Webhook → Edit: Callback URL `https://YOUR-ADLEDGER/api/v1/webhooks/whatsapp/<workspace id>` and the same verify token, then subscribe to the `messages` field.",
    "On your site, link chat buttons to `https://wa.me/<number>` (tagged automatically by the pixel) or call `adledger.whatsapp(\"<number>\", \"Hi!\")`. Each chat carries a code like `Ref: AL-7F3K9` that links it to the ad click.",
  ],
};
