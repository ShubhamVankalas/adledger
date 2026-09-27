import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { sha256 } from "@/lib/crypto";
import { schema, type DB } from "@/lib/db";
import type { Role } from "@/lib/db/schema";
import type { Workspace } from "@/lib/settings";
import { cleanViewName, listPinnedViews, listViews, sanitizeViewParams, viewHref } from "@/lib/views";
import { setupWorkspace } from "./helpers";

// Server actions read the session cookie through next/headers.
const session = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (session.token ? { name, value: session.token } : undefined), set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const actions = () => import("@/app/actions/views");

let db: DB;
let ws: Workspace;
let orgId: string;

/** A member with a live session in `w`; returns their user id and cookie token. */
async function member(role: Role, w: Workspace = ws) {
  const [user] = await db
    .insert(schema.users)
    .values({ email: `${role}-${Math.random().toString(36).slice(2, 8)}@team.test`, passwordHash: "x" })
    .returning();
  await db.insert(schema.memberships).values({ organizationId: orgId, userId: user.id, role });
  const token = `tok_${role}_${Math.random().toString(36).slice(2)}`;
  await db.insert(schema.sessions).values({ userId: user.id, workspaceId: w.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 86_400_000) });
  return { id: user.id, token };
}
const as = (m: { token: string }) => {
  session.token = m.token;
};

beforeAll(async () => {
  let org: { id: string };
  ({ db, ws, org } = await setupWorkspace());
  orgId = org.id;
});

describe("view params", () => {
  it("keeps only whitelisted keys with clean values", () => {
    const params = sanitizeViewParams("performance", {
      range: "90d",
      preset: "leadgen",
      cols: "spendMinor,leads,roas",
      email: "jane@example.com",
      view: "abc",
      q: "  brand\u0000 ",
      level: 3,
      sort: "",
    });
    expect(params).toEqual({ range: "90d", preset: "leadgen", cols: "spendMinor,leads,roas", q: "brand" });
    expect(sanitizeViewParams("performance", "range=7d&token=x&model=linear")).toEqual({ range: "7d", model: "linear" });
    expect(sanitizeViewParams("performance", new URLSearchParams("q=" + "x".repeat(1000))).q).toHaveLength(300);
    expect(sanitizeViewParams("performance", null)).toEqual({});
  });

  it("cleans names and builds links", () => {
    expect(cleanViewName("  Meta   lead gen  ")).toBe("Meta lead gen");
    expect(cleanViewName("   ")).toBeNull();
    expect(cleanViewName("x".repeat(80))).toHaveLength(60);
    expect(viewHref({ id: "v1", page: "performance", params: { preset: "leadgen" } })).toBe("/performance?preset=leadgen&view=v1");
  });
});

describe("saved view actions", () => {
  it("lets any member keep personal views and audits every change", async () => {
    const { saveViewAction, renameViewAction, updateViewParamsAction, setViewPinnedAction, deleteViewAction } = await actions();
    const viewer = await member("viewer");
    as(viewer);
    const saved = await saveViewAction({ page: "performance", name: "My lead gen", params: { preset: "leadgen", secret: "nope" } });
    expect(saved.ok).toBe(true);
    expect(saved.view).toMatchObject({ name: "My lead gen", shared: false, mine: true, pinned: false, params: { preset: "leadgen" } });
    const id = saved.view!.id;

    expect((await renameViewAction(id, "Lead gen, 90 days")).ok).toBe(true);
    expect((await updateViewParamsAction(id, { preset: "leadgen", range: "90d" })).ok).toBe(true);
    const pinned = await setViewPinnedAction(id, true);
    expect(pinned.views!.find((v) => v.id === id)).toMatchObject({ name: "Lead gen, 90 days", pinned: true, params: { preset: "leadgen", range: "90d" } });
    expect((await listPinnedViews(db, ws.id, viewer.id)).map((v) => v.href)).toEqual([`/performance?preset=leadgen&range=90d&view=${id}`]);

    const audits = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.userId, viewer.id), eq(schema.auditLog.target, id)));
    expect(audits.map((a) => a.action).sort()).toEqual(["view.create", "view.pin", "view.rename", "view.update"]);

    expect((await deleteViewAction(id)).ok).toBe(true);
    expect(await listViews(db, ws.id, viewer.id, "performance")).toEqual([]);
  });

  it("rejects bad input", async () => {
    const { saveViewAction } = await actions();
    as(await member("analyst"));
    expect(await saveViewAction({ page: "performance", name: "   ", params: {} })).toMatchObject({ ok: false, message: "Give the view a name." });
    expect(await saveViewAction({ page: "settings", name: "x", params: {} })).toMatchObject({ ok: false, message: "Unknown page." });
    session.token = undefined;
    expect((await saveViewAction({ page: "performance", name: "x", params: {} })).ok).toBe(false);
  });

  it("only analysts and up manage shared views", async () => {
    const { saveViewAction, renameViewAction, setViewPinnedAction, deleteViewAction } = await actions();
    const viewer = await member("viewer");
    as(viewer);
    expect((await saveViewAction({ page: "performance", name: "Team view", params: {}, shared: true })).ok).toBe(false);

    const analyst = await member("analyst");
    as(analyst);
    const shared = await saveViewAction({ page: "performance", name: "Team view", params: { preset: "ecommerce" }, shared: true });
    expect(shared.view).toMatchObject({ shared: true, mine: false });
    const id = shared.view!.id;

    // Everyone in the workspace sees it, but a viewer can't change it.
    as(viewer);
    expect((await listViews(db, ws.id, viewer.id, "performance")).map((v) => v.name)).toContain("Team view");
    expect(await renameViewAction(id, "Mine now")).toMatchObject({ ok: false, message: "Only admins and analysts can change shared views." });
    expect((await setViewPinnedAction(id, true)).ok).toBe(false);
    expect((await deleteViewAction(id)).ok).toBe(false);

    const admin = await member("admin");
    as(admin);
    expect((await setViewPinnedAction(id, true)).ok).toBe(true);
    // Pinned shared views appear in everyone's sidebar.
    expect((await listPinnedViews(db, ws.id, viewer.id)).map((v) => v.name)).toEqual(["Team view"]);
    expect((await deleteViewAction(id)).ok).toBe(true);
  });

  it("keeps personal views private and workspaces apart", async () => {
    const { saveViewAction, renameViewAction, deleteViewAction } = await actions();
    const alice = await member("analyst");
    const bob = await member("admin");
    as(alice);
    const mine = await saveViewAction({ page: "performance", name: "Alice only", params: {} });
    const id = mine.view!.id;

    as(bob);
    expect((await listViews(db, ws.id, bob.id, "performance")).map((v) => v.name)).not.toContain("Alice only");
    // Even an admin can't touch someone else's personal view.
    expect(await renameViewAction(id, "Taken")).toMatchObject({ ok: false, message: "That view no longer exists." });
    expect((await deleteViewAction(id)).ok).toBe(false);

    // A member signed in to another workspace can't reach this workspace's views.
    const [w2] = await db
      .insert(schema.workspaces)
      .values({ organizationId: orgId, name: "Second", slug: `second-${Date.now()}`, reportingCurrency: "USD", timezone: "UTC" })
      .returning();
    const other = await member("owner", w2 as Workspace);
    as(other);
    await saveViewAction({ page: "performance", name: "Team view (other)", params: {}, shared: true });
    expect((await deleteViewAction(id)).ok).toBe(false);
    expect((await listViews(db, ws.id, alice.id, "performance")).map((v) => v.name)).toEqual(["Alice only"]);
    expect((await listViews(db, w2.id, other.id, "performance")).map((v) => v.name)).toEqual(["Team view (other)"]);
  });

  it("orders shared views before personal ones", async () => {
    const { saveViewAction } = await actions();
    const owner = await member("owner");
    as(owner);
    await saveViewAction({ page: "performance", name: "Z personal", params: {} });
    await saveViewAction({ page: "performance", name: "A shared", params: {}, shared: true });
    const names = (await listViews(db, ws.id, owner.id, "performance")).map((v) => `${v.name}:${v.shared}`);
    expect(names.indexOf("A shared:true")).toBeLessThan(names.indexOf("Z personal:false"));
  });
});
