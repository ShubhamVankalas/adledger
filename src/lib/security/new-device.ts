import { eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import { log } from "../log";
import { appUrl } from "../notify";
import { sendEmail } from "../notify/channels/email";
import { getConnection } from "../settings";

// "New sign-in to your account" email, sent to the person who signed in. Uses the workspace's
// email channel when one is set up, else the server's SMTP_URL. Without either, nothing is sent
// (the security_alert notification still goes to the team's channels).

export async function emailNewDevice(userId: string, workspaceId: string, device: string) {
  try {
    const db = await getDb();
    const [u] = await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, userId));
    if (!u) return;
    const conn = await getConnection(workspaceId, "notify_email", db);
    const usable = conn?.enabled && (conn.config.host ?? "").trim() ? conn : undefined;
    if (!usable && !process.env.SMTP_URL) return;
    await sendEmail({
      to: u.email,
      conn: usable,
      msg: {
        title: "New sign-in to your AdLedger account",
        text: `Your account was just used to sign in from **${device}**.\n\nIf this was you, there's nothing to do. If it wasn't, change your password and sign out of other devices in Settings → Account → Security.`,
        severity: "warning",
        url: appUrl("/settings/account/security"),
      },
    });
  } catch (err) {
    log.warn("new-device email failed", err);
  }
}
