"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { fail, guard, ok, run, str, type ActionResult } from "@/lib/actions";
import { audit } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { createShareLink, DEFAULT_SHARE_EXPIRY_DAYS, normalizeShareFilters, revokeShareLink, SHARE_EXPIRY_DAYS } from "@/lib/share";
import { publicUrl } from "@/lib/url";

// Settings → Sharing. Links are aggregate-only and read-only; the token is returned once.

const MAX_ACTIVE_LINKS = 100;

export async function createShareLinkAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("reports.share");
    const db = await getDb();
    const fixed = str(form, "period") === "custom";
    const filters = normalizeShareFilters({
      range: fixed ? undefined : str(form, "period"),
      start: fixed ? str(form, "start") : undefined,
      end: fixed ? str(form, "end") : undefined,
      model: str(form, "model"),
      platform: str(form, "platform") || undefined,
    });
    const days = Number(str(form, "expires"));
    const expiresInDays = (SHARE_EXPIRY_DAYS as readonly number[]).includes(days) ? days : DEFAULT_SHARE_EXPIRY_DAYS;
    const active = await db.$count(schema.shareLinks, and(eq(schema.shareLinks.workspaceId, user.workspace.id), isNull(schema.shareLinks.revokedAt)));
    if (active >= MAX_ACTIVE_LINKS) return fail(`A workspace can have ${MAX_ACTIVE_LINKS} share links. Revoke old ones first.`);
    const { token, link } = await createShareLink(db, {
      workspaceId: user.workspace.id,
      userId: user.id,
      label: str(form, "label"),
      filters,
      expiresInDays,
    });
    await audit(user, "share_link.create", link.id, { filters, expiresInDays });
    revalidatePath("/settings/workspace/sharing");
    return ok("Share link created. Copy it now: it won’t be shown again.", { id: link.id, url: `${await publicUrl()}/share/${token}` });
  });
}

export async function revokeShareLinkAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("reports.share");
    const db = await getDb();
    const row = await revokeShareLink(db, user.workspace.id, id);
    if (!row) return fail("That link no longer exists.");
    await audit(user, "share_link.revoke", row.id);
    revalidatePath("/settings/workspace/sharing");
    return ok("Link revoked. Anyone opening it now sees “link not found”.");
  });
}
