import { createHash } from "node:crypto";
import { fromDecimalString } from "../../money";
import { safeEqual, str } from "../revenue/shared";
import type { ConnectionLike, RevenueConnector, RevenueEventInput } from "../types";

// Shared contract + helpers for CRM deal sources (offline / sales-led revenue).
//
// A CRM connector is a RevenueConnector (so the catalog, connect form and `syncProvider`
// backfill pick it up unchanged) plus two webhook helpers. CRM webhooks only carry ids,
// so the dedicated route `/api/v1/webhooks/crm/{provider}/{workspaceId}` verifies the call,
// pulls the deal ids out with `webhookDealIds`, re-reads them with `fetchDeals` and ingests
// whatever is won. `parseWebhook` therefore returns nothing.
//
// Only won deals become revenue (externalId = deal id, so edits to amount/close date update the
// same row). A deal that later moves out of won is ignored: the revenue event stays until it is
// removed by hand, because CRMs reopen deals for paperwork far more often than money is returned.

export interface CrmConnector extends RevenueConnector {
  backfill(conn: ConnectionLike, opts: { sinceMs: number }): Promise<RevenueEventInput[]>;
  /** Deal ids referenced by a (verified) webhook payload that may need re-reading. */
  webhookDealIds(payload: unknown): string[];
  /** Re-read deals by id; returns payments for the ones that are won. */
  fetchDeals(conn: ConnectionLike, ids: string[]): Promise<RevenueEventInput[]>;
}

/** Positive minor units from a CRM amount (string or JSON number), or null when unusable. */
export function dealAmountMinor(v: unknown, currency: string): number | null {
  const s = str(v)?.replace(/,/g, "");
  if (!s) return null;
  try {
    const n = fromDecimalString(s, currency);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function currencyCode(v: unknown): string | null {
  const s = str(v)?.toUpperCase();
  return s && /^[A-Z]{3}$/.test(s) ? s : null;
}

/** ISO timestamp, or Pipedrive v1's "YYYY-MM-DD HH:MM:SS" (UTC, no zone). Null when unparseable. */
export function utcDate(v: unknown): Date | null {
  const s = str(v);
  if (!s) return null;
  const iso = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s) ? `${s.replace(" ", "T")}Z` : s;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Constant-time string comparison that doesn't leak length (both sides hashed first). */
export function safeEqualStrings(a: string, b: string): boolean {
  const h = (x: string) => createHash("sha256").update(x, "utf8").digest();
  return safeEqual(h(a), h(b)) && a.length > 0;
}

export function chunks<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}
