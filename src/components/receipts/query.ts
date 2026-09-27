import type { AttributionModel } from "@/lib/db/schema";
import type { CostBasis } from "@/lib/reports-profit";

/** Query string for a receipt link, leaving out the defaults (linear, share of spend). */
export function receiptQuery(model: AttributionModel, basis: CostBasis) {
  const q = new URLSearchParams();
  if (model !== "linear") q.set("model", model);
  if (basis !== "share") q.set("cost", basis);
  const s = q.toString();
  return s ? `?${s}` : "";
}
