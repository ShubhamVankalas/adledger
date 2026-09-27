import { getDb } from "@/lib/db";
import { json, withAuth } from "@/lib/http";
import { livePulse } from "@/lib/reports-live";

// GET /api/v1/live/pulse — today's net revenue (reporting currency, local day so far) and
// visitors on the site in the last 5 minutes. Cheap enough to poll; powers the sidebar pulse.
export const dynamic = "force-dynamic";

export const GET = withAuth(
  async (_req, ws) => {
    const db = await getDb();
    const pulse = await livePulse(db, ws);
    return json({ ...pulse, asOf: new Date().toISOString() }, { headers: { "Cache-Control": "private, no-store" } });
  },
  // One tab polls every 30s; leave room for many tabs and a status-bar widget or two.
  { permission: "reports.view", perMinute: 240 },
);
