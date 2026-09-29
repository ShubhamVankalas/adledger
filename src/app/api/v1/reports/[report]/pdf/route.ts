import { eq } from "drizzle-orm";
import { audit, authenticatePrincipal } from "@/lib/auth";
import { sha256 } from "@/lib/crypto";
import { getDb, schema } from "@/lib/db";
import { json, rateLimit } from "@/lib/http";
import { log } from "@/lib/log";
import { Busy, pdfLimiter } from "@/lib/pdf/limiter";
import { resolvePeriodParams } from "@/lib/period";
import { getReportKind, REPORT_KIND_IDS, reportRequestSchema } from "@/lib/report-kinds";
import { generateReportPdf, type Exporter } from "@/lib/report-kinds/render";

// GET /api/v1/reports/{kind}/pdf?start=YYYY-MM-DD&end=YYYY-MM-DD&model=linear|first_touch|last_touch&compare=previous|none
//
// Branded PDF of one report kind (see src/lib/report-kinds). Dashboard sessions need the
// `reports.pdf` permission; API keys hold the workspace's read API (the `reports:read` scope once
// key scopes land). Without start/end the kind's default range ending on the latest day with data
// is used. Every download is written to export_log and the audit log (ids only).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(req: Request, { params }: { params: Promise<{ report: string }> }) {
  const { report } = await params;
  const kind = getReportKind(report);
  if (!kind) return json({ error: "unknown report", hint: `One of: ${REPORT_KIND_IDS.join(", ")}.` }, { status: 404, headers: NO_STORE });

  const principal = await authenticatePrincipal(req);
  if (!principal) return json({ error: "unauthorized", hint: "Send `Authorization: Bearer al_...` (create a key in Settings → API keys)." }, { status: 401, headers: NO_STORE });
  if (principal.kind === "session" && !principal.user.can("reports.pdf")) {
    return json({ error: "forbidden", hint: "Your role can't download PDF reports. Ask an admin." }, { status: 403, headers: NO_STORE });
  }
  // Downloads render and log an export: a cross-site link or form must not trigger one with the
  // visitor's cookie. (Plain GETs without Sec-Fetch-Site, e.g. curl with a cookie, still work.)
  const site = req.headers.get("sec-fetch-site");
  if (principal.kind === "session" && site && site !== "same-origin" && site !== "none") {
    return json({ error: "cross-site request blocked" }, { status: 403, headers: NO_STORE });
  }
  const ws = principal.workspace;
  if (!rateLimit(`pdf:${ws.id}`, 30)) return json({ error: "rate limited", hint: "Slow down and retry in a minute." }, { status: 429, headers: { ...NO_STORE, "Retry-After": "60" } });

  const db = await getDb();
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  let query: Record<string, string | undefined> = sp;
  if (!sp.start && !sp.end) {
    const d = await resolvePeriodParams(db, ws, { range: `${kind.meta.defaultDays}d` });
    query = { ...sp, start: d.start, end: d.end };
  }
  const parsed = reportRequestSchema.safeParse(query);
  if (!parsed.success) return json({ error: "invalid parameters", details: parsed.error.issues }, { status: 400, headers: NO_STORE });

  let exporter: Exporter;
  if (principal.kind === "session") {
    exporter = { via: "session", userId: principal.user.id, name: principal.user.name?.trim() || `${principal.user.organization.name} member` };
  } else {
    const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1]?.trim() ?? "";
    const [key] = await db.select({ id: schema.apiKeys.id, name: schema.apiKeys.name }).from(schema.apiKeys).where(eq(schema.apiKeys.keyHash, sha256(bearer)));
    exporter = { via: "api_key", apiKeyId: key?.id ?? null, name: key ? `API key “${key.name}”` : "API key" };
  }

  let out: Awaited<ReturnType<typeof generateReportPdf>>;
  try {
    out = await pdfLimiter.run(() => generateReportPdf(db, ws, kind.meta.id, parsed.data, exporter));
  } catch (err) {
    if (err instanceof Busy) return json({ error: "busy", hint: "Other reports are rendering. Try again in a few seconds." }, { status: 429, headers: { ...NO_STORE, "Retry-After": "10" } });
    log.error(`pdf report ${kind.meta.id} failed`, err);
    return json({ error: "report failed", hint: "Check the server logs." }, { status: 500, headers: NO_STORE });
  }

  const actor = principal.kind === "session" ? principal.user : { id: null, organizationId: ws.organizationId, workspaceId: ws.id };
  await audit(actor, "report.pdf_exported", kind.meta.id, { exportId: out.exportId, via: exporter.via, start: parsed.data.start, end: parsed.data.end });

  return new Response(new Uint8Array(out.pdf), {
    status: 200,
    headers: {
      ...NO_STORE,
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${out.filename}"`,
      "Content-Length": String(out.pdf.byteLength),
      "X-Export-Id": out.exportId,
      "X-Report-Fingerprint": out.fingerprint,
    },
  });
}
