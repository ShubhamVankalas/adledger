"use server";

import { and, count, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, guard, ok, run, type ActionResult } from "@/lib/actions";
import { audit } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { pdfLimiter, Busy } from "@/lib/pdf/limiter";
import { REPORT_CATALOG } from "@/lib/report-kinds/catalog";
import { REPORT_KIND_IDS } from "@/lib/report-kinds/types";
import { MAX_SCHEDULES_PER_WORKSPACE, scheduleRecipients } from "@/lib/report-kinds/schedule-rules";

// Reports → Schedule: create, pause, delete and "send now" for scheduled PDF deliveries.

const scheduleInput = z.object({
  kind: z.enum(REPORT_KIND_IDS),
  name: z.string().trim().max(80).optional(),
  cadence: z.enum(["weekly", "monthly"]),
  weekday: z.coerce.number().int().min(1).max(7).default(1),
  hour: z.coerce.number().int().min(0).max(23).default(8),
  model: z.enum(["first_touch", "last_touch", "linear"]).default("linear"),
  recipients: z.enum(["all", "some"]).default("all"),
  userIds: z.array(z.string().uuid()).max(200).default([]),
  skipEmpty: z.boolean().default(true),
});

export type ScheduleInput = z.input<typeof scheduleInput>;

export async function createScheduleAction(input: ScheduleInput): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("reports.schedule");
    const parsed = scheduleInput.safeParse(input);
    if (!parsed.success) return fail("Check the schedule details and try again.");
    const v = parsed.data;
    const ws = user.workspace;
    const db = await getDb();
    const [{ n }] = await db.select({ n: count() }).from(schema.reportSchedules).where(eq(schema.reportSchedules.workspaceId, ws.id));
    if (n >= MAX_SCHEDULES_PER_WORKSPACE) return fail(`A workspace can have up to ${MAX_SCHEDULES_PER_WORKSPACE} schedules. Delete one first.`);
    const recipients = { all: v.recipients === "all", userIds: v.recipients === "all" ? [] : v.userIds };
    if (!recipients.all) {
      // Only people who can open this workspace; ids are re-checked at send time too.
      const allowed = new Set((await scheduleRecipients(db, ws, { recipients: { all: true, userIds: [] } })).map((r) => r.userId));
      recipients.userIds = recipients.userIds.filter((id) => allowed.has(id));
      if (!recipients.userIds.length) return fail("Choose at least one person to send it to.");
    }
    const meta = REPORT_CATALOG[v.kind];
    const [row] = await db
      .insert(schema.reportSchedules)
      .values({
        workspaceId: ws.id,
        name: v.name || `${meta.title}, ${v.cadence}`,
        reportKind: v.kind,
        params: { model: v.model, compare: meta.usesCompare ? "previous" : "none" },
        cadence: v.cadence,
        weekday: v.weekday,
        hour: v.hour,
        recipients,
        skipEmpty: v.skipEmpty,
        createdBy: user.id,
      })
      .returning({ id: schema.reportSchedules.id });
    await audit(user, "report.schedule_created", row.id, { kind: v.kind, cadence: v.cadence, recipients: recipients.all ? "all" : recipients.userIds.length });
    revalidatePath("/reports");
    return ok(v.cadence === "weekly" ? "Scheduled. The first report goes out next week." : "Scheduled. The first report goes out on the 1st.");
  });
}

async function ownSchedule(id: string, workspaceId: string) {
  if (!z.string().uuid().safeParse(id).success) return null;
  const db = await getDb();
  const [s] = await db.select().from(schema.reportSchedules).where(and(eq(schema.reportSchedules.id, id), eq(schema.reportSchedules.workspaceId, workspaceId)));
  return s ?? null;
}

export async function setScheduleEnabledAction(id: string, enabled: boolean): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("reports.schedule");
    const s = await ownSchedule(id, user.workspace.id);
    if (!s) return fail("That schedule no longer exists.");
    const db = await getDb();
    await db.update(schema.reportSchedules).set({ enabled: Boolean(enabled) }).where(eq(schema.reportSchedules.id, s.id));
    await audit(user, enabled ? "report.schedule_resumed" : "report.schedule_paused", s.id);
    revalidatePath("/reports");
    return ok(enabled ? "Schedule resumed." : "Schedule paused.");
  });
}

export async function deleteScheduleAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("reports.schedule");
    const s = await ownSchedule(id, user.workspace.id);
    if (!s) return fail("That schedule no longer exists.");
    const db = await getDb();
    await db.delete(schema.reportSchedules).where(eq(schema.reportSchedules.id, s.id));
    await audit(user, "report.schedule_deleted", s.id, { kind: s.reportKind });
    revalidatePath("/reports");
    return ok("Schedule deleted.");
  });
}

export async function sendScheduleNowAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("reports.schedule");
    const s = await ownSchedule(id, user.workspace.id);
    if (!s) return fail("That schedule no longer exists.");
    const db = await getDb();
    const { runSchedule } = await import("@/lib/report-kinds/schedules");
    try {
      const outcome = await pdfLimiter.run(() => runSchedule(db, s, user.workspace));
      await audit(user, "report.schedule_sent_now", s.id, { status: outcome.status, exportId: outcome.exportId ?? null });
      revalidatePath("/reports");
      if (outcome.status === "error") return fail(outcome.message);
      return ok(outcome.status === "skipped" ? `Skipped: ${outcome.message}` : outcome.message);
    } catch (err) {
      if (err instanceof Busy) return fail("Other reports are rendering. Try again in a few seconds.");
      throw err;
    }
  });
}
