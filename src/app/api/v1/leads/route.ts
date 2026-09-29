import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { json, withAuth } from "@/lib/http";
import { UUID_RE } from "@/lib/request-auth";
import { canSeePii, maskEmail } from "@/lib/security/pii";

const q = z.object({
  since: z.iso.datetime({ offset: true }).optional(),
  until: z.iso.datetime({ offset: true }).optional(),
  source: z.enum(["pixel", "webhook", "api", "csv"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(200).optional(),
});

type Cursor = { at: string; id: string };

const encodeCursor = (c: Cursor) => Buffer.from(JSON.stringify([c.at, c.id])).toString("base64url");

function decodeCursor(raw: string): Cursor | null {
  try {
    const [at, id] = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as [string, string];
    return typeof at === "string" && !Number.isNaN(Date.parse(at)) && UUID_RE.test(id) ? { at, id } : null;
  } catch {
    return null;
  }
}

// GET /api/v1/leads — every lead (form fill, lead ad, WhatsApp chat, API/CSV lead), newest first,
// with cursor pagination: pass `next_cursor` back as `cursor` until it is null. Emails are masked
// unless the key has contacts:pii (or the member's role may see contact PII).
export const GET = withAuth(
  async (req, ws, _ctx, principal) => {
    const params = q.parse(Object.fromEntries(new URL(req.url).searchParams));
    const cursor = params.cursor ? decodeCursor(params.cursor) : null;
    if (params.cursor && !cursor) return json({ error: "invalid parameters", hint: "`cursor` must be a next_cursor value from a previous page." }, 400);
    const pii = canSeePii(principal);
    const l = schema.leads;
    const c = schema.contacts;
    const db = await getDb();
    const rows = await db
      .select({
        id: l.id,
        occurredAt: l.occurredAt,
        source: l.source,
        formName: l.formName,
        contactId: c.id,
        name: c.name,
        email: c.email,
        lifecycle: c.lifecycle,
      })
      .from(l)
      .innerJoin(c, eq(c.id, l.contactId))
      .where(
        and(
          eq(l.workspaceId, ws.id),
          params.since ? gte(l.occurredAt, new Date(params.since)) : undefined,
          params.until ? lt(l.occurredAt, new Date(params.until)) : undefined,
          params.source ? eq(l.source, params.source) : undefined,
          // Keyset: strictly after the last row of the previous page (ms precision, like the cursor).
          cursor ? sql`(date_trunc('milliseconds', ${l.occurredAt}), ${l.id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)` : undefined,
        ),
      )
      .orderBy(sql`date_trunc('milliseconds', ${l.occurredAt}) desc`, desc(l.id))
      .limit(params.limit + 1);
    const page = rows.slice(0, params.limit);
    const last = page.at(-1);
    return json({
      rows: page.map((r) => ({
        id: r.id,
        occurredAt: r.occurredAt.toISOString(),
        source: r.source,
        formName: r.formName,
        contact: { id: r.contactId, name: r.name, email: pii ? r.email : maskEmail(r.email), lifecycle: r.lifecycle },
      })),
      next_cursor: rows.length > params.limit && last ? encodeCursor({ at: last.occurredAt.toISOString(), id: last.id }) : null,
      emailsMasked: !pii,
    });
  },
  { permission: "reports.view", scope: "contacts:read" },
);
