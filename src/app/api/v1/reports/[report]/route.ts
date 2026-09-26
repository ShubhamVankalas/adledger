import { z } from "zod";
import { getDb } from "@/lib/db";
import { json, withAuth } from "@/lib/http";
import { channels, compare, overview, performance, reportParams, timeseries, wastedSpend } from "@/lib/reports";

// GET /api/v1/reports/{overview|performance|timeseries|channels|wasted-spend|compare}
//   ?start=YYYY-MM-DD&end=YYYY-MM-DD&model=first_touch|last_touch|linear[&platform=meta|google][&level=campaign|ad_group|ad]

const levelSchema = z.object({
  level: z.enum(["campaign", "ad_group", "ad"]).default("campaign"),
  parentId: z.string().uuid().optional(),
});

export const GET = withAuth<{ params: Promise<{ report: string }> }>(async (req, ws, { params }) => {
  const { report } = await params;
  const q = Object.fromEntries(new URL(req.url).searchParams);
  const p = reportParams.parse(q);
  const db = await getDb();
  const meta = { start: p.start, end: p.end, model: p.model, currency: ws.reportingCurrency, timezone: ws.timezone };
  switch (report) {
    case "overview":
      return json({ ...meta, data: await overview(db, ws, p) });
    case "performance":
      return json({ ...meta, data: await performance(db, ws, { ...p, ...levelSchema.parse(q) }) });
    case "timeseries":
      return json({ ...meta, data: await timeseries(db, ws, p) });
    case "channels":
      return json({ ...meta, data: await channels(db, ws, p) });
    case "wasted-spend":
      return json({ ...meta, data: await wastedSpend(db, ws, { ...p, level: levelSchema.parse(q).level }) });
    case "compare":
      return json({ ...meta, data: await compare(db, ws, p) });
    default:
      return json({ error: "unknown report" }, 404);
  }
}, { permission: "reports.view" });
