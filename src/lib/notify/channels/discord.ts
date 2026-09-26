import type { NotificationChannelDriver, NotificationMessage } from "../../connectors/types";
import { postOrThrow, requireField, safeUrl, severityColorInt, severityLabel, truncate } from "../format";

/** Build the Discord webhook payload (one embed). Discord renders **bold** and "- " lists natively. */
export function discordPayload(msg: NotificationMessage) {
  const url = safeUrl(msg.url);
  const embed: Record<string, unknown> = {
    title: truncate(msg.title, 256),
    description: truncate(msg.text ?? "", 4096),
    color: severityColorInt(msg.severity),
    footer: { text: `AdLedger · ${severityLabel(msg.severity)}` },
    timestamp: new Date().toISOString(),
  };
  if (url) embed.url = url;
  const fields = (msg.fields ?? []).slice(0, 25).map((f) => ({
    name: truncate(f.label || "​", 256),
    value: truncate(f.value || "​", 1024),
    inline: true,
  }));
  if (fields.length) embed.fields = fields;
  return { username: "AdLedger", embeds: [embed], allowed_mentions: { parse: [] as string[] } };
}

export const discordDriver: NotificationChannelDriver = {
  type: "discord",
  meta: {
    provider: "notify_discord",
    name: "Discord",
    category: "notifications",
    description: "Post alerts and reports into a Discord channel using a webhook.",
    fields: [
      { name: "webhookUrl", label: "Webhook URL", secret: true, placeholder: "https://discord.com/api/webhooks/…" },
    ],
    steps: [
      "In Discord, open the channel's settings (gear icon) and go to Integrations → Webhooks.",
      "Click New Webhook, give it a name like AdLedger, then click Copy Webhook URL.",
      "Paste the URL here and send a test message.",
    ],
    docsUrl: "https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks",
    status: "stable",
    color: "#5865F2",
  },
  async send(conn, msg) {
    const webhookUrl = requireField(conn.secrets.webhookUrl, "Discord webhook URL");
    await postOrThrow(
      "Discord",
      webhookUrl,
      { headers: { "Content-Type": "application/json" }, body: JSON.stringify(discordPayload(msg)) },
      [webhookUrl],
    );
  },
};
