"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { fail, guard, ok, run, type ActionResult } from "@/lib/actions";
import { audit } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import type { NotificationEvent } from "@/lib/db/schema";
import { EVENTS, sendToChannel } from "@/lib/notify";

export async function sendTestNotificationAction(channel: string): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("workspace.settings");
    const db = await getDb();
    try {
      await sendToChannel(db, user.workspace.id, channel, {
        title: "AdLedger test notification",
        text: `This is a test from **${user.workspace.name}**. If you can read this, alerts will arrive here.`,
        severity: "success",
        fields: [
          { label: "Workspace", value: user.workspace.name },
          { label: "Sent by", value: user.name || user.email },
        ],
      });
    } catch (err) {
      return fail(err instanceof Error ? err.message : "Sending failed");
    }
    return ok("Test message sent.");
  });
}

/**
 * Save the whole rules grid: checkboxes named `rule:<event>:<channel>` (or selects named
 * `choice:<event>:<channel>` for events with a per-channel choice), settings `setting:<event>:<key>`.
 */
export async function saveNotificationRulesAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("workspace.settings");
    const db = await getDb();
    const channels = form.getAll("channels").map(String).filter((c) => c.startsWith("notify_"));
    for (const { event, defaults, perChannel } of EVENTS) {
      const settings: Record<string, string | number> = {};
      for (const key of Object.keys(defaults)) {
        const raw = String(form.get(`setting:${event}:${key}`) ?? defaults[key]);
        const n = Number(raw);
        settings[key] = Number.isFinite(n) ? Math.max(0, n) : defaults[key];
      }
      for (const channel of channels) {
        // Per-channel choice (e.g. digest cadence): `choice:<event>:<channel>` = an option value, or "off".
        const choice = perChannel ? String(form.get(`choice:${event}:${channel}`) ?? "off") : null;
        const valid = perChannel && choice ? perChannel.options.some((o) => o.value === choice) : false;
        const on = perChannel ? valid : form.get(`rule:${event}:${channel}`) === "on";
        const ruleSettings = perChannel && valid && choice ? { ...settings, [perChannel.key]: choice } : settings;
        const where = and(
          eq(schema.notificationRules.workspaceId, user.workspace.id),
          eq(schema.notificationRules.event, event as NotificationEvent),
          eq(schema.notificationRules.channel, channel),
        );
        if (on) {
          await db
            .insert(schema.notificationRules)
            .values({ workspaceId: user.workspace.id, event, channel, settings: ruleSettings, enabled: true })
            .onConflictDoUpdate({
              target: [schema.notificationRules.workspaceId, schema.notificationRules.channel, schema.notificationRules.event],
              set: { settings: ruleSettings, enabled: true },
            });
        } else {
          await db.delete(schema.notificationRules).where(where);
        }
      }
    }
    await audit(user, "notifications.updated", null, { channels });
    revalidatePath("/settings/workspace/notifications");
    return ok("Notification rules saved.");
  });
}
