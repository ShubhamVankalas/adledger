import type { NotificationChannelDriver, NotificationMessage } from "../../connectors/types";
import { postOrThrow, requireField, safeUrl, splitList, truncate } from "../format";

export const SMS_MAX_CHARS = 320;

/** Short SMS text: title, first two fields, link — at most 320 chars (the link is kept whole). */
export function smsText(msg: NotificationMessage): string {
  const url = safeUrl(msg.url);
  const lines = [`AdLedger: ${msg.title}`, ...(msg.fields ?? []).slice(0, 2).map((f) => `${f.label}: ${f.value}`)];
  const head = lines.join("\n");
  if (!url) return truncate(head, SMS_MAX_CHARS);
  const tail = `\n${url}`;
  if (tail.length >= SMS_MAX_CHARS) return truncate(head, SMS_MAX_CHARS);
  return truncate(head, SMS_MAX_CHARS - tail.length) + tail;
}

export const smsDriver: NotificationChannelDriver = {
  type: "sms",
  meta: {
    provider: "notify_sms",
    name: "SMS (Twilio)",
    category: "notifications",
    description: "Text critical alerts to one or more phones through your Twilio account.",
    fields: [
      { name: "accountSid", label: "Account SID", placeholder: "AC…" },
      { name: "authToken", label: "Auth token", secret: true },
      { name: "from", label: "From number", placeholder: "+15551234567", hint: "Your Twilio phone number (or a Messaging Service SID starting with MG)" },
      { name: "to", label: "Send to", placeholder: "+15557654321, +919812345678", hint: "Phone numbers in international format, separated by commas" },
    ],
    steps: [
      "Sign in to console.twilio.com and copy the Account SID and Auth token from the dashboard.",
      "Buy or pick a Twilio phone number that can send SMS and enter it as the From number.",
      "Enter the phone numbers that should get alerts (with country code, e.g. +1…), then send a test.",
    ],
    docsUrl: "https://www.twilio.com/docs/messaging/api/message-resource#create-a-message-resource",
    status: "stable",
    color: "#F22F46",
  },
  async send(conn, msg) {
    const sid = requireField(conn.config.accountSid, "Twilio Account SID");
    const token = requireField(conn.secrets.authToken, "Twilio auth token");
    const from = requireField(conn.config.from, "Twilio From number");
    const to = splitList(conn.config.to);
    if (!to.length) throw new Error("SMS: no recipient phone numbers");

    const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`;
    const auth = `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`;
    const text = smsText(msg);
    const errors: string[] = [];
    for (const number of to) {
      const form = new URLSearchParams({ To: number, Body: text });
      if (/^MG[0-9a-f]{32}$/i.test(from)) form.set("MessagingServiceSid", from);
      else form.set("From", from);
      try {
        await postOrThrow(
          "Twilio",
          endpoint,
          {
            headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
            body: form.toString(),
          },
          [token, auth],
        );
      } catch (err) {
        errors.push((err as Error).message);
      }
    }
    if (errors.length) {
      throw new Error(
        errors.length === to.length ? errors[0] : `SMS failed for ${errors.length} of ${to.length} recipients: ${errors[0]}`,
      );
    }
  },
};
