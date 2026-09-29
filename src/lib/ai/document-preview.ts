import { factText, formatValue, type DocDataset, type DocumentPack } from "./document-data";
import type { CleanBlock, CleanDocument } from "./document";
import type { ChartType } from "./document-schema";

// A browser-friendly copy of an AI document for the in-app preview: every value already
// formatted (from the same pack the PDF is drawn from), charts reduced to bars or a line.
// The dashboard's CSP blocks plugin content (object-src 'none'), so the preview is plain HTML
// rather than an embedded PDF.

export type PreviewBar = { label: string; value: string; share: number; negative: boolean };
export type PreviewBlock =
  | { type: "paragraph"; text: string }
  | { type: "bullets"; items: string[] }
  | { type: "callout"; tone: "neutral" | "positive" | "warning" | "negative"; title: string; text: string }
  | { type: "kpis"; items: { label: string; value: string; change: string | null; good: boolean | null }[] }
  | { type: "table"; source: string; columns: { label: string; numeric: boolean }[]; rows: string[][]; more: number; caption: string | null }
  | { type: "chart"; source: string; chart: ChartType; metric: string; bars: PreviewBar[]; lines: { label: string; points: number[] }[]; caption: string | null };

export type DocumentPreview = { title: string; subtitle: string | null; summary: string; period: string; sections: { heading: string; blocks: PreviewBlock[] }[] };

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number.isFinite(Number(v)) && v !== null ? Number(v) : 0);

function normalize(values: number[]): number[] {
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  return values.map((v) => Math.round(((v - min) / span) * 1000) / 1000);
}

function chartPreview(d: DocDataset, block: Extract<CleanBlock, { type: "chart" }>, currency: string): PreviewBlock {
  const label = d.columns[0];
  const metric = d.columns.find((c) => c.key === block.metric) ?? d.columns[1];
  const base = { type: "chart" as const, source: d.title, chart: block.chart, metric: metric.label, caption: block.caption };
  if (label.kind === "date") {
    const keys = block.chart === "combo" ? ["spend", "revenue"] : [metric.key];
    return { ...base, bars: [], lines: keys.map((k) => ({ label: d.columns.find((c) => c.key === k)?.label ?? k, points: normalize(d.rows.map((r) => num(r[k]))) })) };
  }
  const rows = d.rows.slice(0, 10);
  const max = Math.max(1e-9, ...rows.map((r) => Math.abs(num(r[metric.key]))));
  return {
    ...base,
    lines: [],
    bars: rows.map((r) => ({
      label: formatValue(label.kind, r[label.key], currency),
      value: formatValue(metric.kind, r[metric.key], currency),
      share: Math.round((Math.abs(num(r[metric.key])) / max) * 1000) / 1000,
      negative: num(r[metric.key]) < 0,
    })),
  };
}

export function previewDocument(doc: CleanDocument, pack: DocumentPack): DocumentPreview {
  const datasets = new Map(pack.datasets.map((d) => [d.id, d]));
  const block = (b: CleanBlock): PreviewBlock | null => {
    switch (b.type) {
      case "paragraph":
      case "bullets":
      case "callout":
        return b;
      case "kpi_row":
        return {
          type: "kpis",
          items: b.facts
            .map((id) => pack.facts.find((f) => f.id === id))
            .filter((f): f is NonNullable<typeof f> => Boolean(f))
            .map((f) => {
              const t = factText(f, pack.currency);
              const up = f.value !== null && f.previous !== null ? f.value > f.previous : null;
              return { label: f.label, value: t.value, change: t.change, good: up === null || f.polarity === "neutral" || t.change === "0%" ? null : f.polarity === "up" ? up : !up };
            }),
        };
      case "table": {
        const d = datasets.get(b.dataset);
        if (!d) return null;
        const cols = b.columns.map((k) => d.columns.find((c) => c.key === k)).filter((c): c is NonNullable<typeof c> => Boolean(c));
        const shown = d.rows.slice(0, b.limit);
        return {
          type: "table",
          source: d.title,
          columns: cols.map((c, i) => ({ label: c.label, numeric: i > 0 })),
          rows: shown.map((r) => cols.map((c) => formatValue(c.kind, r[c.key], pack.currency))),
          more: d.rows.length - shown.length,
          caption: b.caption,
        };
      }
      case "chart": {
        const d = datasets.get(b.dataset);
        return d ? chartPreview(d, b, pack.currency) : null;
      }
    }
  };
  return {
    title: doc.title,
    subtitle: doc.subtitle,
    summary: doc.summary,
    period: pack.period.label,
    sections: doc.sections.map((s) => ({ heading: s.heading, blocks: s.blocks.map(block).filter((x): x is PreviewBlock => x !== null) })),
  };
}
