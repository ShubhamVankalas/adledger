import { audit } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { textStream, workspaceExportJson } from "@/lib/privacy";
import { authorize, downloadName } from "@/lib/request-auth";

// GET /api/v1/exports/workspace — every row this workspace owns, as one streamed JSON
// document (credentials omitted). Dashboard only: owners and admins (workspace.data).
export async function GET(req: Request) {
  const caller = await authorize(req, "workspace.data", { sessionOnly: true });
  if (caller instanceof Response) return caller;
  const db = await getDb();
  await audit(caller.actor, "workspace.exported", caller.workspace.name, { via: caller.via });
  return new Response(textStream(workspaceExportJson(db, caller.workspace)), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${downloadName(caller.workspace, "export", "json")}"`,
      "Cache-Control": "no-store",
    },
  });
}
