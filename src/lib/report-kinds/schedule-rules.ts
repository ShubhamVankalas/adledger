import { eq } from "drizzle-orm";
import { schema, type DB } from "../db";
import { roleCan } from "../permissions";
import type { Workspace } from "../settings";

// When a scheduled report is due, which period it covers and who receives it. No PDF imports
// here, so pages can list schedules without loading the renderer (see ./schedules.ts).

export type Schedule = typeof schema.reportSchedules.$inferSelect;

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export const MAX_SCHEDULES_PER_WORKSPACE = 20;

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => iso(Date.parse(`${d}T00:00:00Z`) + n * DAY);
/** ISO weekday of a YYYY-MM-DD date: 1 = Monday … 7 = Sunday. */
const weekdayOf = (d: string) => ((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

/** Local calendar date and hour of `at` in `tz`. */
export function localParts(tz: string, at: Date): { date: string; hour: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
}

/**
 * The most recent send slot at or before `now` (local date + hour in the workspace timezone) and
 * the report period it covers: weekly = the seven days before the send day, monthly = the
 * previous calendar month.
 */
export function latestSlot(s: Pick<Schedule, "cadence" | "weekday" | "hour">, tz: string, now: Date): { date: string; hour: number; start: string; end: string } {
  const local = localParts(tz, now);
  const hour = Math.min(23, Math.max(0, s.hour));
  if (s.cadence === "monthly") {
    let date = `${local.date.slice(0, 7)}-01`;
    if (local.date === date && local.hour < hour) date = `${iso(Date.parse(`${date}T00:00:00Z`) - DAY).slice(0, 7)}-01`;
    const end = addDays(date, -1);
    return { date, hour, start: `${end.slice(0, 7)}-01`, end };
  }
  const wd = Math.min(7, Math.max(1, s.weekday));
  let back = (weekdayOf(local.date) - wd + 7) % 7;
  if (back === 0 && local.hour < hour) back = 7;
  const date = addDays(local.date, -back);
  return { date, hour, start: addDays(date, -7), end: addDays(date, -1) };
}

/** Due when neither the last run nor the schedule's creation happened at or after the latest slot. */
export function isDue(s: Pick<Schedule, "cadence" | "weekday" | "hour" | "lastRunAt" | "createdAt" | "enabled">, tz: string, now: Date): boolean {
  if (!s.enabled) return false;
  const slot = latestSlot(s, tz, now);
  const since = localParts(tz, s.lastRunAt ?? s.createdAt);
  return since.date < slot.date || (since.date === slot.date && since.hour < slot.hour);
}

/** "Mondays at 08:00" / "1st of each month at 08:00". */
export function cadenceLabel(s: Pick<Schedule, "cadence" | "weekday" | "hour">): string {
  const at = `${String(s.hour).padStart(2, "0")}:00`;
  return s.cadence === "monthly" ? `1st of each month at ${at}` : `${WEEKDAYS[Math.min(7, Math.max(1, s.weekday)) - 1]}s at ${at}`;
}

/**
 * Members a schedule sends to: only people who can open the workspace (clients are limited to
 * theirs) and whose role may hold a PDF report (`reports.pdf`), so email never hands a PDF to
 * someone the download button would refuse.
 */
export async function scheduleRecipients(db: DB, ws: Workspace, s: Pick<Schedule, "recipients">): Promise<{ userId: string; email: string; name: string | null }[]> {
  const members = await db
    .select({ userId: schema.users.id, email: schema.users.email, name: schema.users.name, role: schema.memberships.role, workspaceIds: schema.memberships.workspaceIds })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(eq(schema.memberships.organizationId, ws.organizationId));
  const allowed = members.filter((m) => (!m.workspaceIds || m.workspaceIds.includes(ws.id)) && roleCan(m.role, "reports.pdf"));
  const picked = s.recipients.all ? allowed : allowed.filter((m) => s.recipients.userIds.includes(m.userId));
  return picked.map((m) => ({ userId: m.userId, email: m.email, name: m.name }));
}
