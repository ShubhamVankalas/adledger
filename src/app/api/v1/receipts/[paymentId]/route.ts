import { z } from "zod";
import { getDb } from "@/lib/db";
import { json, withAuth } from "@/lib/http";
import { COST_BASES, paymentReceipt } from "@/lib/reports-profit";
import { UUID_RE } from "@/lib/request-auth";

// GET /api/v1/receipts/{paymentId}?model=linear&cost=share|clicks
// The Ad Receipt of one payment or refund: the credited ads (parts sum to the amount), what the
// customer cost, their payback and lifetime revenue. The contact's email is always masked here.

const q = z.object({
  model: z.enum(["first_touch", "last_touch", "linear"]).default("linear"),
  cost: z.enum(COST_BASES as [string, ...string[]]).default("share"),
});

export const GET = withAuth<{ params: Promise<{ paymentId: string }> }>(async (req, ws, { params }) => {
  const { paymentId } = await params;
  if (!UUID_RE.test(paymentId)) return json({ error: "not found" }, 404);
  const o = q.parse(Object.fromEntries(new URL(req.url).searchParams));
  const db = await getDb();
  const r = await paymentReceipt(db, ws, paymentId, o.model, { basis: o.cost === "clicks" ? "clicks" : "share" });
  if (!r) return json({ error: "not found" }, 404);
  return json({ currency: ws.reportingCurrency, timezone: ws.timezone, data: r });
}, { permission: "reports.view" });
