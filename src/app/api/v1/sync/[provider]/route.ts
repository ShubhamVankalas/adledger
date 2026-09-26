import { getDb } from "@/lib/db";
import { json, withAuth } from "@/lib/http";
import { syncProvider } from "@/lib/sync";

export const POST = withAuth<{ params: Promise<{ provider: string }> }>(
  async (_req, ws, { params }) => {
    const { provider } = await params;
    if (provider !== "meta" && provider !== "google_ads" && provider !== "stripe") return json({ error: "unknown provider" }, 404);
    const db = await getDb();
    const result = await syncProvider(db, ws.id, provider);
    return json(result, result.status === "error" ? 502 : 200);
  },
  { permission: "workspace.settings", perMinute: 10 },
);
