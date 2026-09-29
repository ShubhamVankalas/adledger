import { randomUUID } from "node:crypto";
import { renderToBuffer } from "@react-pdf/renderer";
import { eq } from "drizzle-orm";
import { sha256 } from "../crypto";
import { schema, type DB } from "../db";
import { pdfLogoBytes } from "../media";
import { ReportDocument } from "../pdf/document";
import { longDate } from "../pdf/format";
import { orgPrintAccent } from "../pdf/brand";
import { pdfTheme, type PdfTheme } from "../pdf/theme";
import type { Workspace } from "../settings";
import { getReportKind } from "./index";
import type { RenderContext, ReportKindId, ReportMeta, ReportRequest } from "./types";

// load → fingerprint → render → export_log. One function for downloads, API calls and
// scheduled runs, so every PDF that leaves the instance is logged the same way.

export type Exporter =
  | { via: "session"; userId: string; name: string }
  | { via: "api_key"; apiKeyId: string | null; name: string }
  | { via: "schedule"; scheduleId: string; name: string };

export type GeneratedReport = {
  pdf: Buffer;
  exportId: string;
  fingerprint: string;
  dataHash: string;
  pages: number;
  filename: string;
  /** The ReportData the PDF was drawn from (every number came from reports*.ts). */
  data: object;
};

/** Pages in a PDF produced by react-pdf (pdfkit writes one `/Type /Page` object per page). */
export function countPdfPages(pdf: Buffer): number {
  return pdf.toString("latin1").match(/\/Type\s*\/Page(?![s\w])/g)?.length ?? 0;
}

/** Stable, compact JSON for hashing (object keys sorted). */
export function stableJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  return `{${Object.keys(v as Record<string, unknown>)
    .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}

export function reportDataHash(kind: string, req: ReportRequest, data: object): string {
  return sha256(stableJson({ kind, params: req, data }));
}

export function reportFingerprint(input: { exportId: string; dataHash: string; exporter: Exporter; issuedAt: Date }): string {
  const who = input.exporter.via === "session" ? input.exporter.userId : input.exporter.via === "api_key" ? (input.exporter.apiKeyId ?? "key") : input.exporter.scheduleId;
  return sha256(`adledger-report:v1|${input.exportId}|${input.dataHash}|${input.exporter.via}:${who}|${input.issuedAt.toISOString()}`);
}

/** Calendar date of `d` in the workspace timezone, printed like the rest of the report. */
export const issuedOn = (d: Date, tz: string) => {
  try {
    return longDate(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d));
  } catch {
    return longDate(d.toISOString().slice(0, 10));
  }
};

export function reportFilename(ws: Workspace, kind: string, req: ReportRequest) {
  const slug = ws.slug.replace(/[^a-z0-9-]/gi, "").slice(0, 40) || "workspace";
  return `adledger-${slug}-${kind}-${req.start}-to-${req.end}.pdf`;
}

export class UnknownReportKind extends Error {}

export type PrintBrand = { organizationName: string; logo: Uint8Array | null; theme: PdfTheme };

/** The organization's name, logo and accent colour as printed on every PDF. */
export async function loadPrintBrand(db: DB, ws: Workspace): Promise<PrintBrand> {
  const [org] = await db
    .select({ name: schema.organizations.name, logoPng: schema.organizations.logoPng, logo: schema.organizations.logo, logoType: schema.organizations.logoType, theme: schema.organizations.theme })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, ws.organizationId));
  // react-pdf reads PNG/JPEG only: the PNG copy made at upload, else the original when it is
  // already PNG/JPEG. Older WebP-only logos fall back to the org-name wordmark until re-uploaded.
  const logo = pdfLogoBytes(org?.logoPng ?? null, org?.logo ?? null, org?.logoType ?? null);
  return { organizationName: org?.name ?? ws.name, logo: logo ? new Uint8Array(logo) : null, theme: pdfTheme(orgPrintAccent(org?.theme ?? null)) };
}

/** Everything the page frame needs besides the data (shared by report kinds and AI documents). */
export function renderContextFor(ws: Workspace, brand: PrintBrand, exporter: Exporter, ids: { issuedAt: Date; exportId: string; fingerprint: string }): RenderContext {
  const base = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
  return {
    workspaceName: ws.name,
    organizationName: brand.organizationName,
    logo: brand.logo,
    theme: brand.theme,
    preparedFor: exporter.name,
    issuedAt: ids.issuedAt,
    issuedOn: issuedOn(ids.issuedAt, ws.timezone),
    fingerprint: ids.fingerprint,
    exportId: ids.exportId,
    verifyUrl: base ? `${base}/verify` : null,
  };
}

/** Drop parameters a kind ignores, so the fingerprint and export log describe what was printed. */
export function normalizeRequest(meta: ReportMeta, req: ReportRequest): ReportRequest {
  return { start: req.start, end: req.end, model: req.model, compare: meta.usesCompare ? req.compare : "none" };
}

export async function generateReportPdf(
  db: DB,
  ws: Workspace,
  kindId: ReportKindId | string,
  req: ReportRequest,
  exporter: Exporter,
  opts: { now?: Date; recipients?: number } = {},
): Promise<GeneratedReport> {
  const kind = getReportKind(kindId);
  if (!kind) throw new UnknownReportKind(`Unknown report: ${kindId}`);
  req = normalizeRequest(kind.meta, req);
  const [data, brand] = await Promise.all([kind.load(db, ws, req), loadPrintBrand(db, ws)]);

  const issuedAt = opts.now ?? new Date();
  const exportId = randomUUID();
  const dataHash = reportDataHash(kind.meta.id, req, data);
  const fingerprint = reportFingerprint({ exportId, dataHash, exporter, issuedAt });
  const ctx = renderContextFor(ws, brand, exporter, { issuedAt, exportId, fingerprint });
  const Body = kind.Body;
  const pdf = await renderToBuffer(
    <ReportDocument meta={kind.meta} ctx={ctx} methodology={data.methodology}>
      <Body data={data} ctx={ctx} />
    </ReportDocument>,
  );
  const pages = countPdfPages(pdf);
  await db.insert(schema.exportLog).values({
    id: exportId,
    workspaceId: ws.id,
    userId: exporter.via === "session" ? exporter.userId : null,
    apiKeyId: exporter.via === "api_key" ? exporter.apiKeyId : null,
    scheduleId: exporter.via === "schedule" ? exporter.scheduleId : null,
    via: exporter.via,
    format: "pdf",
    reportKind: kind.meta.id,
    params: { start: req.start, end: req.end, model: req.model, compare: req.compare },
    fingerprint,
    dataHash,
    bytes: pdf.byteLength,
    pages,
    recipients: opts.recipients ?? null,
    status: "ok",
    createdAt: issuedAt,
  });
  return { pdf, exportId, fingerprint, dataHash, pages, filename: reportFilename(ws, kind.meta.id, req), data };
}
