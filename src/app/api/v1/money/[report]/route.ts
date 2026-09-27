import { z } from "zod";
import { getDb } from "@/lib/db";
import { json, withAuth } from "@/lib/http";
import { reportParams } from "@/lib/reports";
import { acquisitionLedger, COST_BASES, getUnitEconomics, pauseDrafts, profitLedger, profitRows, timeToMoney } from "@/lib/reports-profit";
import { truthGap } from "@/lib/reports-trust";

// GET /api/v1/money/{truth-gap|profit|time-to-money|acquisition}
//   ?start=YYYY-MM-DD&end=YYYY-MM-DD&model=first_touch|last_touch|linear[&platform=meta|google…]
//   profit: [&level=platform|campaign|ad] · acquisition: [&cost=share|clicks]
// Money-truth reports: platform claims vs verified payments, the P&L with POAS, payback lag with
// the "too early" rule and pause drafts, and the spend = customer costs + unallocated ledger.

const extra = z.object({
  level: z.enum(["platform", "campaign", "ad"]).default("campaign"),
  cost: z.enum(COST_BASES as [string, ...string[]]).default("share"),
});

export const GET = withAuth<{ params: Promise<{ report: string }> }>(async (req, ws, { params }) => {
  const { report } = await params;
  const q = Object.fromEntries(new URL(req.url).searchParams);
  const p = reportParams.parse({ model: "linear", ...q });
  const x = extra.parse(q);
  const db = await getDb();
  const meta = { start: p.start, end: p.end, model: p.model, currency: ws.reportingCurrency, timezone: ws.timezone };
  switch (report) {
    case "truth-gap":
      return json({ ...meta, data: await truthGap(db, ws, p) });
    case "profit": {
      const ue = await getUnitEconomics(db, ws.id);
      const [ledger, rows] = await Promise.all([profitLedger(db, ws, p, ue), profitRows(db, ws, p, x.level, ue)]);
      return json({ ...meta, data: { ledger, level: x.level, rows } });
    }
    case "time-to-money": {
      // Lag is measured as of `end`; pause drafts judge the period [start, end].
      const lags = await timeToMoney(db, ws, { asOf: p.end });
      return json({ ...meta, data: { ...lags, pauseDrafts: await pauseDrafts(db, ws, p, { lags }) } });
    }
    case "acquisition": {
      const l = await acquisitionLedger(db, ws, p, x.cost === "clicks" ? "clicks" : "share");
      // Per-contact costs are keyed by id only (no names or emails here); cap the list.
      return json({ ...meta, data: { ...l, contacts: l.contacts.slice(0, 500) } });
    }
    default:
      return json({ error: "unknown report" }, 404);
  }
}, { permission: "reports.view" });
