import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it } from "vitest";
import { acceptInvitation, accessibleWorkspaces, createOrganizationWithOwner, findInvitation } from "@/lib/auth";
import { sha256 } from "@/lib/crypto";
import { getDb, schema } from "@/lib/db";
import { canAssignRole, roleCan } from "@/lib/permissions";

describe("roles", () => {
  it("grants the documented permissions", () => {
    expect(roleCan("owner", "org.manage")).toBe(true);
    expect(roleCan("admin", "org.manage")).toBe(false);
    expect(roleCan("admin", "members.manage")).toBe(true);
    expect(roleCan("analyst", "workspace.settings")).toBe(false);
    expect(roleCan("analyst", "reports.export")).toBe(true);
    expect(roleCan("viewer", "reports.export")).toBe(false);
    expect(roleCan("client", "reports.view")).toBe(true);
    expect(roleCan("client", "apikeys.manage")).toBe(false);
  });
  it("only owners can hand out or change the owner role", () => {
    expect(canAssignRole("owner", "owner")).toBe(true);
    expect(canAssignRole("admin", "owner")).toBe(false);
    expect(canAssignRole("admin", "client")).toBe(true);
    expect(canAssignRole("analyst", "viewer")).toBe(false);
  });
});

describe("organizations, workspaces and invitations", () => {
  it("creates an organization with an owner and restricts clients to their workspaces", async () => {
    const db = await getDb();
    const { organization, workspace, user } = await createOrganizationWithOwner(db, {
      organizationName: "Growth Agency",
      email: "Owner@Agency.test",
      password: "correct-horse-battery",
      name: "Olive",
    });
    expect(user.email).toBe("owner@agency.test");
    const [m] = await db.select().from(schema.memberships).where(eq(schema.memberships.userId, user.id));
    expect(m.role).toBe("owner");

    const [clientWs] = await db
      .insert(schema.workspaces)
      .values({ organizationId: organization.id, name: "Client B", slug: "client-b-x1" })
      .returning();
    const all = await accessibleWorkspaces(db, organization.id, null);
    expect(all.map((w) => w.id).sort()).toEqual([workspace.id, clientWs.id].sort());

    // Invite a client limited to Client B.
    const token = "invite-token-for-tests-123";
    const [inv] = await db
      .insert(schema.invitations)
      .values({ organizationId: organization.id, email: "client@brand.test", role: "client", workspaceIds: [clientWs.id], tokenHash: sha256(token), expiresAt: new Date(Date.now() + 86_400_000) })
      .returning();
    expect((await findInvitation(token))?.invitation.id).toBe(inv.id);
    expect(await findInvitation("wrong-token")).toBeNull();

    const [clientUser] = await db.insert(schema.users).values({ email: "client@brand.test", passwordHash: "x" }).returning();
    const firstWs = await db.transaction((tx) => acceptInvitation(tx, inv.id, clientUser.id));
    expect(firstWs).toBe(clientWs.id);
    const [cm] = await db.select().from(schema.memberships).where(eq(schema.memberships.userId, clientUser.id));
    expect(cm.role).toBe("client");
    const visible = await accessibleWorkspaces(db, organization.id, cm.workspaceIds);
    expect(visible.map((w) => w.name)).toEqual(["Client B"]);
    // Used invitations can't be reused.
    expect(await findInvitation(token)).toBeNull();
  });
});

describe("upgrading a v0.1 database", () => {
  it("turns each old workspace into an organization and each admin into its owner", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "adledger-mig-"));
    const v1 = path.join(dir, "v1");
    cpSync("drizzle", v1, { recursive: true });
    const journal = JSON.parse(readFileSync(path.join(v1, "meta", "_journal.json"), "utf8"));
    journal.entries = journal.entries.slice(0, 1);
    writeFileSync(path.join(v1, "meta", "_journal.json"), JSON.stringify(journal));

    const client = new PGlite();
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: v1 });
    await client.exec(`
      insert into workspaces (id, name, slug) values ('11111111-1111-1111-1111-111111111111', 'Old Shop', 'old-shop');
      insert into users (id, workspace_id, email, password_hash, role)
        values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'admin@old.test', 'x', 'admin');
    `);
    await migrate(db, { migrationsFolder: "drizzle" });
    const orgs = await client.query<{ id: string; name: string }>("select id, name from organizations");
    expect(orgs.rows).toEqual([{ id: "11111111-1111-1111-1111-111111111111", name: "Old Shop" }]);
    const ms = await client.query<{ role: string; user_id: string }>("select role, user_id from memberships");
    expect(ms.rows).toEqual([{ role: "owner", user_id: "22222222-2222-2222-2222-222222222222" }]);
    const ws = await client.query<{ organization_id: string }>("select organization_id from workspaces");
    expect(ws.rows[0].organization_id).toBe("11111111-1111-1111-1111-111111111111");
    await client.close();
  });
});
