import { getDb } from "@/lib/db";
import { json, withAuth } from "@/lib/http";
import { journey } from "@/lib/reports";
import { canSeePii } from "@/lib/security/pii";

export const GET = withAuth<{ params: Promise<{ id: string }> }>(
  async (_req, ws, { params }, principal) => {
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "not found" }, 404);
    const db = await getDb();
    const j = await journey(db, ws, id, { maskEmail: !canSeePii(principal) });
    return j ? json(j) : json({ error: "not found" }, 404);
  },
  { permission: "reports.view", scope: "contacts:read" },
);
