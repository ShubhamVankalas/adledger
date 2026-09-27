// Client-safe: how Ask result cells read. Used by the server (what the model sees) and the UI
// (what the person sees), so both show exactly the same figures.
import type { AskColumnKind } from "../db/schema";
import { credit, moneyWhole, pct, platformLabel, roas, signedPct } from "../format";

export function formatCell(kind: AskColumnKind, value: string | number | null | undefined, currency: string): string {
  if (value === null || value === undefined || value === "") return "—";
  if (kind === "text" || kind === "date") return String(value);
  if (kind === "platform") return platformLabel(String(value));
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  switch (kind) {
    case "money":
      return moneyWhole(n, currency);
    case "ratio":
      return roas(n);
    case "pct":
      return signedPct(n);
    case "credit":
      return credit(n);
    case "count":
      return Math.round(n).toLocaleString("en-US");
    default:
      return pct(n);
  }
}

/** Numeric columns are right-aligned and tabular. */
export const isNumericKind = (kind: AskColumnKind) => kind !== "text" && kind !== "platform" && kind !== "date";
