import { audit } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { contactsCsv, textStream } from "@/lib/privacy";
import { authorize, downloadName } from "@/lib/request-auth";

// GET /api/v1/exports/contacts?q=&lifecycle=lead|customer — the Contacts page's current
// filter as CSV. Session (reports.export) or API key.
export async function GET(req: Request) {
  const caller = await authorize(req, "reports.export");
  if (caller instanceof Response) return caller;
  const sp = new URL(req.url).searchParams;
  const search = (sp.get("q") ?? sp.get("search") ?? "").slice(0, 200);
  const lc = sp.get("lifecycle");
  const lifecycle = lc === "lead" || lc === "customer" ? lc : undefined;
  const db = await getDb();
  await audit(caller.actor, "contacts.exported", null, { via: caller.via, filtered: Boolean(search || lifecycle) });
  return new Response(textStream(contactsCsv(db, caller.workspace, { search, lifecycle })), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${downloadName(caller.workspace, "contacts", "csv")}"`,
      "Cache-Control": "no-store",
    },
  });
}
