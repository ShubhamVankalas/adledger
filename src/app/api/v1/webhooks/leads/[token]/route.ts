import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { BodyTooLargeError, clientIp, json, rateLimit, readBytesLimited } from "@/lib/http";
import { requestAttribution } from "@/lib/jobs";
import { nudgeLive } from "@/lib/live";
import { extractTraits, linkVisitor, recordLead, upsertContact } from "@/lib/tracking/identity";

// Generic lead webhook for form tools (Typeform, Tally, Webflow, Zapier, custom forms).
// Accepts JSON or form-encoded bodies; email/phone/name are auto-detected or mapped.

const MAX_BODY_BYTES = 256 * 1024;

async function readBody(req: Request): Promise<Record<string, unknown>> {
  const type = req.headers.get("content-type") ?? "";
  const bytes = await readBytesLimited(req, MAX_BODY_BYTES);
  if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
    const form = await new Response(new Uint8Array(bytes), { headers: { "content-type": type } }).formData();
    return Object.fromEntries([...form.entries()].map(([k, v]) => [k, typeof v === "string" ? v : v.name]));
  }
  const text = bytes.toString("utf8");
  try {
    const parsed = JSON.parse(text || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return Object.fromEntries(new URLSearchParams(text));
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!rateLimit(`leadhook:${clientIp(req)}`, 120)) return json({ error: "rate limited" }, 429);
  if (typeof token !== "string" || !/^lw_[A-Za-z0-9_-]{1,64}$/.test(token)) return json({ error: "unknown webhook" }, 404);
  const db = await getDb();
  const [hook] = await db.select().from(schema.leadWebhooks).where(eq(schema.leadWebhooks.token, token));
  if (!hook) return json({ error: "unknown webhook" }, 404);

  if (!rateLimit(`leadhook-token:${hook.id}`, 300)) return json({ error: "rate limited" }, 429);
  let body: Record<string, unknown>;
  try {
    body = await readBody(req);
  } catch (err) {
    if (err instanceof BodyTooLargeError) return json({ error: "payload too large" }, 413);
    return json({ error: "could not read the request body" }, 400);
  }
  const traits = extractTraits(body, hook.fieldMapping);
  if (!traits.email && !traits.phone) {
    return json({ error: "no email or phone found in payload", hint: "Map fields in Settings → Lead webhooks." }, 422);
  }
  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const contact = await upsertContact(tx, hook.workspaceId, traits, now);
    if (!contact) return null;
    if (traits.vid) {
      const [v] = await tx
        .select()
        .from(schema.visitors)
        .where(and(eq(schema.visitors.workspaceId, hook.workspaceId), eq(schema.visitors.anonymousId, traits.vid)));
      if (v) await linkVisitor(tx, v.id, contact.id);
    }
    const formName =
      (typeof body.form_name === "string" && body.form_name) ||
      (typeof (body.form_response as { definition?: { title?: string } })?.definition?.title === "string"
        ? (body.form_response as { definition: { title: string } }).definition.title
        : null) ||
      hook.name;
    const lead = await recordLead(tx, { workspaceId: hook.workspaceId, contactId: contact.id, source: "webhook", formName, occurredAt: now, raw: body });
    return { contactId: contact.id, leadId: lead.id };
  });
  if (!result) return json({ error: "could not create contact" }, 422);
  await requestAttribution(hook.workspaceId);
  nudgeLive(hook.workspaceId);
  return json({ ok: true, ...result }, 201);
}
