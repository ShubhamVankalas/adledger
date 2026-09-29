import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { completeTourAction } from "@/app/actions/tour";
import { inflate, placeCard, scrollDelta } from "@/components/tour/place-card";
import { getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { randomToken, sha256 } from "@/lib/crypto";
import { schema, type DB } from "@/lib/db";
import { BUILTIN_ROLES, roleDefCan, type Permission } from "@/lib/permissions";
import { TOUR_STEPS, tourMayAutoStart, tourStepsFor, type TourCan } from "@/lib/tour";
import { setupWorkspace } from "./helpers";

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

const canOf = (role: string): TourCan => {
  const def = BUILTIN_ROLES.find((r) => r.key === role)!;
  return (p) => roleDefCan(def, p);
};
const only = (...perms: Permission[]): TourCan => (p) => perms.includes(p);
const ids = (can: TourCan, phone = false) => tourStepsFor(can, { phone }).map((s) => s.id);

describe("tour steps by permission", () => {
  it("gives an admin the whole desktop tour, in order", () => {
    expect(ids(canOf("admin"))).toEqual([
      "workspace",
      "filters",
      "kpis",
      "live",
      "performance",
      "attribution",
      "money",
      "crm",
      "insights",
      "reports",
      "search",
      "integrations",
      "goals",
      "team",
      "profile",
      "finish",
    ]);
  });

  it("leaves out setup and team steps for viewers and analysts", () => {
    for (const role of ["viewer", "analyst"]) {
      const got = ids(canOf(role));
      expect(got).not.toContain("integrations");
      expect(got).not.toContain("team");
      expect(got).toContain("kpis");
      expect(got).toContain("finish");
    }
    // Analysts can manage alerts, viewers only read targets: the copy follows.
    const body = (role: string) => tourStepsFor(canOf(role)).find((s) => s.id === "goals")!.body;
    expect(body("analyst")).toMatch(/alert rules/);
    expect(body("viewer")).not.toMatch(/alert rules/);
  });

  it("follows a custom role that hides pages", () => {
    const got = ids(only("reports.view", "page.overview", "page.performance"));
    expect(got).toEqual(["workspace", "filters", "kpis", "performance", "search", "goals", "profile", "finish"]);
    // No page access at all: only the steps that need no page remain, and none point at a missing page.
    const none = tourStepsFor(only());
    expect(none.map((s) => s.id)).toEqual(["workspace", "search", "goals", "profile", "finish"]);
    expect(none.every((s) => !s.href || s.href.startsWith("/settings"))).toBe(true);
  });

  it("uses the first report page the role can open for the date range", () => {
    expect(tourStepsFor(only("page.performance")).find((s) => s.id === "filters")?.href).toBe("/performance");
    expect(tourStepsFor(canOf("admin")).find((s) => s.id === "filters")?.href).toBe("/");
    expect(ids(only("page.live"))).not.toContain("filters");
  });

  it("describes only the CRM parts the role can open", () => {
    const crm = (can: TourCan) => tourStepsFor(can).find((s) => s.id === "crm")?.body ?? "";
    expect(crm(only("page.contacts"))).toMatch(/Contacts/);
    expect(crm(only("page.contacts"))).not.toMatch(/Pipeline|tasks/);
    expect(crm(only("page.pipeline"))).toMatch(/Pipeline/);
    expect(ids(only())).not.toContain("crm");
  });

  it("swaps sidebar steps for tabs on phones and adds the More step", () => {
    const steps = tourStepsFor(canOf("admin"), { phone: true });
    const got = steps.map((s) => s.id);
    expect(got).toContain("more");
    expect(got).not.toContain("attribution");
    expect(got).not.toContain("workspace");
    expect(steps.find((s) => s.id === "live")?.target).toEqual(["tab-live"]);
    expect(steps.find((s) => s.id === "crm")?.target).toEqual(["tab-contacts"]);
    expect(ids(canOf("admin"))).not.toContain("more");
  });

  it("is well formed", () => {
    expect(new Set(TOUR_STEPS.map((s) => s.id)).size).toBe(TOUR_STEPS.length);
    for (const s of tourStepsFor(canOf("owner"))) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.body.length).toBeGreaterThan(20);
    }
    expect(tourMayAutoStart("/")).toBe(true);
    expect(tourMayAutoStart("/onboarding")).toBe(false);
  });
});

describe("tour card geometry", () => {
  const vw = 1440;
  const vh = 900;
  const card = { w: 344, h: 230 };

  it("puts the card beside a sidebar item and keeps it on screen", () => {
    const p = placeCard({ spot: { x: 8, y: 300, w: 220, h: 34 }, card, vw, vh, prefer: "right" });
    expect(p).toMatchObject({ kind: "float", side: "right", x: 8 + 220 + 14 });
    if (p.kind === "float") expect(p.y).toBeGreaterThanOrEqual(12);
    const low = placeCard({ spot: { x: 8, y: 880, w: 220, h: 34 }, card, vw, vh, prefer: "right" });
    if (low.kind === "float") expect(low.y + card.h).toBeLessThanOrEqual(vh - 12);
  });

  it("falls back to another side, then inside, when the preferred one is full", () => {
    const p = placeCard({ spot: { x: 1200, y: 100, w: 200, h: 40 }, card, vw, vh, prefer: "right" });
    expect(p).toMatchObject({ kind: "float" });
    if (p.kind === "float") expect(p.x + card.w).toBeLessThanOrEqual(vw);
    const big = placeCard({ spot: { x: 0, y: 0, w: vw, h: vh }, card, vw, vh });
    expect(big).toMatchObject({ kind: "float", side: "inside" });
  });

  it("centres without a target and docks to the far edge on phones", () => {
    expect(placeCard({ spot: null, card, vw, vh })).toMatchObject({ kind: "float", x: (vw - card.w) / 2, y: (vh - card.h) / 2 });
    expect(placeCard({ spot: { x: 10, y: 740, w: 60, h: 52 }, card, vw: 375, vh: 812 })).toEqual({ kind: "dock", edge: "top" });
    expect(placeCard({ spot: { x: 10, y: 80, w: 300, h: 40 }, card, vw: 375, vh: 812 })).toEqual({ kind: "dock", edge: "bottom" });
  });

  it("inflates rects and computes scroll deltas", () => {
    expect(inflate({ x: 10, y: 10, w: 20, h: 20 }, 6)).toEqual({ x: 4, y: 4, w: 32, h: 32 });
    const band = { top: 76, bottom: 800 };
    expect(scrollDelta({ top: 200, bottom: 300 }, band)).toBe(0);
    expect(scrollDelta({ top: 900, bottom: 1000 }, band)).toBeGreaterThan(0);
    expect(scrollDelta({ top: -300, bottom: -200 }, band)).toBeLessThan(0);
    expect(scrollDelta({ top: 500, bottom: 1800 }, band)).toBe(424);
  });
});

describe("completeTourAction", () => {
  let db: DB;
  let userId: string;
  let workspaceId: string;

  beforeAll(async () => {
    const s = await setupWorkspace();
    db = s.db;
    workspaceId = s.ws.id;
    const [u] = await db.insert(schema.users).values({ email: "tour@example.com", passwordHash: "x" }).returning();
    userId = u.id;
    await db.insert(schema.memberships).values({ organizationId: s.org.id, userId, role: "viewer", workspaceIds: null });
  });

  const signIn = async () => {
    const token = randomToken(32);
    await db.insert(schema.sessions).values({ userId, workspaceId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 86_400_000) });
    ctx.jar.set(SESSION_COOKIE, token);
  };
  const stored = async () => (await db.select().from(schema.users).where(eq(schema.users.id, userId)))[0].tourCompletedAt;

  it("needs a signed-in user", async () => {
    ctx.jar.clear();
    const r = await completeTourAction("skipped");
    expect(r.ok).toBe(false);
    expect(await stored()).toBeNull();
  });

  it("stores the first completion once, for any role, and audits it", async () => {
    await signIn();
    expect((await getSessionUser())?.tourCompletedAt).toBeNull();
    expect((await completeTourAction("finished")).ok).toBe(true);
    const first = await stored();
    expect(first).toBeInstanceOf(Date);
    expect((await getSessionUser())?.tourCompletedAt).toEqual(first);

    // A replay changes nothing and adds no second audit entry.
    expect((await completeTourAction("skipped")).ok).toBe(true);
    expect(await stored()).toEqual(first);
    const audits = (await db.select().from(schema.auditLog)).filter((a) => a.action === "account.tour_completed" && a.userId === userId);
    expect(audits).toHaveLength(1);
    expect(audits[0].meta).toMatchObject({ outcome: "finished" });
  });

  it("rejects an unknown outcome", async () => {
    await signIn();
    // @ts-expect-error the wire format is not trusted
    expect((await completeTourAction("whatever")).ok).toBe(false);
  });
});
