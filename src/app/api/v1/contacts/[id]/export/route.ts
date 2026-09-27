import { audit } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { json } from "@/lib/http";
import { exportContact } from "@/lib/privacy";
import { authorize, downloadName, UUID_RE } from "@/lib/request-auth";

// GET /api/v1/contacts/{id}/export — subject-access request: everything stored about one
// contact as JSON, raw email included. A session with export.contacts (owners, admins) or an API
// key with the contacts:pii scope.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = await authorize(req, "export.contacts", { scope: "contacts:pii" });
  if (caller instanceof Response) return caller;
  const { id } = await params;
  if (!UUID_RE.test(id)) return json({ error: "not found" }, 404);
  const db = await getDb();
  const data = await exportContact(db, caller.workspace, id);
  if (!data) return json({ error: "not found" }, 404);
  await audit(caller.actor, "contact.exported", id, { via: caller.via });
  return json(data, {
    headers: {
      "Content-Disposition": `attachment; filename="${downloadName(caller.workspace, `contact-${id.slice(0, 8)}`, "json")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
