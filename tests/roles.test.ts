import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { inviteMemberAction, updateMemberAction } from "@/app/actions/org";
import { createRoleAction, deleteRoleAction, updateRoleAction } from "@/app/actions/roles";
import { gatePage } from "@/components/access-denied";
import { NAV, navVisible, type PaletteCan } from "@/components/command-palette-data";
import { acceptInvitation, accessibleWorkspaces, getSessionUser, InvitationError, SESSION_COOKIE } from "@/lib/auth";
import { randomToken, sha256 } from "@/lib/crypto";
import { schema, type DB } from "@/lib/db";
import type { Role } from "@/lib/db/schema";
import {
  ALL_PERMISSIONS,
  BUILTIN_ROLES,
  canAssign,
  firstAllowedPage,
  hrefAllowed,
  pagePermissionFor,
  PERMISSION_GROUPS,
  roleCan,
  type Permission,
} from "@/lib/permissions";
import { listOrgRoles } from "@/lib/roles";
import type { Workspace } from "@/lib/settings";
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

let db: DB;
let ws: Workspace;
let orgId: string;
const ids: Record<string, string> = {};

async function addMember(role: Role, email: string, workspaceIds: string[] | null = null) {
  const [u] = await db.insert(schema.users).values({ email, passwordHash: "x" }).returning();
  await db.insert(schema.memberships).values({ organizationId: orgId, userId: u.id, role, workspaceIds });
  return u.id;
}

async function signIn(userId: string, workspaceId = ws.id) {
  const token = randomToken(32);
  await db.insert(schema.sessions).values({ userId, workspaceId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 86_400_000) });
  ctx.jar.set(SESSION_COOKIE, token);
}

const membership = async (userId: string) =>
  (await db.select().from(schema.memberships).where(and(eq(schema.memberships.organizationId, orgId), eq(schema.memberships.userId, userId))))[0];

function roleForm(name: string, permissions: Permission[], scoped = false) {
  const f = new FormData();
  f.set("name", name);
  f.set("description", "");
  for (const p of permissions) f.append("permissions", p);
  if (scoped) f.set("workspaceScoped", "on");
  return f;
}

async function roleKey(name: string) {
  return (await listOrgRoles(db, orgId)).find((r) => r.name === name)!.key;
}

beforeAll(async () => {
  ({ db, ws } = await setupWorkspace());
  orgId = ws.organizationId;
  for (const role of ["owner", "admin", "analyst", "viewer"]) ids[role] = await addMember(role, `${role}@roles.test`);
  ids.client = await addMember("client", "client@roles.test", [ws.id]);
});

beforeEach(() => ctx.jar.clear());

describe("built-in roles", () => {
  it("resolve to today's matrix until an organization edits them", async () => {
    const roles = await listOrgRoles(db, orgId);
    expect(roles.map((r) => r.key)).toEqual(["owner", "admin", "analyst", "viewer", "client"]);
    for (const r of roles) {
      for (const p of ALL_PERMISSIONS) expect(r.permissions.includes(p), `${r.key} ${p}`).toBe(r.key === "owner" || roleCan(r.key, p));
    }
    expect(roles.find((r) => r.key === "client")?.workspaceScoped).toBe(true);
    // Session permissions match the old fixed matrix.
    await signIn(ids.analyst);
    const analyst = (await getSessionUser())!;
    expect(analyst.roleName).toBe("Analyst");
    expect(analyst.can("reports.export")).toBe(true);
    expect(analyst.can("workspace.settings")).toBe(false);
    expect(analyst.can("roles.manage")).toBe(false);
  });

  it("every permission appears once in the role editor's catalogue", () => {
    const listed = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.permission));
    expect([...listed].sort()).toEqual([...ALL_PERMISSIONS].sort());
    expect(new Set(listed).size).toBe(listed.length);
  });
});

describe("custom roles", () => {
  it("grant exactly their permissions and gate pages with an access-denied state", async () => {
    await signIn(ids.admin);
    const r = await createRoleAction(roleForm("Media buyer", ["page.performance", "page.live", "reports.view"]));
    expect(r.ok).toBe(true);
    const key = String(r.data?.key);
    const buyer = await addMember(key, "buyer@roles.test");
    await signIn(buyer);
    const user = (await getSessionUser())!;
    expect(user.roleName).toBe("Media buyer");
    expect(user.can("page.performance")).toBe(true);
    expect(user.can("reports.view")).toBe(true);
    expect(user.can("page.overview")).toBe(false);
    expect(user.can("page.profit")).toBe(false);
    expect(user.can("reports.export")).toBe(false);
    expect(user.can("members.manage")).toBe(false);
    expect(await gatePage("page.performance")).toBeNull();
    expect(await gatePage("page.profit")).not.toBeNull();
    // Overview is blocked: "home" is their first allowed page, never a redirect loop back to "/".
    expect(firstAllowedPage(user.can).href).toBe("/live");
  });

  it("the Owner role can't be edited or deleted, and the last owner can't be demoted", async () => {
    await signIn(ids.owner);
    expect((await updateRoleAction("owner", roleForm("Owner", ["reports.view"]))).ok).toBe(false);
    expect((await deleteRoleAction("owner", "admin")).ok).toBe(false);
    const f = new FormData();
    f.set("role", "admin");
    expect((await updateMemberAction((await membership(ids.owner)).id, f)).message).toMatch(/at least one owner/);
    expect((await membership(ids.owner)).role).toBe("owner");
  });

  it("nobody can grant permissions beyond their own role", async () => {
    await signIn(ids.admin);
    expect((await createRoleAction(roleForm("Too strong", ["security.manage"]))).ok).toBe(false);
    // An owner-made role with org.manage: admins can't edit it or hand it out.
    await signIn(ids.owner);
    expect((await createRoleAction(roleForm("Co-owner", ["org.manage", "members.manage"]))).ok).toBe(true);
    const coOwner = await roleKey("Co-owner");
    await signIn(ids.admin);
    expect((await updateRoleAction(coOwner, roleForm("Co-owner", ["reports.view"]))).ok).toBe(false);
    const f = new FormData();
    f.set("role", coOwner);
    expect((await updateMemberAction((await membership(ids.viewer)).id, f)).ok).toBe(false);
    const inv = new FormData();
    inv.set("email", "new@roles.test");
    inv.set("role", coOwner);
    expect((await inviteMemberAction(inv)).ok).toBe(false);
    // Pure rule: owners always can; others only a subset of their own permissions.
    const admin = BUILTIN_ROLES.find((r) => r.key === "admin")!;
    expect(canAssign(admin, { ...admin, key: "x", permissions: ["org.manage"] })).toBe(false);
    expect(canAssign(admin, BUILTIN_ROLES.find((r) => r.key === "owner"))).toBe(false);
  });

  it("an edited built-in role applies on the next request", async () => {
    await signIn(ids.admin);
    const viewer = (await listOrgRoles(db, orgId)).find((r) => r.key === "viewer")!;
    const r = await updateRoleAction("viewer", roleForm("Viewer", viewer.permissions.filter((p) => p !== "page.profit")));
    expect(r.ok).toBe(true);
    await signIn(ids.viewer);
    const user = (await getSessionUser())!;
    expect(user.can("page.profit")).toBe(false);
    expect(user.can("page.overview")).toBe(true);
  });

  it("deleting a role in use requires moving its members", async () => {
    await signIn(ids.admin);
    await createRoleAction(roleForm("Temp", ["reports.view", "page.overview"]));
    const key = await roleKey("Temp");
    const temp = await addMember(key, "temp@roles.test");
    expect((await deleteRoleAction(key, null)).ok).toBe(false);
    const r = await deleteRoleAction(key, "viewer");
    expect(r.ok).toBe(true);
    expect((await membership(temp)).role).toBe("viewer");
    expect((await listOrgRoles(db, orgId)).some((x) => x.key === key)).toBe(false);
    // Deleting a built-in works the same way.
    const c = await deleteRoleAction("analyst", "viewer");
    expect(c.ok).toBe(true);
    expect((await membership(ids.analyst)).role).toBe("viewer");
    expect((await listOrgRoles(db, orgId)).some((x) => x.key === "analyst")).toBe(false);
  });

  it("a workspace-scoped custom role is limited to the workspaces picked for each member", async () => {
    const [other] = await db.insert(schema.workspaces).values({ organizationId: orgId, name: "Brand B", slug: `brand-b-${randomToken(3).toLowerCase()}` }).returning();
    await signIn(ids.admin);
    expect((await createRoleAction(roleForm("Brand partner", ["reports.view", "page.overview"], true))).ok).toBe(true);
    const key = await roleKey("Brand partner");
    const partner = await addMember("viewer", "partner@roles.test");
    const f = new FormData();
    f.set("role", key);
    expect((await updateMemberAction((await membership(partner)).id, f)).ok).toBe(false); // needs a workspace
    f.append("workspaceIds", other.id);
    expect((await updateMemberAction((await membership(partner)).id, f)).ok).toBe(true);
    const m = await membership(partner);
    expect(m.workspaceIds).toEqual([other.id]);
    expect((await accessibleWorkspaces(db, orgId, m.workspaceIds)).map((w) => w.name)).toEqual(["Brand B"]);
    // Can't scope a role people already have (each needs their own workspace choice).
    expect((await updateRoleAction("viewer", roleForm("Viewer", ["reports.view"], true))).ok).toBe(false);
  });

  it("an invitation for a deleted role can't be accepted", async () => {
    await signIn(ids.admin);
    await createRoleAction(roleForm("Short lived", ["reports.view"]));
    const key = await roleKey("Short lived");
    const [inv] = await db
      .insert(schema.invitations)
      .values({ organizationId: orgId, email: "late@roles.test", role: key, tokenHash: sha256(randomToken(8)), invitedBy: ids.admin, expiresAt: new Date(Date.now() + 86_400_000) })
      .returning();
    await db.update(schema.orgRoles).set({ deletedAt: new Date() }).where(and(eq(schema.orgRoles.organizationId, orgId), eq(schema.orgRoles.key, key)));
    const [u] = await db.insert(schema.users).values({ email: "late@roles.test", passwordHash: "x" }).returning();
    await expect(db.transaction((tx) => acceptInvitation(tx, inv.id, u.id))).rejects.toBeInstanceOf(InvitationError);
  });
});

describe("navigation filtering", () => {
  it("maps links to page permissions and hides blocked pages", () => {
    expect(pagePermissionFor("/")).toBe("page.overview");
    expect(pagePermissionFor("/performance?level=ad")).toBe("page.performance");
    expect(pagePermissionFor("/receipts/abc")).toBe("page.profit");
    expect(pagePermissionFor("/truth")).toBe("page.profit");
    expect(pagePermissionFor("/settings/account")).toBeNull();
    expect(hrefAllowed("/settings", [])).toBe(true);
    expect(hrefAllowed("/contacts/1", ["page.overview"])).toBe(false);

    const can: PaletteCan = { settings: false, members: false, audit: false, api: false, alerts: false, share: false, data: false, notes: true, editContacts: false, pages: ["page.overview", "page.live"] };
    const visible = NAV.filter((n) => navVisible(n, can)).map((n) => n.href);
    expect(visible).toContain("/");
    expect(visible).toContain("/live");
    expect(visible).not.toContain("/performance");
    expect(visible).not.toContain("/profit");
    expect(visible).toContain("/settings/account");
  });
});
