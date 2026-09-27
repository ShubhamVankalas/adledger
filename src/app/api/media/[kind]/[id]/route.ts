import { and, eq, or, sql } from "drizzle-orm";
import { authenticatePrincipal } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { MEDIA_TYPES } from "@/lib/media";
import { UUID_RE } from "@/lib/request-auth";

// GET /api/media/user/<id> and /api/media/org/<id> — profile pictures and organization logos
// for the dashboard. Session only (not part of the public REST API): a member can see the
// pictures of people they share an organization with, and the logos of their organizations.
// Anything else is a 404, so ids can't be probed.

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

export async function GET(req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if ((kind !== "user" && kind !== "org") || !UUID_RE.test(id)) return notFound();
  const principal = await authenticatePrincipal(req);
  if (!principal || principal.kind !== "session") return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
  const me = principal.user.id;
  const db = await getDb();

  let image: { bytes: Uint8Array | null; type: string | null } | undefined;
  if (kind === "user") {
    [image] = await db
      .select({ bytes: schema.users.avatar, type: schema.users.avatarType })
      .from(schema.users)
      .where(
        and(
          eq(schema.users.id, id),
          or(
            eq(schema.users.id, me),
            sql`exists (select 1 from ${schema.memberships} a join ${schema.memberships} b on a.organization_id = b.organization_id
                        where a.user_id = ${schema.users.id} and b.user_id = ${me})`,
          ),
        ),
      );
  } else {
    [image] = await db
      .select({ bytes: schema.organizations.logo, type: schema.organizations.logoType })
      .from(schema.organizations)
      .innerJoin(schema.memberships, and(eq(schema.memberships.organizationId, schema.organizations.id), eq(schema.memberships.userId, me)))
      .where(eq(schema.organizations.id, id));
  }
  if (!image?.bytes || !image.type || !(MEDIA_TYPES as readonly string[]).includes(image.type)) return notFound();

  // URLs carry ?v=<updated-at>, so a replaced image gets a new URL and old ones can be cached for long.
  const versioned = new URL(req.url).searchParams.has("v");
  return new Response(Buffer.from(image.bytes), {
    headers: {
      "Content-Type": image.type,
      "Content-Length": String(image.bytes.byteLength),
      "Cache-Control": versioned ? "private, max-age=31536000, immutable" : "private, no-cache",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
