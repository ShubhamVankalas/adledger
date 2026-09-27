import { audit, requestContext } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { contactsCsv, textStream } from "@/lib/privacy";
import { authorize, downloadName } from "@/lib/request-auth";

// GET /api/v1/exports/contacts?q=&lifecycle=lead|customer — the Contacts page's current filter
// as CSV. Sessions need export.csv; API keys need contacts:read. Emails are raw only for members
// with export.contacts (owners, admins) and keys with contacts:pii; everyone else gets them masked.
// The audit entry (with the row count) is written when the download finishes; more than 1,000
// rows raises a security alert.
export async function GET(req: Request) {
  const auth = await authorize(req, "export.csv", { scope: "contacts:read" });
  if (auth instanceof Response) return auth;
  const caller = auth;
  const sp = new URL(req.url).searchParams;
  const search = (sp.get("q") ?? sp.get("search") ?? "").slice(0, 200);
  const lc = sp.get("lifecycle");
  const lifecycle = lc === "lead" || lc === "customer" ? lc : undefined;
  const masked = !caller.can("export.contacts");
  const db = await getDb();
  const counter = { rows: 0 };
  const context = await requestContext();
  async function* logged() {
    let complete = false;
    try {
      yield* contactsCsv(db, caller.workspace, { search, lifecycle }, { maskEmails: masked, counter });
      complete = true;
    } finally {
      await audit(caller.actor, "contacts.exported", null, { via: caller.via, filtered: Boolean(search || lifecycle), rows: counter.rows, masked, complete }, context);
    }
  }
  return new Response(textStream(logged()), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${downloadName(caller.workspace, masked ? "contacts-masked" : "contacts", "csv")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
