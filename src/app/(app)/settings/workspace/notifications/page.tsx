import { eq } from "drizzle-orm";
import { NotificationsPanel } from "@/components/settings/notifications-panel";
import { SettingsHeader } from "@/components/settings/section";
import type { IntegrationState } from "@/components/settings/integration-dialog";
import { requireUser } from "@/lib/auth";
import { allIntegrations } from "@/lib/connectors/registry";
import { getDb, schema } from "@/lib/db";
import { EVENTS } from "@/lib/notify";
import { getConnection, secretKeysOf } from "@/lib/settings";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const user = await requireUser("workspace.settings");
  const db = await getDb();
  const ws = user.workspace;
  const channels = allIntegrations().filter((i) => i.category === "notifications");
  const [conns, rules] = await Promise.all([
    db.select().from(schema.connections).where(eq(schema.connections.workspaceId, ws.id)),
    db.select().from(schema.notificationRules).where(eq(schema.notificationRules.workspaceId, ws.id)),
  ]);
  const states: Record<string, IntegrationState> = {};
  for (const c of channels) {
    const row = conns.find((x) => x.provider === c.provider);
    const full = row ? await getConnection(ws.id, c.provider, db) : undefined;
    states[c.provider] = {
      connected: Boolean(row),
      mode: row?.mode ?? null,
      config: row?.config ?? {},
      secretKeys: secretKeysOf(full),
      lastSyncedAt: null,
      lastError: row?.lastError ?? null,
      lastRun: null,
      webhookUrl: null,
    };
  }
  return (
    <>
      <SettingsHeader
        title="Notifications"
        description="Get the weekly report, daily numbers and alerts by email, Slack, Discord, Microsoft Teams, SMS or webhook. Connect a channel, then choose what it receives."
      />
      <NotificationsPanel
        channels={channels}
        states={states}
        events={EVENTS}
        rules={rules.map((r) => ({ event: r.event, channel: r.channel, settings: r.settings, lastSentAt: r.lastSentAt?.toISOString() ?? null }))}
        timezone={ws.timezone}
      />
    </>
  );
}
