import { eq } from "drizzle-orm";
import { schema, type DB } from "../db";
import { log } from "../log";
import { appUrl } from "../notify";
import { sendEmail } from "../notify/channels/email";
import { credit, dateRange, moneyWhole, ratioX } from "../pdf/format";
import { overview } from "../reports";
import { getConnection, type Workspace } from "../settings";
import { REPORT_CATALOG, isReportKindId, midSentence } from "./catalog";
import { generateReportPdf } from "./render";
import { isDue, latestSlot, scheduleRecipients, type Schedule } from "./schedule-rules";

// Scheduled PDF deliveries (report_schedules). The hourly `report-schedules` job in lib/jobs.ts
// calls runDueReportSchedules(); each due schedule renders one PDF (logged in export_log) and
// emails it to workspace members through the workspace's Email channel, or SMTP_URL.

export * from "./schedule-rules";

export type RunOutcome = { status: "sent" | "skipped" | "error"; message: string; exportId?: string };

/** SMTP errors can echo addresses ("recipient rejected: …"): never store or log them. */
export const scrubAddresses = (s: string) => s.replace(/[^\s<>()"',;:]+@[^\s<>()"',;:]+/g, "[address]");

/** Render and email one schedule for its latest slot (the same slot when run by hand). */
export async function runSchedule(db: DB, s: Schedule, ws: Workspace, now = new Date()): Promise<RunOutcome> {
  const finish = async (o: RunOutcome) => {
    await db
      .update(schema.reportSchedules)
      .set({ lastRunAt: now, lastStatus: o.status, lastError: o.status === "error" ? o.message.slice(0, 300) : null })
      .where(eq(schema.reportSchedules.id, s.id));
    return o;
  };
  if (!isReportKindId(s.reportKind)) return finish({ status: "error", message: "This report type no longer exists." });
  const meta = REPORT_CATALOG[s.reportKind];
  const slot = latestSlot(s, ws.timezone, now);
  const req = { start: slot.start, end: slot.end, model: s.params.model, compare: s.params.compare };

  const o = await overview(db, ws, { start: req.start, end: req.end, model: req.model });
  if (s.skipEmpty && o.spendMinor === 0 && o.revenueMinor === 0) return finish({ status: "skipped", message: "No ad spend or revenue in the period." });

  const to = await scheduleRecipients(db, ws, s);
  if (!to.length) return finish({ status: "error", message: "Nobody to send to: the chosen members no longer have access." });

  const emailConn = await getConnection(ws.id, "notify_email", db);
  const conn = emailConn?.enabled ? { config: emailConn.config, secrets: emailConn.secrets } : undefined;
  if (!conn && !process.env.SMTP_URL) return finish({ status: "error", message: "Email isn't set up. Add it in Settings → Notifications." });

  let exportId: string | undefined;
  try {
    const out = await generateReportPdf(db, ws, s.reportKind, req, { via: "schedule", scheduleId: s.id, name: "Scheduled delivery" }, { now, recipients: to.length });
    exportId = out.exportId;
    const period = dateRange(req.start, req.end);
    await sendEmail({
      to: to.map((r) => r.email),
      bcc: to.length > 1,
      conn,
      subject: `${meta.title} · ${ws.name} · ${period}`,
      msg: {
        title: `${meta.title}: ${period}`,
        text: `Your ${s.cadence} ${midSentence(meta.title)} for **${ws.name}** is attached as a PDF (${out.pages} ${out.pages === 1 ? "page" : "pages"}).`,
        severity: "info",
        url: appUrl("/reports"),
        fields: [
          { label: "Ad spend", value: moneyWhole(o.spendMinor, ws.reportingCurrency) },
          { label: "Revenue", value: moneyWhole(o.revenueMinor, ws.reportingCurrency) },
          { label: "ROAS", value: ratioX(o.roas) },
          { label: "Customers", value: credit(o.customers) },
        ],
      },
      attachments: [{ filename: out.filename, content: out.pdf, contentType: "application/pdf" }],
    });
    return finish({ status: "sent", message: `Sent to ${to.length} ${to.length === 1 ? "person" : "people"}.`, exportId });
  } catch (err) {
    const message = scrubAddresses(err instanceof Error ? err.message : String(err)).slice(0, 300);
    if (exportId) await db.update(schema.exportLog).set({ status: "error", error: message }).where(eq(schema.exportLog.id, exportId));
    log.warn(`report schedule ${s.id} failed: ${message}`);
    return finish({ status: "error", message, exportId });
  }
}

/** Hourly job: run every enabled schedule whose latest slot hasn't been served yet, one at a time. */
export async function runDueReportSchedules(db: DB, now = new Date()): Promise<number> {
  const due = await db
    .select({ s: schema.reportSchedules, ws: schema.workspaces })
    .from(schema.reportSchedules)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.reportSchedules.workspaceId))
    .where(eq(schema.reportSchedules.enabled, true));
  let ran = 0;
  for (const { s, ws } of due) {
    if (!isDue(s, ws.timezone, now)) continue;
    try {
      await runSchedule(db, s, ws, now);
      ran++;
    } catch (err) {
      log.error(`report schedule ${s.id} crashed`, err);
    }
  }
  return ran;
}
