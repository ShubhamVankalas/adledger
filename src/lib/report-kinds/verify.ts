import { sql } from "drizzle-orm";
import { rows, type DB } from "../db";
import { REPORT_CATALOG, isReportKindId } from "./catalog";

// /verify: confirm that a PDF's fingerprint was issued by this instance. Reveals only what the
// document already shows on its cover (report kind, workspace, period, issue date): never the
// numbers, the person who exported it, or anything else from the ledger.

/** Shortest fingerprint prefix we look up (64 bits: unguessable, and printed on every page). */
export const MIN_FINGERPRINT_CHARS = 16;

export type VerifyResult =
  | { status: "empty" }
  | { status: "invalid" }
  | { status: "not_found" }
  | { status: "ambiguous" }
  | {
      status: "found";
      report: { kind: string; title: string; workspace: string; start: string | null; end: string | null; issuedAt: string; scheduled: boolean };
    };

/** Lowercase hex only ("7F3A 9c21-e04b…" → "7f3a9c21e04b…"). */
export const normalizeFingerprint = (input: string) => input.toLowerCase().replace(/[^0-9a-f]/g, "");

export async function lookupFingerprint(db: DB, input: string | null | undefined): Promise<VerifyResult> {
  const raw = (input ?? "").trim();
  if (!raw) return { status: "empty" };
  const fp = normalizeFingerprint(raw).slice(0, 64);
  if (fp.length < MIN_FINGERPRINT_CHARS || /[^0-9a-f\s-]/i.test(raw.replace(/[·.…]/g, ""))) return { status: "invalid" };
  const found = rows<{ report_kind: string; params: Record<string, string> | string; created_at: string | Date; via: string; name: string }>(
    await db.execute(sql`
      select e.report_kind, e.params, e.created_at, e.via, w.name
      from export_log e join workspaces w on w.id = e.workspace_id
      where e.status = 'ok' and e.fingerprint like ${`${fp}%`}
      order by e.created_at desc
      limit 2`),
  );
  if (found.length === 0) return { status: "not_found" };
  if (found.length > 1) return { status: "ambiguous" };
  const r = found[0];
  const params = typeof r.params === "string" ? (JSON.parse(r.params) as Record<string, string>) : r.params;
  const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  return {
    status: "found",
    report: {
      kind: r.report_kind,
      title: isReportKindId(r.report_kind) ? REPORT_CATALOG[r.report_kind].title : "Report",
      workspace: r.name,
      start: date(params?.start),
      end: date(params?.end),
      issuedAt: new Date(r.created_at).toISOString(),
      scheduled: r.via === "schedule",
    },
  };
}
