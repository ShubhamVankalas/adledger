"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, guard, ok, run, str, type ActionResult } from "@/lib/actions";
import { audit, createInvitation, ownerCount, slugify } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { sendEmail } from "@/lib/notify/channels/email";
import { canAssign, findRoleDef } from "@/lib/permissions";
import { listOrgRoles } from "@/lib/roles";
import { getConnection } from "@/lib/settings";
import { publicUrl } from "@/lib/url";

// Organization-level actions: members, invitations, workspaces.

export async function inviteMemberAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("members.manage");
    const email = str(form, "email").toLowerCase();
    if (!z.email().safeParse(email).success) return fail("Enter a valid email address.");
    const db = await getDb();
    const roles = await listOrgRoles(db, user.organization.id);
    const target = findRoleDef(roles, str(form, "role"));
    if (!target) return fail("Pick a role.");
    if (!canAssign(user.roleDef, target)) return fail(target.key === "owner" ? "Only owners can invite other owners." : "You can only give a role with permissions you have yourself.");
    const workspaceIds = form.getAll("workspaceIds").map(String).filter((id) => user.workspaces.some((w) => w.id === id));
    if (target.workspaceScoped && workspaceIds.length === 0) return fail("Choose at least one workspace this person can see.");
    const [already] = await db
      .select({ id: schema.memberships.id })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(and(eq(schema.memberships.organizationId, user.organization.id), eq(schema.users.email, email)));
    if (already) return fail("That person is already a member. Change their role in the list instead.");

    const { token } = await createInvitation(user, { email, role: target.key, workspaceIds: target.workspaceScoped ? workspaceIds : null });
    const link = `${await publicUrl()}/invite/${token}`;
    await audit(user, "member.invited", email, { role: target.key });

    // Email the invite when an email channel (or SMTP_URL) is configured; the link is always returned to copy.
    let emailed = false;
    const emailConn = await getConnection(user.workspace.id, "notify_email", db);
    if (emailConn || process.env.SMTP_URL) {
      try {
        await sendEmail({
          to: email,
          subject: `${user.name || user.email} invited you to ${user.organization.name} on AdLedger`,
          conn: emailConn ?? undefined,
          msg: {
            title: `Join ${user.organization.name} on AdLedger`,
            text: `${user.name || user.email} invited you as **${target.name}**.\n\nAdLedger shows which ads actually make money. The invitation expires in 7 days.`,
            severity: "info",
            url: link,
          },
        });
        emailed = true;
      } catch {
        emailed = false;
      }
    }
    revalidatePath("/settings", "layout");
    return ok(emailed ? `Invitation emailed to ${email}.` : "Invitation created. Copy the link and send it to them.", { link });
  });
}

export async function revokeInvitationAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("members.manage");
    const db = await getDb();
    await db.delete(schema.invitations).where(and(eq(schema.invitations.id, id), eq(schema.invitations.organizationId, user.organization.id)));
    await audit(user, "member.invite_revoked", id);
    revalidatePath("/settings", "layout");
    return ok("Invitation revoked.");
  });
}

export async function updateMemberAction(membershipId: string, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("members.manage");
    const db = await getDb();
    const roles = await listOrgRoles(db, user.organization.id);
    const target = findRoleDef(roles, str(form, "role"));
    if (!target) return fail("Pick a role.");
    const [m] = await db
      .select()
      .from(schema.memberships)
      .where(and(eq(schema.memberships.id, membershipId), eq(schema.memberships.organizationId, user.organization.id)));
    if (!m) return fail("Member not found.");
    const current = findRoleDef(roles, m.role);
    if (m.role === "owner" && !canAssign(user.roleDef, current)) return fail("Only owners can change an owner's role.");
    if (!canAssign(user.roleDef, target) || (current && !canAssign(user.roleDef, current))) {
      return fail(target.key === "owner" ? "Only owners can make someone an owner." : "You can only give a role with permissions you have yourself.");
    }
    if (m.role === "owner" && target.key !== "owner" && (await ownerCount(user.organization.id, m.userId)) === 0) {
      return fail("The organization needs at least one owner. Make someone else an owner first.");
    }
    const workspaceIds = form.getAll("workspaceIds").map(String).filter((id) => user.workspaces.some((w) => w.id === id));
    if (target.workspaceScoped && workspaceIds.length === 0) return fail("Choose at least one workspace this person can see.");
    await db
      .update(schema.memberships)
      .set({ role: target.key, workspaceIds: target.workspaceScoped ? workspaceIds : null })
      .where(eq(schema.memberships.id, m.id));
    await audit(user, "member.updated", m.userId, { role: target.key });
    revalidatePath("/settings", "layout");
    return ok("Access updated.");
  });
}

export async function removeMemberAction(membershipId: string): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("members.manage");
    const db = await getDb();
    const [m] = await db
      .select()
      .from(schema.memberships)
      .where(and(eq(schema.memberships.id, membershipId), eq(schema.memberships.organizationId, user.organization.id)));
    if (!m) return fail("Member not found.");
    if (m.userId === user.id) return fail("You can't remove yourself. Ask another owner or admin.");
    const current = findRoleDef(await listOrgRoles(db, user.organization.id), m.role);
    // A member whose role was deleted (no definition) can always be removed.
    if (current && !canAssign(user.roleDef, current)) return fail(m.role === "owner" ? "Only owners can remove an owner." : "You can only remove members whose role has permissions you have yourself.");
    if (m.role === "owner" && (await ownerCount(user.organization.id, m.userId)) === 0) return fail("The organization needs at least one owner.");
    await db.delete(schema.memberships).where(eq(schema.memberships.id, m.id));
    // Sign them out of this organization's workspaces.
    const wsIds = user.workspaces.map((w) => w.id);
    for (const wsId of wsIds) {
      await db.delete(schema.sessions).where(and(eq(schema.sessions.userId, m.userId), eq(schema.sessions.workspaceId, wsId)));
    }
    await audit(user, "member.removed", m.userId);
    revalidatePath("/settings", "layout");
    return ok("Member removed.");
  });
}

export async function updateOrganizationAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("org.manage");
    const name = str(form, "name");
    if (!name) return fail("Enter a name.");
    const db = await getDb();
    await db.update(schema.organizations).set({ name: name.slice(0, 80) }).where(eq(schema.organizations.id, user.organization.id));
    await audit(user, "organization.updated", name);
    revalidatePath("/", "layout");
    return ok("Organization saved.");
  });
}

const newWorkspace = z.object({
  name: z.string().trim().min(1, "Enter a name").max(80),
  reportingCurrency: z.string().regex(/^[A-Z]{3}$/),
  timezone: z.string().min(1).max(64),
});

export async function createWorkspaceAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("workspaces.manage");
    const parsed = newWorkspace.safeParse(Object.fromEntries(form));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid workspace");
    const db = await getDb();
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ organizationId: user.organization.id, name: parsed.data.name, slug: slugify(parsed.data.name), reportingCurrency: parsed.data.reportingCurrency, timezone: parsed.data.timezone })
      .returning();
    // Switch the creator into the new workspace.
    await db.update(schema.sessions).set({ workspaceId: ws.id }).where(eq(schema.sessions.id, user.sessionId));
    await audit(user, "workspace.created", ws.name);
    revalidatePath("/", "layout");
    return ok(`Workspace “${ws.name}” created.`, { id: ws.id });
  });
}

export async function deleteWorkspaceAction(workspaceId: string, confirmName: string): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("org.manage");
    const target = user.workspaces.find((w) => w.id === workspaceId);
    if (!target) return fail("Workspace not found.");
    if (confirmName.trim() !== target.name) return fail("Type the workspace name exactly to confirm.");
    if (user.workspaces.length <= 1) return fail("You can't delete the only workspace.");
    const db = await getDb();
    const fallback = user.workspaces.find((w) => w.id !== workspaceId)!;
    // Move sessions that point at it, then delete (cascades to all its data).
    await db.update(schema.sessions).set({ workspaceId: fallback.id }).where(eq(schema.sessions.workspaceId, workspaceId));
    await db.delete(schema.workspaces).where(and(eq(schema.workspaces.id, workspaceId), eq(schema.workspaces.organizationId, user.organization.id)));
    await audit(user, "workspace.deleted", target.name);
    revalidatePath("/", "layout");
    return ok(`Workspace “${target.name}” and all its data were deleted.`);
  });
}
