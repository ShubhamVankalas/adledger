import type { NotificationChannelDriver, NotificationMessage } from "../../connectors/types";
import { escapeSlack, postOrThrow, requireField, safeUrl, severityEmoji, severityLabel, toPlain, toSlackMrkdwn, truncate } from "../format";

/** Build the Slack Incoming Webhook payload (Block Kit). */
export function slackPayload(msg: NotificationMessage) {
  const url = safeUrl(msg.url);
  const blocks: Record<string, unknown>[] = [
    { type: "header", text: { type: "plain_text", text: truncate(msg.title, 150), emoji: true } },
  ];
  const body = toSlackMrkdwn(msg.text);
  if (body) blocks.push({ type: "section", text: { type: "mrkdwn", text: truncate(body, 3000) } });
  const fields = msg.fields ?? [];
  for (let i = 0; i < fields.length; i += 10) {
    blocks.push({
      type: "section",
      fields: fields.slice(i, i + 10).map((f) => ({
        type: "mrkdwn",
        text: truncate(`*${escapeSlack(f.label)}*\n${escapeSlack(f.value)}`, 2000),
      })),
    });
  }
  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: `${severityEmoji(msg.severity)} *${severityLabel(msg.severity)}* · AdLedger` }],
  });
  if (url) {
    blocks.push({
      type: "actions",
      elements: [{ type: "button", text: { type: "plain_text", text: "Open AdLedger" }, url, style: "primary" }],
    });
  }
  const fallback = truncate(`${severityEmoji(msg.severity)} ${msg.title}${body ? ` — ${toPlain(msg.text)}` : ""}`, 3000);
  return { text: fallback, blocks };
}

export const slackDriver: NotificationChannelDriver = {
  type: "slack",
  meta: {
    provider: "notify_slack",
    name: "Slack",
    category: "notifications",
    description: "Post alerts and reports into a Slack channel using an Incoming Webhook.",
    fields: [
      { name: "webhookUrl", label: "Incoming Webhook URL", secret: true, placeholder: "https://hooks.slack.com/services/…" },
    ],
    steps: [
      "In Slack, open api.slack.com/apps, click Create New App → From scratch, and pick your workspace.",
      "Open Incoming Webhooks, switch it on, click Add New Webhook to Workspace and choose the channel.",
      "Copy the webhook URL (it starts with https://hooks.slack.com/) and paste it here.",
    ],
    docsUrl: "https://api.slack.com/messaging/webhooks",
    status: "stable",
    color: "#4A154B",
  },
  async send(conn, msg) {
    const webhookUrl = requireField(conn.secrets.webhookUrl, "Slack webhook URL");
    await postOrThrow(
      "Slack",
      webhookUrl,
      { headers: { "Content-Type": "application/json" }, body: JSON.stringify(slackPayload(msg)) },
      [webhookUrl],
    );
  },
};
