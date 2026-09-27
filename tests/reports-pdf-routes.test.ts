import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createScheduleAction, deleteScheduleAction, sendScheduleNowAction, setScheduleEnabledAction } from "@/app/(app)/reports/actions";
import { GET as pdfRoute } from "@/app/api/v1/reports/[report]/pdf/route";
import { createApiKey, SESSION_COOKIE } from "@/lib/auth";
import { hashPassword, randomToken, sha256 } from "@/lib/crypto";
import { schema, type DB } from "@/lib/db";
import type { Role } from "@/lib/db/schema";
import { resetRateLimits } from "@/lib/http";
import { pdfLogoBytes, validatePngCopy } from "@/lib/media";
import { sendEmail } from "@/lib/notify/channels/email";
import { Busy, createLimiter, pdfLimiter } from "@/lib/pdf/limiter";
import { roleCan } from "@/lib/permissions";
import { cadenceLabel, isDue, latestSlot, runDueReportSchedules, runSchedule, scrubAddresses } from "@/lib/report-kinds/schedules";
import type { Workspace } from "@/lib/settings";
import { setupWorkspace } from "./helpers";

// PDF route permissions, the CPU guard, export logging, schedules and email attachments.

const ctx = vi.hoisted(() => ({ jar: new Map<string, string>(), headers: new Headers({ "x-forwarded-for": "198.51.100.9" }) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (ctx.jar.has(name) ? { name, value: ctx.jar.get(name)! } : undefined),
    set: (name: string, value: string) => void ctx.jar.set(name, value),
    delete: (name: string) => void ctx.jar.delete(name),
  }),
  headers: async () => ctx.headers,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
const mail = vi.hoisted(() => ({ sent: [] as Record<string, unknown>[] }));
vi.mock("nodemailer", () => {
  const createTransport = () => ({ sendMail: async (m: Record<string, unknown>) => void mail.sent.push(m) });
  return { default: { createTransport }, createTransport };
});

let db: DB;
let ws: Workspace;
const users: Partial<Record<Role, { id: string; email: string }>> = {};

async function token(userId: string) {
  const t = randomToken(32);
  await db.insert(schema.sessions).values({ userId, workspaceId: ws.id, tokenHash: sha256(t), expiresAt: new Date(Date.now() + 86_400_000) });
  return t;
}
const url = (kind: string, q = "start=2026-08-01&end=2026-08-31&model=linear") => `http://app.test/api/v1/reports/${kind}/pdf?${q}`;
const call = (kind: string, headers: Record<string, string> = {}, q?: string) => pdfRoute(new Request(url(kind, q), { headers }), { params: Promise.resolve({ report: kind }) });

beforeAll(async () => {
  ({ db, ws } = await setupWorkspace({ name: "Route Test", timezone: "UTC" }));
  for (const role of ["owner", "admin", "analyst", "viewer", "client"] as Role[]) {
    const [u] = await db.insert(schema.users).values({ email: `${role}@pdf.test`, name: role === "analyst" ? "Ana Lyst" : null, passwordHash: await hashPassword("correct-horse-battery") }).returning();
    await db.insert(schema.memberships).values({ organizationId: ws.organizationId, userId: u.id, role, workspaceIds: role === "client" ? [ws.id] : null });
    users[role] = u;
  }
});

beforeEach(() => {
  resetRateLimits();
  ctx.jar.clear();
  mail.sent.length = 0;
});

describe("GET /api/v1/reports/{kind}/pdf", () => {
  it("grants reports.pdf to every role, and scheduling to owners, admins and analysts", () => {
    expect(["owner", "admin", "analyst"].every((r) => roleCan(r as Role, "reports.pdf"))).toBe(true);
    // Aggregate PDFs carry no contact data; clients can be switched off per organization (security policy).
    expect(roleCan("viewer", "reports.pdf")).toBe(true);
    expect(roleCan("client", "reports.pdf")).toBe(true);
    expect(roleCan("viewer", "reports.schedule")).toBe(false);
  });

  it("needs a session with reports.pdf or an API key", async () => {
    expect((await call("executive-summary")).status).toBe(401);
    expect((await call("executive-summary", { authorization: "Bearer al_nope" })).status).toBe(401);
    // Clients get aggregate PDFs unless the organization switches that off.
    expect((await call("executive-summary", { cookie: `${SESSION_COOKIE}=${await token(users.client!.id)}` })).status).toBe(200);
    await db.update(schema.organizations).set({ security: { clientsCanDownloadPdf: false } }).where(eq(schema.organizations.id, ws.organizationId));
    try {
      expect((await call("executive-summary", { cookie: `${SESSION_COOKIE}=${await token(users.client!.id)}` })).status).toBe(403);
    } finally {
      await db.update(schema.organizations).set({ security: {} }).where(eq(schema.organizations.id, ws.organizationId));
    }
    // A cross-site page can't make a signed-in browser render (and log) a report.
    const cross = await call("executive-summary", { cookie: `${SESSION_COOKIE}=${await token(users.analyst!.id)}`, "sec-fetch-site": "cross-site" });
    expect(cross.status).toBe(403);
    const res = await call("executive-summary", { cookie: `${SESSION_COOKIE}=${await token(users.analyst!.id)}` });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="adledger-.+-executive-summary-2026-08-01-to-2026-08-31\.pdf"$/);
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");

    const exportId = res.headers.get("x-export-id")!;
    const [row] = await db.select().from(schema.exportLog).where(eq(schema.exportLog.id, exportId));
    expect(row).toMatchObject({ userId: users.analyst!.id, via: "session", reportKind: "executive-summary", status: "ok" });
    const audits = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.action, "report.pdf_exported"), eq(schema.auditLog.target, "executive-summary")));
    const a = audits.find((x) => (x.meta as { exportId?: string } | null)?.exportId === exportId)!;
    expect(a.meta).toMatchObject({ exportId, via: "session" });
    expect(JSON.stringify(a.meta)).not.toMatch(/@/);

    const { key, row: keyRow } = await createApiKey(ws.id, "Looker");
    const viaKey = await call("wasted-spend", { authorization: `Bearer ${key}` });
    expect(viaKey.status).toBe(200);
    const [k] = await db.select().from(schema.exportLog).where(eq(schema.exportLog.id, viaKey.headers.get("x-export-id")!));
    expect(k).toMatchObject({ apiKeyId: keyRow.id, via: "api_key", userId: null });
  });

  it("validates the kind and the parameters", async () => {
    const admin = { cookie: `${SESSION_COOKIE}=${await token(users.admin!.id)}` };
    expect((await call("nope", admin)).status).toBe(404);
    expect((await call("__proto__", admin)).status).toBe(404);
    expect((await call("executive-summary", admin, "start=2026-09-10&end=2026-09-01")).status).toBe(400);
    expect((await call("executive-summary", admin, "start=2020-01-01&end=2026-01-01")).status).toBe(400);
    expect((await call("executive-summary", admin, "start=bad&end=2026-01-01")).status).toBe(400);
    // No dates: the kind's default range.
    expect((await call("weekly-performance", admin, "")).status).toBe(200);
  });

  it("returns 429 once two renders are running and the queue is full", async () => {
    const admin = { cookie: `${SESSION_COOKIE}=${await token(users.admin!.id)}` };
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    const held = Array.from({ length: 4 }, () => pdfLimiter.run(() => hold).catch(() => undefined));
    await Promise.resolve();
    expect(pdfLimiter.active).toBe(2);
    expect(pdfLimiter.waiting).toBe(2);
    const res = await call("executive-summary", admin);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("10");
    release();
    await Promise.all(held);
    expect(pdfLimiter.active).toBe(0);
  });
});

describe("render limiter", () => {
  it("runs two at a time, queues a few, then refuses", async () => {
    const l = createLimiter({ concurrency: 2, queue: 1, waitMs: 5_000 });
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    const a = l.run(() => hold);
    const b = l.run(() => hold);
    const c = l.run(async () => "queued");
    await expect(l.run(async () => "x")).rejects.toBeInstanceOf(Busy);
    release();
    await Promise.all([a, b]);
    await expect(c).resolves.toBe("queued");
  });

  it("gives up on a queued render after the wait limit", async () => {
    const l = createLimiter({ concurrency: 1, queue: 1, waitMs: 20 });
    let release!: () => void;
    const first = l.run(() => new Promise<void>((r) => (release = r)));
    await expect(l.run(async () => 1)).rejects.toBeInstanceOf(Busy);
    release();
    await first;
    await expect(l.run(async () => 2)).resolves.toBe(2);
  });
});

describe("scheduled reports", () => {
  const base = { cadence: "weekly" as const, weekday: 1, hour: 8, enabled: true };

  it("works out the latest slot and the period it covers", () => {
    // Wednesday 2026-09-30 10:00 UTC → last Monday 28 Sep, covering Mon 21 – Sun 27 Sep.
    const now = new Date("2026-09-30T10:00:00Z");
    expect(latestSlot(base, "UTC", now)).toEqual({ date: "2026-09-28", hour: 8, start: "2026-09-21", end: "2026-09-27" });
    // Monday before 08:00 → the previous Monday's slot.
    expect(latestSlot(base, "UTC", new Date("2026-09-28T07:00:00Z")).date).toBe("2026-09-21");
    // Monthly on the 1st → the previous calendar month.
    expect(latestSlot({ ...base, cadence: "monthly" }, "UTC", new Date("2026-10-01T09:00:00Z"))).toEqual({ date: "2026-10-01", hour: 8, start: "2026-09-01", end: "2026-09-30" });
    expect(latestSlot({ ...base, cadence: "monthly" }, "UTC", new Date("2026-10-01T07:00:00Z")).start).toBe("2026-08-01");
    // Workspace timezone: 23:30 UTC Sunday is already Monday 05:00 in Kolkata (before 08:00).
    expect(latestSlot(base, "Asia/Kolkata", new Date("2026-09-27T23:30:00Z")).date).toBe("2026-09-21");
    expect(cadenceLabel(base)).toBe("Mondays at 08:00");
    expect(cadenceLabel({ ...base, cadence: "monthly", hour: 17 })).toBe("1st of each month at 17:00");
  });

  it("is due once per slot, and not for slots before it was created", () => {
    const created = new Date("2026-09-23T12:00:00Z");
    expect(isDue({ ...base, createdAt: created, lastRunAt: null }, "UTC", new Date("2026-09-25T12:00:00Z"))).toBe(false);
    expect(isDue({ ...base, createdAt: created, lastRunAt: null }, "UTC", new Date("2026-09-28T08:05:00Z"))).toBe(true);
    expect(isDue({ ...base, createdAt: created, lastRunAt: new Date("2026-09-28T08:05:00Z") }, "UTC", new Date("2026-09-28T13:00:00Z"))).toBe(false);
    expect(isDue({ ...base, enabled: false, createdAt: created, lastRunAt: null }, "UTC", new Date("2026-09-28T08:05:00Z"))).toBe(false);
  });

  it("server actions need reports.schedule and stay inside the workspace", async () => {
    ctx.jar.set(SESSION_COOKIE, await token(users.viewer!.id));
    expect((await createScheduleAction({ kind: "weekly-performance", cadence: "weekly" })).ok).toBe(false);
    ctx.jar.set(SESSION_COOKIE, await token(users.analyst!.id));
    expect((await createScheduleAction({ kind: "nope" as "weekly-performance", cadence: "weekly" })).ok).toBe(false);
    const r = await createScheduleAction({ kind: "weekly-performance", cadence: "weekly", weekday: 1, hour: 8, recipients: "some", userIds: [users.analyst!.id, "00000000-0000-4000-8000-000000000000"] });
    expect(r.ok).toBe(true);
    const [s] = await db.select().from(schema.reportSchedules).where(eq(schema.reportSchedules.workspaceId, ws.id));
    expect(s).toMatchObject({ reportKind: "weekly-performance", cadence: "weekly", params: { model: "linear", compare: "previous" }, recipients: { all: false, userIds: [users.analyst!.id] }, createdBy: users.analyst!.id });
    expect((await setScheduleEnabledAction(s.id, false)).ok).toBe(true);
    expect((await db.select().from(schema.reportSchedules).where(eq(schema.reportSchedules.id, s.id)))[0].enabled).toBe(false);
    // Another workspace's schedule id is "not found".
    const other = await setupWorkspace();
    const [foreign] = await other.db.insert(schema.reportSchedules).values({ workspaceId: other.ws.id, name: "x", reportKind: "executive-summary", params: { model: "linear", compare: "previous" }, cadence: "weekly", recipients: { all: true, userIds: [] } }).returning();
    expect((await deleteScheduleAction(foreign.id)).ok).toBe(false);
    expect((await deleteScheduleAction(s.id)).ok).toBe(true);
    await other.db.delete(schema.reportSchedules).where(eq(schema.reportSchedules.id, foreign.id));
  });

  it("skips quiet periods, then emails the PDF to members and logs the export", async () => {
    const [s] = await db
      .insert(schema.reportSchedules)
      .values({ workspaceId: ws.id, name: "Weekly", reportKind: "weekly-performance", params: { model: "linear", compare: "previous" }, cadence: "weekly", weekday: 1, hour: 8, recipients: { all: true, userIds: [] }, createdAt: new Date("2026-09-01T00:00:00Z") })
      .returning();
    const now = new Date("2026-09-28T09:00:00Z");
    // No data in the workspace yet: skipped, nothing sent.
    expect(await runDueReportSchedules(db, now)).toBe(1);
    let [after] = await db.select().from(schema.reportSchedules).where(eq(schema.reportSchedules.id, s.id));
    expect(after.lastStatus).toBe("skipped");
    expect(mail.sent).toHaveLength(0);
    // Already served this slot.
    expect(await runDueReportSchedules(db, now)).toBe(0);

    // Add a day of spend in the period and send by hand (SMTP_URL fallback).
    const [acct] = await db.insert(schema.adAccounts).values({ workspaceId: ws.id, platform: "meta", externalId: "act_1", name: "Acct", currency: "USD" }).returning();
    const [c] = await db.insert(schema.campaigns).values({ workspaceId: ws.id, adAccountId: acct.id, platform: "meta", externalId: "c1", name: "Prospecting", status: "ACTIVE" }).returning();
    const [g] = await db.insert(schema.adGroups).values({ workspaceId: ws.id, campaignId: c.id, platform: "meta", externalId: "g1", name: "G" }).returning();
    const [ad] = await db.insert(schema.ads).values({ workspaceId: ws.id, adGroupId: g.id, campaignId: c.id, platform: "meta", externalId: "a1", name: "A" }).returning();
    await db.insert(schema.adInsightsDaily).values({ workspaceId: ws.id, platform: "meta", date: "2026-09-22", adAccountId: acct.id, campaignId: c.id, adGroupId: g.id, adId: ad.id, spendMinor: 12_345, currency: "USD", impressions: 1000, clicks: 20 });

    process.env.SMTP_URL = "smtp://localhost:2525";
    process.env.SMTP_FROM = "AdLedger <reports@pdf.test>";
    try {
      const outcome = await runSchedule(db, after, ws, now);
      expect(outcome.status).toBe("sent");
      expect(mail.sent).toHaveLength(1);
      const m = mail.sent[0] as { bcc: string; to: string; subject: string; attachments: { filename: string; content: Buffer; contentType: string }[]; html: string };
      // Everyone who may download the PDF gets it (clients only while the organization allows client PDFs).
      expect(m.bcc.split(", ").sort()).toEqual(["admin@pdf.test", "analyst@pdf.test", "client@pdf.test", "owner@pdf.test", "viewer@pdf.test"]);
      expect(m.to).toBe("AdLedger <reports@pdf.test>");
      expect(m.subject).toBe("Weekly performance · Route Test · 21 – 27 Sep 2026");
      expect(m.attachments).toHaveLength(1);
      expect(m.attachments[0].contentType).toBe("application/pdf");
      expect(m.attachments[0].content.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect(m.html).toContain("$123");
      const [row] = await db.select().from(schema.exportLog).where(eq(schema.exportLog.id, outcome.exportId!));
      expect(row).toMatchObject({ scheduleId: s.id, via: "schedule", recipients: 5, status: "ok", params: { start: "2026-09-21", end: "2026-09-27", model: "linear", compare: "previous" } });
      [after] = await db.select().from(schema.reportSchedules).where(eq(schema.reportSchedules.id, s.id));
      expect(after).toMatchObject({ lastStatus: "sent", lastError: null });

      // "Send now" from the dashboard goes through the same path (the latest slot by the real
      // clock may be a quiet week, so allow empty periods for this one).
      await db.update(schema.reportSchedules).set({ skipEmpty: false }).where(eq(schema.reportSchedules.id, s.id));
      ctx.jar.set(SESSION_COOKIE, await token(users.admin!.id));
      expect((await sendScheduleNowAction(s.id)).ok).toBe(true);
      expect(mail.sent).toHaveLength(2);
    } finally {
      delete process.env.SMTP_URL;
      delete process.env.SMTP_FROM;
    }

    // Without any email transport the run fails loudly and says why.
    const failed = await runSchedule(db, after, ws, now);
    expect(failed).toMatchObject({ status: "error" });
    expect(failed.message).toMatch(/Email isn't set up/);
  });

  it("never stores recipient addresses from SMTP errors", () => {
    expect(scrubAddresses("550 5.1.1 <bob@example.com>: Recipient address rejected")).toBe("550 5.1.1 <[address]>: Recipient address rejected");
  });
});

describe("email attachments and PNG logos", () => {
  it("passes attachments to nodemailer and caps their size", async () => {
    process.env.SMTP_URL = "smtp://localhost:2525";
    try {
      await sendEmail({ to: "a@x.test", msg: { title: "T", text: "B", severity: "info" }, conn: { config: { from: "f@x.test" }, secrets: {} }, attachments: [{ filename: "r.pdf", content: Buffer.from("%PDF-1"), contentType: "application/pdf" }] });
      expect((mail.sent.at(-1) as { attachments: { filename: string }[] }).attachments[0].filename).toBe("r.pdf");
      await expect(
        sendEmail({ to: "a@x.test", msg: { title: "T", text: "B", severity: "info" }, conn: { config: { from: "f@x.test" }, secrets: {} }, attachments: [{ filename: "big.pdf", content: Buffer.alloc(11 * 1024 * 1024), contentType: "application/pdf" }] }),
      ).rejects.toThrow(/10 MB/);
    } finally {
      delete process.env.SMTP_URL;
    }
  });

  it("keeps a PNG copy of logos for PDFs", async () => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
    const pngFile = new File([png], "image.png", { type: "image/png" });
    expect(await validatePngCopy(pngFile)).toEqual(new Uint8Array(png));
    expect(await validatePngCopy(new File([Buffer.from("<svg/>")], "x.png", { type: "image/png" }))).toBeNull();
    expect(await validatePngCopy(null)).toBeNull();
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    expect(pdfLogoBytes(null, webp, "image/webp")).toBeNull();
    expect(pdfLogoBytes(null, new Uint8Array(png), "image/png")).toEqual(new Uint8Array(png));
    expect(pdfLogoBytes(new Uint8Array(png), webp, "image/webp")).toEqual(new Uint8Array(png));
  });
});
