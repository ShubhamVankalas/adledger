import { MockLanguageModelV4 } from "ai/test";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { buildDocumentPack, factText, packForModel, type DocumentPack } from "@/lib/ai/document-data";
import { DOCUMENT_SYSTEM_PROMPT, DOCUMENT_TEMPLATES, getDocumentTemplate } from "@/lib/ai/document-prompts";
import { previewDocument } from "@/lib/ai/document-preview";
import { aiDocumentSchema, DOC_LIMITS, documentRequestSchema, type AiDocument } from "@/lib/ai/document-schema";
import { generateAiDocument, guardProse, isMockModel, mockDocument, NoModelConfigured, sanitizeDocument, sentences } from "@/lib/ai/document";
import { numberChecker } from "@/lib/ai/numbers";
import { RANGE_PRESETS } from "@/components/reports-gallery/range";
import { schema, type DB } from "@/lib/db";
import { seedDemo } from "@/lib/demo/seed";
import { AI_DOCUMENT_KIND, generateAiDocumentPdf } from "@/lib/pdf/ai-document";
import { moneyWhole } from "@/lib/pdf/format";
import { lookupFingerprint } from "@/lib/report-kinds/verify";
import { overview } from "@/lib/reports";
import type { Workspace } from "@/lib/settings";
import { setupWorkspace } from "./helpers";

// AI documents: the model's structure is validated against the data pack, invented numbers are
// removed, and the PDF draws every figure from SQL. Uses the deterministic built-in writer and
// the AI SDK mock model, never a real provider.

let db: DB;
let ws: Workspace;
let pack: DocumentPack;
const END = "2026-09-01";
const START = "2026-08-03";
const request = { templateId: null, prompt: "Board update for August, Meta vs Google, top 3 campaigns.", start: START, end: END, model: "linear" as const };

beforeAll(async () => {
  delete process.env.LLM_MODEL;
  ({ db, ws } = await setupWorkspace({ name: "Docs Co" }));
  await seedDemo(db, ws.id, { anchor: END });
  pack = await buildDocumentPack(db, ws, { start: START, end: END, model: "linear" });
});

const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } };
const modelReturning = (doc: unknown) =>
  new MockLanguageModelV4({ doGenerate: { content: [{ type: "text", text: JSON.stringify(doc) }], finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [] } as never });

describe("document schema", () => {
  it("accepts a well-formed document and rejects unknown block types", () => {
    const doc: AiDocument = {
      title: "August board update",
      subtitle: null,
      summary: "Revenue grew.",
      sections: [
        {
          heading: "Numbers",
          blocks: [
            { type: "kpi_row", facts: ["revenue", "roas"] },
            { type: "table", dataset: "platforms", columns: null, limit: null, caption: null },
            { type: "chart", dataset: "daily", chart: "combo", metric: null, caption: null },
            { type: "callout", tone: "warning", title: "Watch", text: "Spend rose." },
          ],
        },
      ],
    };
    expect(aiDocumentSchema.safeParse(doc).success).toBe(true);
    const bad = { ...doc, sections: [{ heading: "x", blocks: [{ type: "image", url: "https://evil" }] }] };
    expect(aiDocumentSchema.safeParse(bad).success).toBe(false);
    expect(aiDocumentSchema.safeParse({ ...doc, sections: [{ heading: "x", blocks: [{ type: "chart", dataset: "daily", chart: "pie", metric: null, caption: null }] }] }).success).toBe(false);
  });

  it("validates the request: dates in order, at most a year, a real prompt", () => {
    expect(documentRequestSchema.safeParse(request).success).toBe(true);
    expect(documentRequestSchema.safeParse({ ...request, start: END, end: START }).success).toBe(false);
    expect(documentRequestSchema.safeParse({ ...request, start: "2025-01-01" }).success).toBe(false);
    expect(documentRequestSchema.safeParse({ ...request, prompt: "hi" }).success).toBe(false);
    expect(documentRequestSchema.safeParse({ ...request, prompt: "x".repeat(4001) }).success).toBe(false);
  });
});

describe("template library", () => {
  it("has at least 12 complete templates with unique ids", () => {
    expect(DOCUMENT_TEMPLATES.length).toBeGreaterThanOrEqual(12);
    expect(new Set(DOCUMENT_TEMPLATES.map((t) => t.id)).size).toBe(DOCUMENT_TEMPLATES.length);
    expect(new Set(DOCUMENT_TEMPLATES.map((t) => t.name)).size).toBe(DOCUMENT_TEMPLATES.length);
    for (const t of DOCUMENT_TEMPLATES) {
      expect(t.id).toMatch(/^[a-z0-9-]+$/);
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.prompt.length).toBeGreaterThan(200);
      expect(t.prompt.length).toBeLessThanOrEqual(4000);
      expect(Object.keys(RANGE_PRESETS)).toContain(t.range);
      expect(getDocumentTemplate(t.id)).toBe(t);
    }
  });

  it("prompts contain no figures of their own (they'd whitelist numbers in the check)", () => {
    for (const t of DOCUMENT_TEMPLATES) {
      const numbers = (t.prompt.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
      expect(numbers.filter((n) => n > 10), t.id).toEqual([]);
    }
  });

  it("every template's focus points at facts and datasets the pack has", () => {
    const facts = new Set(pack.facts.map((f) => f.id));
    const datasets = new Set(pack.datasets.map((d) => d.id));
    for (const t of DOCUMENT_TEMPLATES) {
      for (const d of t.focus.datasets) expect(datasets.has(d), `${t.id}: ${d}`).toBe(true);
      // Platform facts exist only for platforms with data; the rest must always exist.
      for (const f of t.focus.facts.filter((x) => !x.includes("."))) expect(facts.has(f), `${t.id}: ${f}`).toBe(true);
    }
  });

  it("the system prompt states the number rules and every block type", () => {
    for (const s of ["paragraph", "bullets", "kpi_row", "table", "chart", "callout", "Never calculate"]) expect(DOCUMENT_SYSTEM_PROMPT).toContain(s);
  });
});

describe("data pack", () => {
  it("facts come from reports.ts and the model only sees formatted values", async () => {
    const o = await overview(db, ws, { start: START, end: END, model: "linear" });
    const rev = pack.facts.find((f) => f.id === "revenue")!;
    expect(rev.value).toBe(o.revenueMinor);
    const view = JSON.stringify(packForModel(pack));
    expect(view).toContain(moneyWhole(o.revenueMinor, ws.reportingCurrency));
    expect(view).not.toContain(`"${o.revenueMinor}"`);
    expect(view).not.toMatch(/Minor/);
    expect(view).not.toMatch(/@/); // no emails, ever
    expect(new Set(pack.facts.map((f) => f.id)).size).toBe(pack.facts.length);
    expect(new Set(pack.datasets.map((d) => d.id)).size).toBe(pack.datasets.length);
    for (const d of pack.datasets) {
      for (const k of [...d.defaultColumns, ...d.metrics]) expect(d.columns.some((c) => c.key === k), `${d.id}.${k}`).toBe(true);
      if (d.defaultChart) expect(d.charts).toContain(d.defaultChart);
    }
  });
});

describe("number guard", () => {
  it("splits sentences and drops only the ones with invented numbers", () => {
    expect(sentences("One. Two has 3.5× ROAS! Three?")).toEqual(["One.", "Two has 3.5× ROAS!", "Three?"]);
    const check = numberChecker({ facts: ["$57,875", "3.25×", "12.4%"] });
    const g = guardProse("Revenue was $57,875. ROAS hit 3.25× and grew 12.4%. It will reach $91,000 next month. Top 3 campaigns led.", check, 500);
    expect(g.text).toBe("Revenue was $57,875. ROAS hit 3.25× and grew 12.4%. Top 3 campaigns led.");
    expect(g.removed).toEqual([{ sentence: "It will reach $91,000 next month.", numbers: ["91,000"] }]);
  });

  it("sanitizes a model document against the pack", () => {
    const rev = factText(pack.facts.find((f) => f.id === "revenue")!, pack.currency);
    const raw: AiDocument = {
      title: "Growth up 98765.4% (really)",
      subtitle: "For the board",
      summary: `Revenue was ${rev.value}. We think next quarter brings $4,444,444.`,
      sections: [
        {
          heading: "Headline",
          blocks: [
            { type: "kpi_row", facts: ["revenue", "made_up_fact", "revenue", "roas"] },
            { type: "chart", dataset: "platforms", chart: "line", metric: "not_a_metric", caption: null },
            { type: "table", dataset: "nope", columns: null, limit: 5, caption: null },
            { type: "table", dataset: "campaigns", columns: ["roas", "bogus", "spend"], limit: 500, caption: null },
            { type: "bullets", items: ["Keep going.", "Spend 123,456 more."] },
          ],
        },
        { heading: "Empty", blocks: [{ type: "paragraph", text: "Revenue will hit 777,777 soon." }] },
        ...Array.from({ length: 12 }, (_, i) => ({ heading: `Extra ${i}`, blocks: [{ type: "paragraph" as const, text: "More words." }] })),
      ],
    };
    const { document, issues } = sanitizeDocument(raw, pack, request.prompt, "Fallback title");
    expect(document.title).toBe("Fallback title");
    expect(document.summary).toBe(`Revenue was ${rev.value}.`);
    const [first] = document.sections;
    expect(first.blocks[0]).toEqual({ type: "kpi_row", facts: ["revenue", "roas"] });
    expect(first.blocks[1]).toMatchObject({ type: "chart", dataset: "platforms", chart: "bar", metric: "ad_revenue" });
    expect(first.blocks[2]).toEqual({ type: "table", dataset: "campaigns", columns: ["name", "roas", "spend"], limit: DOC_LIMITS.tableRows, caption: null });
    expect(first.blocks[3]).toEqual({ type: "bullets", items: ["Keep going."] });
    // The section whose only paragraph was invented disappears; sections are capped.
    expect(document.sections.some((s) => s.heading === "Empty")).toBe(false);
    expect(document.sections.length).toBeLessThanOrEqual(DOC_LIMITS.sections);
    const kinds = issues.map((i) => i.kind);
    expect(kinds).toContain("unknown_reference");
    expect(kinds).toContain("adjusted_chart");
    expect(kinds).toContain("trimmed");
    expect(issues.filter((i) => i.kind === "unverified_number").length).toBe(4);
  });

  it("the built-in writer only ever quotes numbers from the pack", () => {
    for (const t of [null, ...DOCUMENT_TEMPLATES.map((x) => x.id)]) {
      const raw = mockDocument(pack, t);
      expect(aiDocumentSchema.safeParse(raw).success).toBe(true);
      const { issues, document } = sanitizeDocument(raw, pack, "");
      expect(issues.filter((i) => i.kind !== "trimmed"), String(t)).toEqual([]);
      expect(document.sections.length).toBeGreaterThan(1);
    }
  });
});

describe("generation", () => {
  it("needs a model: no configuration means NoModelConfigured", async () => {
    await expect(generateAiDocument(db, ws, request)).rejects.toBeInstanceOf(NoModelConfigured);
  });

  it("LLM_MODEL=mock selects the built-in writer", async () => {
    expect(isMockModel({ provider: "custom", model: "mock", trusted: true })).toBe(true);
    expect(isMockModel({ provider: "custom", model: "mock" })).toBe(false); // typed in the dashboard: not the env switch
    process.env.LLM_MODEL = "mock";
    try {
      const gen = await generateAiDocument(db, ws, { ...request, templateId: "board-update" });
      expect(gen.modelName).toBe("built-in writer");
      expect(gen.document.title).toBe("Board or investor update");
    } finally {
      delete process.env.LLM_MODEL;
    }
  });

  it("uses the model's structured output and flags invented numbers", async () => {
    const rev = factText(pack.facts.find((f) => f.id === "revenue")!, pack.currency);
    const model = modelReturning({
      title: "August board update",
      subtitle: "Meta vs Google",
      summary: `Revenue reached ${rev.value}. Margins improved by 9876.54 points.`,
      sections: [{ heading: "Results", blocks: [{ type: "kpi_row", facts: ["revenue", "roas"] }, { type: "chart", dataset: "platforms", chart: "bar", metric: "roas", caption: "ROAS by platform" }] }],
    });
    const gen = await generateAiDocument(db, ws, request, { model, modelName: "mock/test" });
    expect(gen.modelName).toBe("mock/test");
    expect(gen.document.summary).toBe(`Revenue reached ${rev.value}.`);
    expect(gen.issues).toEqual([expect.objectContaining({ kind: "unverified_number", numbers: ["9876.54"] })]);
    // The model got the system prompt and the formatted pack, never raw minor units.
    const sent = JSON.stringify(model.doGenerateCalls[0].prompt);
    expect(sent).toContain("Never calculate");
    expect(sent).toContain(rev.value.replace(/"/g, ""));
    expect(sent).not.toMatch(/Minor/);
  });

  it("reports a model that returns something unusable", async () => {
    const model = modelReturning({ nonsense: true });
    await expect(generateAiDocument(db, ws, request, { model })).rejects.toThrow(/valid document/);
    const empty = modelReturning({ title: "x", subtitle: null, summary: "", sections: [{ heading: "a", blocks: [{ type: "table", dataset: "nope", columns: null, limit: null, caption: null }] }] });
    await expect(generateAiDocument(db, ws, request, { model: empty })).rejects.toThrow(/no usable sections/);
  });
});

describe("AI document PDF", () => {
  it("renders every template's document, logs the export and verifies without revealing contents", async () => {
    for (const t of DOCUMENT_TEMPLATES) {
      const gen = await generateAiDocument(db, ws, { ...request, templateId: t.id }, { model: "mock" });
      const t0 = performance.now();
      const out = await generateAiDocumentPdf(db, ws, gen, { via: "api_key", apiKeyId: null, name: "Test person" });
      expect(performance.now() - t0).toBeLessThan(4000);
      expect(out.pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect(out.pages).toBeGreaterThan(0);
      expect(out.filename).toMatch(/^adledger-[a-z0-9-]+-[a-z0-9-]+-2026-08-03-to-2026-09-01\.pdf$/);
      const [row] = await db.select().from(schema.exportLog).where(eq(schema.exportLog.id, out.exportId));
      expect(row).toMatchObject({ reportKind: AI_DOCUMENT_KIND, status: "ok", fingerprint: out.fingerprint, pages: out.pages });
      expect(Object.keys(row.params).sort()).toEqual(["compare", "end", "model", "start", "template"]);
      expect(row.params.template).toBe(t.id);
      // Nothing from the document itself lands in the log.
      expect(JSON.stringify(row)).not.toContain(gen.document.title);
    }
    const gen = await generateAiDocument(db, ws, request, { model: "mock" });
    const out = await generateAiDocumentPdf(db, ws, gen, { via: "api_key", apiKeyId: null, name: "Test person" });
    const found = await lookupFingerprint(db, out.fingerprint.slice(0, 20));
    expect(found).toMatchObject({ status: "found", report: { kind: AI_DOCUMENT_KIND, title: "AI document", start: START, end: END } });
    expect(JSON.stringify(found)).not.toContain(gen.document.title);
  });

  it("builds an HTML preview with the same formatted figures", async () => {
    const gen = await generateAiDocument(db, ws, { ...request, templateId: "monthly-client-report" }, { model: "mock" });
    const preview = previewDocument(gen.document, gen.pack);
    expect(preview.title).toBe(gen.document.title);
    const kpis = preview.sections.flatMap((s) => s.blocks).find((b) => b.type === "kpis");
    expect(kpis && kpis.type === "kpis" ? kpis.items[0].value : null).toBe(factText(gen.pack.facts.find((f) => f.id === "spend")!, gen.pack.currency).value);
    const chart = preview.sections.flatMap((s) => s.blocks).find((b) => b.type === "chart" && b.lines.length);
    if (chart && chart.type === "chart") for (const l of chart.lines) for (const p of l.points) expect(p).toBeGreaterThanOrEqual(0);
  });
});
