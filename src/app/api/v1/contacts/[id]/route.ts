import { audit } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { json } from "@/lib/http";
import { eraseContact } from "@/lib/privacy";
import { authorize, UUID_RE } from "@/lib/request-auth";

// DELETE /api/v1/contacts/{id} — right to erasure. Deletes the contact and its leads, unlinks
// its visitors, keeps its revenue anonymously (as unattributed).
// A session with workspace.data (owners/admins) or an API key with the ingest:write scope.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = await authorize(req, "workspace.data", { scope: "ingest:write" });
  if (caller instanceof Response) return caller;
  const { id } = await params;
  if (!UUID_RE.test(id)) return json({ error: "not found" }, 404);
  const db = await getDb();
  const result = await eraseContact(db, caller.workspace.id, id);
  if (!result) return json({ error: "not found" }, 404);
  await audit(caller.actor, "contact.erased", id, { via: caller.via, ...result });
  return json({ deleted: true, id, ...result });
}
