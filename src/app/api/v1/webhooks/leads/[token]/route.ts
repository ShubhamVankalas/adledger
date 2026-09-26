import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { clientIp, json, rateLimit } from "@/lib/http";
import { requestAttribution } from "@/lib/jobs";
import { extractTraits, linkVisitor, recordLead, upsertContact } from "@/lib/tracking/identity";

// Generic lead webhook for form tools (Typeform, Tally, Webflow, Zapier, custom forms).
// Accepts JSON or form-encoded bodies; email/phone/name are auto-detected or mapped.

async function readBody(req: Request): Promise<Record<string, unknown>> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
    const form = await req.formData();
    return Object.fromEntries([...form.entries()].map(([k, v]) => [k, typeof v === "string" ? v : v.name]));
  }
  const text = await req.text();
  try {
    return JSON.parse(text || "{}");
  } catch {
    return Object.fromEntries(new URLSearchParams(text));
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!rateLimit(`leadhook:${clientIp(req)}`, 120)) return json({ error: "rate limited" }, 429);
  const db = await getDb();
  const [hook] = await db.select().from(schema.leadWebhooks).where(eq(schema.leadWebhooks.token, token));
  if (!hook) return json({ error: "unknown webhook" }, 404);

  const body = await readBody(req);
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
  return json({ ok: true, ...result }, 201);
}
