import { getDb } from "@/lib/db";
import { json, withAuth } from "@/lib/http";
import { journey } from "@/lib/reports";

export const GET = withAuth<{ params: Promise<{ id: string }> }>(async (_req, ws, { params }) => {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "not found" }, 404);
  const db = await getDb();
  const j = await journey(db, ws, id);
  return j ? json(j) : json({ error: "not found" }, 404);
});
