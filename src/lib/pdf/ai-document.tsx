import { randomUUID } from "node:crypto";
import { renderToBuffer, Text, View } from "@react-pdf/renderer";
import { schema, type DB } from "../db";
import { factText, formatValue, type DocDataset, type DocRow, type DocumentPack } from "../ai/document-data";
import type { CleanBlock, CleanDocument, GeneratedDocument } from "../ai/document";
import { loadMethodology } from "../report-kinds/methodology";
import { countPdfPages, loadPrintBrand, renderContextFor, reportDataHash, reportFingerprint, type Exporter, type GeneratedReport } from "../report-kinds/render";
import { CONTENT_WIDTH } from "../report-kinds/shared";
import type { ReportRequest } from "../report-kinds/types";
import type { Workspace } from "../settings";
import { ComboChart, Donut, Funnel, HBarChart, BarChart, LineChart, Waterfall, type WaterfallStep } from "./charts";
import { Bullets, Callout, Dot, KpiTile, Legend, s, Table, type Column } from "./components";
import { ReportDocument, type DocumentMeta } from "./document";
import { moneyShort, safeText, shortDate } from "./format";
import { CATEGORICAL, PDF_COLORS as C, TYPE, type PdfTheme } from "./theme";

// Draws an AI document (src/lib/ai/document.ts) with the same frame, components and charts as
// the built-in reports. The model's structure decides the order and the words; every KPI, table
// cell and chart value is read from the data pack (SQL), never from the model.

export const AI_DOCUMENT_KIND = "ai-document";

export const AI_DOCUMENT_META: DocumentMeta = {
  id: AI_DOCUMENT_KIND,
  title: "AI document",
  description: "A custom document written by the workspace's AI model from AdLedger figures.",
  orientation: "portrait",
  length: "custom",
  usesModel: true,
};

const W = CONTENT_WIDTH.portrait;

const metricColor = (key: string) => (/spend|cost|cac|cpl/.test(key) ? C.spend : /lead/.test(key) ? C.leads : /customer|reached|count/.test(key) ? C.customers : C.revenue);
const num = (v: string | number | null | undefined) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? 0 : Number(v));

function DocTable({ d, block, currency }: { d: DocDataset; block: Extract<CleanBlock, { type: "table" }>; currency: string }) {
  const cols = block.columns.map((k) => d.columns.find((c) => c.key === k)).filter((c): c is NonNullable<typeof c> => Boolean(c));
  const columns: Column<DocRow>[] = cols.map((c, i) => ({
    header: c.label,
    flex: i === 0 ? 2.3 : 1,
    align: i === 0 ? "left" : "right",
    cell: (r) => formatValue(c.kind, r[c.key], currency),
  }));
  return <Table columns={columns} rows={d.rows} limit={block.limit} moreNoun={d.noun} dense={block.limit > 12} />;
}

function DocChart({ d, block, currency }: { d: DocDataset; block: Extract<CleanBlock, { type: "chart" }>; currency: string }) {
  const label = d.columns[0];
  const metric = d.columns.find((c) => c.key === block.metric) ?? d.columns[1];
  const fmt = (v: number) => formatValue(metric.kind, v, currency);
  const short = (v: number) => (metric.kind === "money" ? moneyShort(v, currency) : fmt(v));
  const labelText = (r: DocRow) => (label.kind === "date" ? shortDate(String(r[label.key])) : formatValue(label.kind, r[label.key], currency));
  const values = d.rows.map((r) => num(r[metric.key]));

  switch (block.chart) {
    case "combo": {
      const spend = d.rows.map((r) => num(r.spend));
      const rev = d.rows.map((r) => num(r.revenue));
      return (
        <View>
          <View style={{ marginBottom: 6 }}>
            <Legend items={[{ label: "Ad spend", color: C.spend, box: true }, { label: "Revenue", color: C.revenue }]} />
          </View>
          <ComboChart width={W} height={130} labels={d.rows.map(labelText)} bars={{ values: spend, color: C.spend }} line={{ values: rev, color: C.revenue }} yFormat={short} />
        </View>
      );
    }
    case "line":
      return <LineChart width={W} height={130} labels={d.rows.map(labelText)} series={[{ values, color: metricColor(metric.key), area: true }]} yFormat={short} />;
    case "donut": {
      const rows = d.rows.slice(0, 8);
      const total = rows.reduce((sum, r) => sum + Math.max(0, num(r[metric.key])), 0);
      const color = (i: number, r: DocRow) => (r[label.key] === "unattributed" ? C.borderStrong : CATEGORICAL[i % CATEGORICAL.length]);
      return (
        <View style={{ flexDirection: "row", gap: 16, alignItems: "center" }} wrap={false}>
          <Donut size={104} slices={rows.map((r, i) => ({ value: Math.max(0, num(r[metric.key])), color: color(i, r) }))} centerValue={short(total)} centerLabel={metric.label.toLowerCase()} />
          <View style={{ flex: 1, gap: 4 }}>
            {rows.map((r, i) => (
              <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Dot color={color(i, r)} />
                <Text style={{ fontSize: TYPE.caption, color: C.fg, flex: 1 }}>{safeText(labelText(r), 48)}</Text>
                <Text style={{ fontSize: TYPE.caption, color: C.fgMuted }}>{fmt(num(r[metric.key]))}</Text>
              </View>
            ))}
          </View>
        </View>
      );
    }
    case "funnel":
      return <Funnel width={W} steps={d.rows.map((r) => ({ label: safeText(labelText(r), 28), value: num(r[metric.key]) }))} format={fmt} color={C.customers} rowHeight={22} />;
    case "waterfall": {
      const steps: WaterfallStep[] = d.rows.map((r, i) => ({ label: safeText(labelText(r), 16), value: num(r[metric.key]), kind: i === 0 || i === d.rows.length - 1 ? "total" : "delta" }));
      return <Waterfall width={W} height={150} steps={steps} yFormat={short} />;
    }
    default: {
      if (label.kind === "date") {
        return <BarChart width={W} height={120} categories={d.rows.map(labelText)} series={[{ name: metric.label, values, color: metricColor(metric.key) }]} yFormat={short} />;
      }
      const rows = d.rows.slice(0, 10);
      return <HBarChart width={W} rows={rows.map((r) => ({ label: labelText(r), value: num(r[metric.key]), color: num(r[metric.key]) < 0 ? C.negative : metricColor(metric.key) }))} format={fmt} labelWidth={180} />;
    }
  }
}

function KpiRow({ ids, pack }: { ids: string[]; pack: DocumentPack }) {
  const facts = ids.map((id) => pack.facts.find((f) => f.id === id)).filter((f): f is NonNullable<typeof f> => Boolean(f));
  const perRow = Math.min(4, facts.length);
  const w = (W - 8 * (perRow - 1)) / perRow;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {facts.map((f) => {
        const t = factText(f, pack.currency);
        return <KpiTile key={f.id} width={w} label={f.label} value={t.value} cur={f.value} prev={f.previous === null ? undefined : f.previous} prevLabel={t.previous ?? undefined} polarity={f.polarity} />;
      })}
    </View>
  );
}

function Block({ block, pack }: { block: CleanBlock; pack: DocumentPack }) {
  const dataset = (id: string) => pack.datasets.find((d) => d.id === id);
  switch (block.type) {
    case "paragraph":
      return <Text style={{ ...s.body, lineHeight: 1.55 }}>{block.text}</Text>;
    case "bullets":
      return <Bullets items={block.items} />;
    case "kpi_row":
      return <KpiRow ids={block.facts} pack={pack} />;
    case "callout":
      return (
        <Callout tone={block.tone} title={block.title}>
          {block.text ? <Text style={{ fontSize: TYPE.ui, color: C.fg, lineHeight: 1.5 }}>{block.text}</Text> : ""}
        </Callout>
      );
    case "table":
    case "chart": {
      const d = dataset(block.dataset);
      if (!d) return null;
      return (
        <View>
          {block.type === "table" ? <DocTable d={d} block={block} currency={pack.currency} /> : <DocChart d={d} block={block} currency={pack.currency} />}
          <Text style={{ fontSize: TYPE.micro + 0.5, color: C.fgMuted, marginTop: 4 }}>{block.caption ? `${block.caption} · ` : ""}{`Source: ${d.title.toLowerCase()}, ${pack.period.label}`}</Text>
        </View>
      );
    }
  }
}

export function AiDocumentBody({ doc, pack, theme }: { doc: CleanDocument; pack: DocumentPack; theme: PdfTheme }) {
  return (
    <View>
      {doc.summary ? (
        <View style={{ backgroundColor: C.bgSubtle, borderRadius: 6, paddingVertical: 10, paddingHorizontal: 12, marginTop: 10, borderLeftWidth: 2.5, borderColor: theme.brand }} wrap={false}>
          <Text style={{ ...s.eyebrow, marginBottom: 4 }}>Summary</Text>
          <Text style={{ fontSize: TYPE.body, color: C.fg, lineHeight: 1.55 }}>{doc.summary}</Text>
        </View>
      ) : null}
      {doc.sections.map((sec, i) => (
        <View key={i} style={{ marginTop: 18 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 8 }} minPresenceAhead={80}>
            <View style={{ width: 3, height: 11, borderRadius: 1, backgroundColor: theme.brand }} />
            <Text style={s.h2}>{sec.heading}</Text>
          </View>
          <View style={{ gap: 10 }}>
            {sec.blocks.map((b, j) => (
              <Block key={j} block={b} pack={pack} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "document";

/** Render an AI document to PDF and write its export_log row (ids and parameters only). */
export async function generateAiDocumentPdf(db: DB, ws: Workspace, gen: GeneratedDocument, exporter: Exporter, opts: { now?: Date } = {}): Promise<GeneratedReport & { title: string }> {
  const req: ReportRequest = { start: gen.request.start, end: gen.request.end, model: gen.request.model, compare: "previous" };
  const [methodology, brand] = await Promise.all([loadMethodology(db, ws, req), loadPrintBrand(db, ws)]);
  const issuedAt = opts.now ?? new Date();
  const exportId = randomUUID();
  const data = { document: gen.document, pack: gen.pack, modelName: gen.modelName };
  const dataHash = reportDataHash(AI_DOCUMENT_KIND, req, data);
  const fingerprint = reportFingerprint({ exportId, dataHash, exporter, issuedAt });
  const ctx = renderContextFor(ws, brand, exporter, { issuedAt, exportId, fingerprint });
  const pdf = await renderToBuffer(
    <ReportDocument
      meta={AI_DOCUMENT_META}
      ctx={ctx}
      methodology={methodology}
      frame={{
        cover: { title: gen.document.title, subtitle: gen.document.subtitle },
        sourceNote: `KPI tiles, tables and charts are computed by SQL from this AdLedger ledger. The text was written by an AI model (${safeText(gen.modelName, 60)}) from those figures; any sentence with a number that isn't in them was removed before printing.`,
      }}
    >
      <AiDocumentBody doc={gen.document} pack={gen.pack} theme={ctx.theme} />
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
    reportKind: AI_DOCUMENT_KIND,
    params: { start: req.start, end: req.end, model: req.model, compare: req.compare, template: gen.request.templateId ?? "custom" },
    fingerprint,
    dataHash,
    bytes: pdf.byteLength,
    pages,
    recipients: null,
    status: "ok",
    createdAt: issuedAt,
  });
  const wsSlug = ws.slug.replace(/[^a-z0-9-]/gi, "").slice(0, 40) || "workspace";
  return { pdf, exportId, fingerprint, dataHash, pages, filename: `adledger-${wsSlug}-${slug(gen.document.title)}-${req.start}-to-${req.end}.pdf`, data, title: gen.document.title };
}
