import type { ReactElement } from "react";
import { z } from "zod";
import type { DB } from "../db";
import type { AttributionModel } from "../db/schema";
import type { PdfTheme } from "../pdf/theme";
import type { Workspace } from "../settings";

// A report kind declares its metadata, the sections it prints, how to load its data (only
// through src/lib/reports*.ts, so every number comes from SQL) and how to draw that data.
// The loaded object (ReportData) is what gets fingerprinted: web, PDF and tests read the
// exact same numbers.

export const REPORT_KIND_IDS = ["executive-summary", "weekly-performance", "attribution-models", "ltv-cohorts", "wasted-spend"] as const;
export type ReportKindId = (typeof REPORT_KIND_IDS)[number];

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Query parameters of a report request: GET /api/v1/reports/{kind}/pdf?start&end&model&compare */
export const reportRequestSchema = z
  .object({
    start: z.string().regex(DATE),
    end: z.string().regex(DATE),
    model: z.enum(["first_touch", "last_touch", "linear"]).default("linear"),
    compare: z.enum(["previous", "none"]).default("previous"),
  })
  .refine((p) => p.start <= p.end, { message: "start must be on or before end", path: ["start"] })
  .refine((p) => (Date.parse(`${p.end}T00:00:00Z`) - Date.parse(`${p.start}T00:00:00Z`)) / 86_400_000 <= 731, {
    message: "a report covers at most two years",
    path: ["end"],
  });
export type ReportRequest = z.infer<typeof reportRequestSchema>;

export type SyncInfo = { provider: string; label: string; mode: "mock" | "live"; lastSyncedAt: string | null; failing: boolean };

/** Printed on every report's methodology appendix. */
export type Methodology = {
  model: AttributionModel;
  windowDays: number;
  timezone: string;
  currency: string;
  start: string;
  end: string;
  compareStart: string | null;
  compareEnd: string | null;
  revenueMinor: number;
  unattributedRevenueMinor: number;
  unattributedShare: number | null;
  /** Currency exclusions ("Revenue in EUR is excluded…"). */
  exclusions: string[];
  syncs: SyncInfo[];
  pixel: { events24h: number; lastEventAt: string | null };
};

export type ReportMeta = {
  id: ReportKindId;
  title: string;
  /** One line for the gallery card. */
  description: string;
  audience: string;
  orientation: "portrait" | "landscape";
  /** "1 page", "2–3 pages". */
  length: string;
  sections: string[];
  /** Range the gallery suggests for this kind. */
  defaultDays: 7 | 30 | 90 | 180;
  /** False when the report shows all models side by side (the model picker is hidden). */
  usesModel: boolean;
  /** True when the report compares against the previous period (otherwise `compare` is ignored). */
  usesCompare: boolean;
};

/** Everything the drawing needs besides the data. */
export type RenderContext = {
  workspaceName: string;
  organizationName: string;
  /** PNG/JPEG logo bytes, or null for the wordmark. */
  logo: Uint8Array | null;
  theme: PdfTheme;
  /** Who the export was made for (member name, API key name or "Scheduled delivery"). */
  preparedFor: string;
  issuedAt: Date;
  /** Issue date, formatted in the workspace timezone ("27 Sep 2026"). */
  issuedOn: string;
  fingerprint: string;
  exportId: string;
  /** Absolute /verify URL when PUBLIC_URL is set. */
  verifyUrl: string | null;
};

export type ReportData<D> = D & { methodology: Methodology };

export interface ReportKind<D extends object = object> {
  meta: ReportMeta;
  load(db: DB, ws: Workspace, req: ReportRequest): Promise<ReportData<D>>;
  /** Report body (react-pdf elements) placed after the cover block on a wrapping page. */
  Body: (props: { data: ReportData<D>; ctx: RenderContext }) => ReactElement;
}

/** Helper that keeps the data type of a kind while storing it in a heterogeneous registry. */
export const defineReportKind = <D extends object>(k: ReportKind<D>) => k as unknown as ReportKind<object>;
