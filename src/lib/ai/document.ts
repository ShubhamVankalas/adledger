import { generateText, Output, type LanguageModel } from "ai";
import type { DB } from "../db";
import { safeText } from "../pdf/format";
import type { Workspace } from "../settings";
import { buildDocumentPack, factText, formatValue, packForModel, type DocumentPack } from "./document-data";
import { DOCUMENT_SYSTEM_PROMPT, documentUserPrompt, getDocumentTemplate } from "./document-prompts";
import { aiDocumentSchema, DOC_LIMITS, type AiDocument, type ChartType, type DocumentBlock, type DocumentRequest } from "./document-schema";
import { numberChecker } from "./numbers";
import { getLlmConfig, languageModel, type LlmConfig } from "./report";

// AI documents: the connected model writes a structured document (document-schema.ts) that
// points at facts and datasets from the data pack; sanitizeDocument() then drops unknown ids,
// trims everything to size and deletes any sentence with a number that isn't in the pack.
// Rendering (src/lib/pdf/ai-document.tsx) draws every KPI, table and chart from SQL results.

export type DocumentIssue =
  | { kind: "unverified_number"; where: string; numbers: string[]; removed: string }
  | { kind: "unknown_reference"; where: string; id: string }
  | { kind: "adjusted_chart"; where: string; requested: string; used: string }
  | { kind: "trimmed"; where: string };

/** A validated block with everything resolved (ids exist, chart types fit their dataset). */
export type CleanBlock =
  | { type: "paragraph"; text: string }
  | { type: "bullets"; items: string[] }
  | { type: "kpi_row"; facts: string[] }
  | { type: "table"; dataset: string; columns: string[]; limit: number; caption: string | null }
  | { type: "chart"; dataset: string; chart: ChartType; metric: string; caption: string | null }
  | { type: "callout"; tone: "neutral" | "positive" | "warning" | "negative"; title: string; text: string };

export type CleanDocument = { title: string; subtitle: string | null; summary: string; sections: { heading: string; blocks: CleanBlock[] }[] };

export type GeneratedDocument = {
  document: CleanDocument;
  issues: DocumentIssue[];
  pack: DocumentPack;
  modelName: string;
  request: DocumentRequest;
};

export class NoModelConfigured extends Error {
  constructor() {
    super("Connect an AI model in Settings → AI model to write documents.");
  }
}
export class DocumentGenerationFailed extends Error {}

// ---------------------------------------------------------------- sanitizing

// A sentence ends at . ! or ? followed by whitespace or the end; "3.25×" and "$1.2K" don't end one.
const SENTENCE = /(?:[^.!?]|[.!?](?!\s|$))+(?:[.!?]+(?=\s|$)|$)/g;

/** Split prose into sentences, keeping their punctuation. */
export function sentences(text: string): string[] {
  return (text.match(SENTENCE) ?? []).map((s) => s.trim()).filter(Boolean);
}

type Checker = (text: string) => string[];

/** Remove every sentence with an unverified number. Returns the kept text and what was removed. */
export function guardProse(text: string, check: Checker, max: number): { text: string; removed: { sentence: string; numbers: string[] }[] } {
  const clean = safeText(text, 4000);
  const removed: { sentence: string; numbers: string[] }[] = [];
  const kept: string[] = [];
  for (const s of sentences(clean)) {
    const bad = check(s);
    if (bad.length) removed.push({ sentence: s, numbers: bad });
    else kept.push(s);
  }
  return { text: safeText(kept.join(" "), max), removed };
}

const trimTo = (v: string | null | undefined, max: number) => (v ? safeText(v, max) : "");

/**
 * Validate a model's document against the pack: known ids only, charts the dataset supports,
 * bounded sizes, and prose numbers that appear in the pack (or the person's own request).
 */
export function sanitizeDocument(raw: AiDocument, pack: DocumentPack, request: string, fallbackTitle = "Performance report"): { document: CleanDocument; issues: DocumentIssue[] } {
  const check = numberChecker({ pack: packForModel(pack), request });
  const issues: DocumentIssue[] = [];
  const facts = new Set(pack.facts.map((f) => f.id));
  const datasets = new Map(pack.datasets.map((d) => [d.id, d]));

  const prose = (text: string, max: number, where: string) => {
    const g = guardProse(text, check, max);
    for (const r of g.removed) issues.push({ kind: "unverified_number", where, numbers: r.numbers, removed: r.sentence });
    return g.text;
  };
  const line = (text: string | null | undefined, max: number, where: string, fallback: string) => {
    const t = trimTo(text, max);
    if (!t) return fallback;
    const bad = check(t);
    if (!bad.length) return t;
    issues.push({ kind: "unverified_number", where, numbers: bad, removed: t });
    return fallback;
  };

  const title = line(raw.title, DOC_LIMITS.title, "title", fallbackTitle);
  const subtitleRaw = raw.subtitle ? line(raw.subtitle, DOC_LIMITS.subtitle, "subtitle", "") : "";
  const summary = prose(raw.summary ?? "", DOC_LIMITS.summary, "summary");

  const sections: CleanDocument["sections"] = [];
  const rawSections = Array.isArray(raw.sections) ? raw.sections : [];
  if (rawSections.length > DOC_LIMITS.sections) issues.push({ kind: "trimmed", where: "sections" });
  rawSections.slice(0, DOC_LIMITS.sections).forEach((sec, si) => {
    const where = `section ${si + 1}`;
    const heading = line(sec.heading, DOC_LIMITS.heading, `${where} heading`, "Details");
    const blocks: CleanBlock[] = [];
    const rawBlocks = Array.isArray(sec.blocks) ? sec.blocks : [];
    if (rawBlocks.length > DOC_LIMITS.blocksPerSection) issues.push({ kind: "trimmed", where });
    for (const b of rawBlocks.slice(0, DOC_LIMITS.blocksPerSection) as DocumentBlock[]) {
      const clean = cleanBlock(b, where);
      if (clean) blocks.push(clean);
    }
    if (blocks.length) sections.push({ heading, blocks });
  });

  function cleanBlock(b: DocumentBlock, where: string): CleanBlock | null {
    switch (b.type) {
      case "paragraph": {
        const text = prose(b.text, DOC_LIMITS.paragraph, where);
        return text ? { type: "paragraph", text } : null;
      }
      case "bullets": {
        const items: string[] = [];
        for (const it of (b.items ?? []).slice(0, DOC_LIMITS.bullets)) {
          const t = trimTo(it, DOC_LIMITS.bullet);
          if (!t) continue;
          const bad = check(t);
          if (bad.length) issues.push({ kind: "unverified_number", where, numbers: bad, removed: t });
          else items.push(t);
        }
        return items.length ? { type: "bullets", items } : null;
      }
      case "kpi_row": {
        const ids: string[] = [];
        for (const id of b.facts ?? []) {
          if (!facts.has(id)) issues.push({ kind: "unknown_reference", where, id: safeText(id, 60) });
          else if (!ids.includes(id)) ids.push(id);
        }
        return ids.length ? { type: "kpi_row", facts: ids.slice(0, DOC_LIMITS.kpis) } : null;
      }
      case "table": {
        const d = datasets.get(b.dataset);
        if (!d) {
          issues.push({ kind: "unknown_reference", where, id: safeText(b.dataset, 60) });
          return null;
        }
        if (!d.rows.length) return null;
        const keys = new Set(d.columns.map((c) => c.key));
        const picked = (b.columns ?? []).filter((k) => keys.has(k));
        const label = d.columns[0].key;
        const columns = picked.length ? [label, ...picked.filter((k) => k !== label)].slice(0, 7) : d.defaultColumns;
        const limit = Math.max(1, Math.min(DOC_LIMITS.tableRows, Math.round(Number(b.limit) || DOC_LIMITS.defaultTableRows)));
        return { type: "table", dataset: d.id, columns, limit, caption: b.caption ? line(b.caption, DOC_LIMITS.caption, where, "") || null : null };
      }
      case "chart": {
        const d = datasets.get(b.dataset);
        if (!d) {
          issues.push({ kind: "unknown_reference", where, id: safeText(b.dataset, 60) });
          return null;
        }
        if (!d.rows.length || !d.defaultChart) return null;
        let chart = b.chart;
        if (!d.charts.includes(chart)) {
          issues.push({ kind: "adjusted_chart", where, requested: safeText(chart, 20), used: d.defaultChart });
          chart = d.defaultChart;
        }
        const metric = b.metric && d.metrics.includes(b.metric) ? b.metric : (d.defaultMetric ?? d.metrics[0]);
        return { type: "chart", dataset: d.id, chart, metric, caption: b.caption ? line(b.caption, DOC_LIMITS.caption, where, "") || null : null };
      }
      case "callout": {
        const text = prose(b.text ?? "", DOC_LIMITS.calloutText, where);
        const titleText = line(b.title, DOC_LIMITS.calloutTitle, where, "");
        if (!text && !titleText) return null;
        const tone = (["neutral", "positive", "warning", "negative"] as const).includes(b.tone) ? b.tone : "neutral";
        return { type: "callout", tone, title: titleText || "Note", text };
      }
      default:
        return null;
    }
  }

  return { document: { title, subtitle: subtitleRaw || null, summary, sections }, issues };
}

// ---------------------------------------------------------------- built-in writer

/**
 * Deterministic document built by code from the pack (no model): used in tests and when
 * LLM_MODEL=mock, so the whole flow can be tried offline. Every figure is copied from the pack.
 */
export function mockDocument(pack: DocumentPack, templateId: string | null): AiDocument {
  const t = getDocumentTemplate(templateId);
  const fact = (id: string) => pack.facts.find((f) => f.id === id);
  const txt = (id: string) => {
    const f = fact(id);
    return f ? factText(f, pack.currency) : null;
  };
  const rev = txt("revenue");
  const spend = txt("spend");
  const roas = txt("roas");
  const kpis = (t?.focus.facts ?? ["revenue", "spend", "roas", "customers"]).filter((id) => fact(id)).slice(0, 4);
  const datasetIds = (t?.focus.datasets ?? ["daily", "platforms", "top_campaigns"]).filter((id) => pack.datasets.some((d) => d.id === id && d.rows.length));
  const summary = [
    rev && spend ? `Revenue was ${rev.value} from ${spend.value} of ad spend in ${pack.period.label}.` : null,
    roas ? `Return on ad spend was ${roas.value} on ${pack.modelLabel.toLowerCase()} attribution${roas.previous ? `, against ${roas.previous} in the previous period` : ""}.` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const sections: AiDocument["sections"] = [
    {
      heading: "Headline numbers",
      blocks: [
        { type: "kpi_row", facts: kpis },
        { type: "paragraph", text: rev?.change ? `Revenue changed ${rev.change} against ${pack.previousPeriod.label}.` : `This covers ${pack.period.label}.` },
      ],
    },
  ];
  for (const id of datasetIds) {
    const d = pack.datasets.find((x) => x.id === id)!;
    const blocks: DocumentBlock[] = [];
    if (d.defaultChart) blocks.push({ type: "chart", dataset: d.id, chart: d.defaultChart, metric: d.defaultMetric, caption: null });
    if (d.id !== "daily") blocks.push({ type: "table", dataset: d.id, columns: null, limit: 8, caption: null });
    const label = d.columns[0];
    const metric = d.columns.find((c) => c.key === d.defaultMetric);
    if (metric && d.id !== "daily") {
      blocks.push({
        type: "bullets",
        items: d.rows.slice(0, 3).map((r) => `${formatValue(label.kind, r[label.key], pack.currency)}: ${formatValue(metric.kind, r[metric.key], pack.currency)} ${metric.label.toLowerCase()}.`),
      });
    }
    sections.push({ heading: d.title, blocks });
  }
  sections.push({
    heading: "Next steps",
    blocks: [{ type: "callout", tone: "neutral", title: "Recommended next steps", text: "Move budget in small steps toward the campaigns with the strongest return, pause what spends without revenue, and check the result against this report next period." }],
  });
  return { title: t?.name ?? "Performance report", subtitle: `${pack.period.label} · ${pack.modelLabel} attribution`, summary, sections };
}

// ---------------------------------------------------------------- generation

/** LLM_MODEL=mock (server env only) selects the built-in writer. */
export const isMockModel = (cfg: LlmConfig | null) => Boolean(cfg?.trusted && cfg.provider === "custom" && cfg.model === "mock");

/** Whether AI documents can be written: a model is connected (or the built-in writer is on). */
export async function documentModelStatus(ws: Workspace, db: DB): Promise<{ ready: boolean; label: string | null }> {
  const cfg = await getLlmConfig(ws, db);
  if (!cfg) return { ready: false, label: null };
  return { ready: true, label: isMockModel(cfg) ? "Built-in writer (demo)" : `${cfg.provider}/${cfg.model}` };
}

export async function generateAiDocument(db: DB, ws: Workspace, request: DocumentRequest, opts: { model?: LanguageModel | "mock"; modelName?: string } = {}): Promise<GeneratedDocument> {
  let model: LanguageModel | "mock" | undefined = opts.model;
  let modelName = opts.modelName ?? (opts.model === "mock" ? "built-in writer" : "custom");
  if (!model) {
    const cfg = await getLlmConfig(ws, db);
    if (!cfg) throw new NoModelConfigured();
    if (isMockModel(cfg)) {
      model = "mock";
      modelName = "built-in writer";
    } else {
      model = languageModel(cfg);
      modelName = `${cfg.provider}/${cfg.model}`;
    }
  }
  const pack = await buildDocumentPack(db, ws, { start: request.start, end: request.end, model: request.model });

  let raw: AiDocument;
  if (model === "mock") {
    raw = mockDocument(pack, request.templateId);
  } else {
    try {
      const result = await generateText({
        model,
        system: DOCUMENT_SYSTEM_PROMPT,
        prompt: documentUserPrompt(request.prompt, packForModel(pack)),
        output: Output.object({ schema: aiDocumentSchema, name: "report_document", description: "A structured report document that references data-pack ids." }),
        maxRetries: 1,
        timeout: { totalMs: 150_000 },
      });
      raw = result.output as AiDocument;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new DocumentGenerationFailed(`The model couldn't write a valid document: ${safeText(msg, 160)}`);
    }
  }

  const { document, issues } = sanitizeDocument(raw, pack, request.prompt, getDocumentTemplate(request.templateId)?.name);
  if (!document.sections.length) throw new DocumentGenerationFailed("The model's document had no usable sections. Try again, or a more specific request.");
  return { document, issues, pack, modelName, request };
}
