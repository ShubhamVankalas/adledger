"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { fail, guard, ok, run, type ActionResult } from "@/lib/actions";
import { audit } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { findTheme, isDefaultTheme, type OrgTheme } from "@/lib/themes";

/** Organization accent theme (owners/admins). Everyone in the organization sees it on their next render. */
export async function setOrganizationThemeAction(theme: OrgTheme): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("org.branding");
    const kind = theme?.kind === "gradient" ? "gradient" : "solid";
    const option = typeof theme?.id === "string" ? findTheme({ kind, id: theme.id }) : undefined;
    if (!option) return fail("Pick a theme from the list.");
    const value = { kind, id: option.id } satisfies OrgTheme;
    const db = await getDb();
    await db
      .update(schema.organizations)
      .set({ theme: isDefaultTheme(value) ? null : value })
      .where(eq(schema.organizations.id, user.organization.id));
    await audit(user, "organization.theme_updated", user.organization.name, { kind, theme: option.id });
    revalidatePath("/", "layout");
    return ok(isDefaultTheme(value) ? "Theme reset to the default." : `Theme set to ${option.name}.`);
  });
}
