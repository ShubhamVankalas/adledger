"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { fail, guard, ok, run, type ActionResult } from "@/lib/actions";
import { audit } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { pdfLogoBytes, validateImageUpload, validatePngCopy } from "@/lib/media";

// Profile pictures (any signed-in member, for themselves) and organization logos (owners/admins).

export async function setAvatarAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await guard();
    const image = await validateImageUpload(form.get("file"));
    if (!image.ok) return fail(image.message);
    const db = await getDb();
    await db.update(schema.users).set({ avatar: image.bytes, avatarType: image.type, avatarUpdatedAt: new Date() }).where(eq(schema.users.id, user.id));
    await audit(user, "account.avatar_updated", null, { type: image.type, bytes: image.bytes.byteLength });
    revalidatePath("/", "layout");
    return ok("Profile picture updated.");
  });
}

export async function removeAvatarAction(): Promise<ActionResult> {
  return run(async () => {
    const user = await guard();
    const db = await getDb();
    await db.update(schema.users).set({ avatar: null, avatarType: null, avatarUpdatedAt: null }).where(eq(schema.users.id, user.id));
    await audit(user, "account.avatar_removed", null);
    revalidatePath("/", "layout");
    return ok("Profile picture removed.");
  });
}

export async function setOrganizationLogoAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("org.branding");
    const image = await validateImageUpload(form.get("file"));
    if (!image.ok) return fail(image.message);
    // PNG copy for PDF reports (react-pdf embeds only PNG/JPEG).
    const logoPng = pdfLogoBytes(await validatePngCopy(form.get("png")), image.bytes, image.type);
    const db = await getDb();
    await db
      .update(schema.organizations)
      .set({ logo: image.bytes, logoType: image.type, logoPng, logoUpdatedAt: new Date() })
      .where(eq(schema.organizations.id, user.organization.id));
    await audit(user, "organization.logo_updated", user.organization.name, { type: image.type, bytes: image.bytes.byteLength });
    revalidatePath("/", "layout");
    return ok("Logo updated.");
  });
}

export async function removeOrganizationLogoAction(): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("org.branding");
    const db = await getDb();
    await db.update(schema.organizations).set({ logo: null, logoType: null, logoPng: null, logoUpdatedAt: null }).where(eq(schema.organizations.id, user.organization.id));
    await audit(user, "organization.logo_removed", user.organization.name);
    revalidatePath("/", "layout");
    return ok("Logo removed.");
  });
}
