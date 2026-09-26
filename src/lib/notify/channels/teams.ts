import type { NotificationChannelDriver, NotificationMessage } from "../../connectors/types";
import { parseBlocks, postOrThrow, requireField, safeUrl, severityLabel } from "../format";

const TEAMS_COLOR: Record<NotificationMessage["severity"], string> = {
  info: "Accent",
  success: "Good",
  warning: "Warning",
  critical: "Attention",
};

/** Build a Teams Workflows webhook payload carrying an Adaptive Card. */
export function teamsPayload(msg: NotificationMessage) {
  const url = safeUrl(msg.url);
  const body: Record<string, unknown>[] = [
    {
      type: "TextBlock",
      text: severityLabel(msg.severity).toUpperCase(),
      size: "Small",
      weight: "Bolder",
      color: TEAMS_COLOR[msg.severity] ?? "Accent",
      spacing: "None",
    },
    { type: "TextBlock", text: msg.title, size: "Large", weight: "Bolder", wrap: true, spacing: "Small" },
  ];
  // Adaptive Card TextBlocks support **bold** and "- " lists; Teams wants "\r" between list items.
  for (const b of parseBlocks(msg.text)) {
    body.push({
      type: "TextBlock",
      text: b.kind === "p" ? b.lines.join("\n\n") : b.items.map((i) => `- ${i}`).join("\r"),
      wrap: true,
    });
  }
  if (msg.fields?.length) {
    body.push({ type: "FactSet", facts: msg.fields.map((f) => ({ title: f.label, value: f.value })) });
  }
  const content: Record<string, unknown> = {
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    type: "AdaptiveCard",
    version: "1.4",
    body,
    msteams: { width: "Full" },
  };
  if (url) content.actions = [{ type: "Action.OpenUrl", title: "Open AdLedger", url }];
  return {
    type: "message",
    attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", contentUrl: null, content }],
  };
}

export const teamsDriver: NotificationChannelDriver = {
  type: "teams",
  meta: {
    provider: "notify_teams",
    name: "Microsoft Teams",
    category: "notifications",
    description: "Post alerts and reports into a Teams channel through a Workflows webhook.",
    fields: [
      { name: "webhookUrl", label: "Workflows webhook URL", secret: true, placeholder: "https://…logic.azure.com/workflows/…" },
    ],
    steps: [
      "In Teams, open the channel, click ••• → Workflows, and choose \"Post to a channel when a webhook request is received\".",
      "Name it AdLedger, pick the team and channel, then click Add workflow.",
      "Copy the webhook URL Teams shows you and paste it here.",
    ],
    docsUrl:
      "https://support.microsoft.com/en-us/office/create-incoming-webhooks-with-workflows-for-microsoft-teams-8ae491c7-0394-4861-ba59-055e33f75498",
    status: "stable",
    color: "#5059C9",
  },
  async send(conn, msg) {
    const webhookUrl = requireField(conn.secrets.webhookUrl, "Teams webhook URL");
    await postOrThrow(
      "Microsoft Teams",
      webhookUrl,
      { headers: { "Content-Type": "application/json" }, body: JSON.stringify(teamsPayload(msg)) },
      [webhookUrl],
    );
  },
};
