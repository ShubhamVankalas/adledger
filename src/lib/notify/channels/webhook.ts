import { createHmac } from "node:crypto";
import type { NotificationChannelDriver, NotificationMessage } from "../../connectors/types";
import { postOrThrow, requireField, safeUrl } from "../format";

/** Hex HMAC-SHA256 of the raw request body. Receivers compare it to `X-AdLedger-Signature: sha256=<hex>`. */
export function signPayload(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

export function webhookPayload(msg: NotificationMessage, sentAt: Date = new Date()) {
  return {
    title: msg.title,
    text: msg.text,
    severity: msg.severity,
    url: msg.url ?? null,
    fields: msg.fields ?? [],
    sentAt: sentAt.toISOString(),
  };
}

export const webhookDriver: NotificationChannelDriver = {
  type: "webhook",
  meta: {
    provider: "notify_webhook",
    name: "Webhook",
    category: "notifications",
    description: "POST every alert as JSON to your own URL (Zapier, Make, n8n or your backend), optionally signed with HMAC-SHA256.",
    fields: [
      { name: "url", label: "Endpoint URL", placeholder: "https://example.com/adledger-hook" },
      {
        name: "signingSecret",
        label: "Signing secret",
        secret: true,
        optional: true,
        hint: "If set, each request carries X-AdLedger-Signature: sha256=<HMAC of the body>",
      },
    ],
    steps: [
      "Create a URL that accepts POST requests — for example a \"Catch Hook\" in Zapier or a Webhook node in Make or n8n.",
      "Paste the URL here. Optionally add a signing secret so your endpoint can check that requests really come from AdLedger.",
      "Send a test and confirm your endpoint received the JSON (title, text, severity, url, fields, sentAt).",
    ],
    docsUrl: "https://en.wikipedia.org/wiki/HMAC",
    status: "stable",
    color: "#334155",
  },
  async send(conn, msg) {
    const url = requireField(conn.config.url, "Webhook URL");
    if (!safeUrl(url)) throw new Error("Webhook URL must start with http:// or https://");
    const body = JSON.stringify(webhookPayload(msg));
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const secret = conn.secrets.signingSecret?.trim();
    if (secret) headers["X-AdLedger-Signature"] = `sha256=${signPayload(body, secret)}`;
    await postOrThrow("Webhook", url, { headers, body }, [secret]);
  },
};
