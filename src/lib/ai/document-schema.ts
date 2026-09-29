import { z } from "zod";

// The structured document the connected model writes. The model never prints a figure of its
// own in a KPI, table or chart: those blocks name fact and dataset ids from the data pack
// (document-data.ts) and our code draws them from SQL results. Prose is free text, checked
// afterwards: numbers that aren't in the pack are removed (document.ts).
//
// Optional values are `nullable` (not `optional`) so the JSON schema works with providers that
// require every property (OpenAI strict structured outputs). Lengths are not constrained here,
// so a verbose model doesn't fail validation; sanitizeDocument() trims everything afterwards.

export const CHART_TYPES = ["bar", "line", "combo", "donut", "funnel", "waterfall"] as const;
export type ChartType = (typeof CHART_TYPES)[number];
export const CALLOUT_TONES = ["neutral", "positive", "warning", "negative"] as const;
export type CalloutTone = (typeof CALLOUT_TONES)[number];

const paragraph = z.object({ type: z.literal("paragraph"), text: z.string().describe("Plain English, 1-4 sentences. Only numbers copied from the data pack.") });
const bullets = z.object({ type: z.literal("bullets"), items: z.array(z.string()).describe("2-6 short statements.") });
const kpiRow = z.object({ type: z.literal("kpi_row"), facts: z.array(z.string()).describe("2-4 fact ids from the data pack, e.g. revenue, roas.") });
const table = z.object({
  type: z.literal("table"),
  dataset: z.string().describe("A dataset id from the data pack."),
  columns: z.array(z.string()).nullable().describe("Column keys of that dataset to show (the label column is always first), or null for its default columns."),
  limit: z.number().nullable().describe("Rows to show (default 10, at most 25)."),
  caption: z.string().nullable(),
});
const chart = z.object({
  type: z.literal("chart"),
  dataset: z.string().describe("A dataset id from the data pack."),
  chart: z.enum(CHART_TYPES).describe("One of the chart types that dataset lists."),
  metric: z.string().nullable().describe("A metric key the dataset lists for charts, or null for its default."),
  caption: z.string().nullable(),
});
const callout = z.object({ type: z.literal("callout"), tone: z.enum(CALLOUT_TONES), title: z.string(), text: z.string() });

export const documentBlockSchema = z.discriminatedUnion("type", [paragraph, bullets, kpiRow, table, chart, callout]);
export type DocumentBlock = z.infer<typeof documentBlockSchema>;

export const aiDocumentSchema = z.object({
  title: z.string().describe("Document title, at most 70 characters."),
  subtitle: z.string().nullable().describe("One line under the title (audience or focus), or null."),
  summary: z.string().describe("The key takeaways in 2-4 sentences."),
  sections: z
    .array(
      z.object({
        heading: z.string(),
        blocks: z.array(documentBlockSchema),
      }),
    )
    .describe("2-6 sections, each with 1-5 blocks."),
});
export type AiDocument = z.infer<typeof aiDocumentSchema>;

/** Hard limits applied after generation (a model can't blow up the PDF). */
export const DOC_LIMITS = {
  title: 90,
  subtitle: 140,
  summary: 900,
  heading: 80,
  paragraph: 1200,
  bullet: 280,
  calloutTitle: 100,
  calloutText: 600,
  caption: 160,
  sections: 8,
  blocksPerSection: 10,
  bullets: 8,
  kpis: 8,
  tableRows: 25,
  defaultTableRows: 10,
} as const;

/** What the person asks for: GET-able params plus the instruction. */
export const documentRequestSchema = z
  .object({
    templateId: z.string().max(60).nullable().default(null),
    prompt: z.string().trim().min(10, "Describe the document in a sentence or two.").max(4000, "Keep the request under 4,000 characters."),
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    model: z.enum(["first_touch", "last_touch", "linear"]).default("linear"),
  })
  .refine((p) => p.start <= p.end, { message: "Pick a start date on or before the end date.", path: ["start"] })
  .refine((p) => (Date.parse(`${p.end}T00:00:00Z`) - Date.parse(`${p.start}T00:00:00Z`)) / 86_400_000 <= 366, {
    message: "An AI document covers at most one year.",
    path: ["end"],
  });
export type DocumentRequest = z.infer<typeof documentRequestSchema>;
