import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, type LanguageModel } from "ai";
import { schema, type DB } from "../db";
import type { AttributionModel } from "../db/schema";
import { getConnection, type Workspace } from "../settings";
import { buildFacts, type Facts } from "./facts";
import { unverifiedNumbers } from "./numbers";

export const LLM_PROVIDERS = {
  ollama: { label: "Ollama (local)", baseUrl: "http://localhost:11434/v1", needsKey: false, example: "llama3.1" },
  lmstudio: { label: "LM Studio (local)", baseUrl: "http://localhost:1234/v1", needsKey: false, example: "qwen2.5-7b-instruct" },
  openai: { label: "OpenAI", baseUrl: "", needsKey: true, example: "gpt-5-mini" },
  anthropic: { label: "Anthropic", baseUrl: "", needsKey: true, example: "claude-sonnet-5" },
  google: { label: "Google Gemini", baseUrl: "", needsKey: true, example: "gemini-2.5-flash" },
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", needsKey: true, example: "meta-llama/llama-3.3-70b-instruct" },
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", needsKey: true, example: "deepseek-chat" },
  custom: { label: "Any OpenAI-compatible API", baseUrl: "", needsKey: false, example: "model-name" },
} as const;
export type LlmProvider = keyof typeof LLM_PROVIDERS;

export type LlmConfig = { provider: LlmProvider; model: string; baseUrl?: string; apiKey?: string };

/** Settings from the dashboard, falling back to LLM_* environment variables. */
export async function getLlmConfig(ws: Workspace, db?: DB): Promise<LlmConfig | null> {
  const conn = await getConnection(ws.id, "llm", db);
  if (conn?.enabled && conn.config.model) {
    return {
      provider: (conn.config.provider as LlmProvider) || "custom",
      model: conn.config.model,
      baseUrl: conn.config.baseUrl || undefined,
      apiKey: conn.secrets.apiKey,
    };
  }
  if (process.env.LLM_MODEL) {
    const [prefix, ...rest] = process.env.LLM_MODEL.split("/");
    const known = prefix in LLM_PROVIDERS;
    return {
      provider: known ? (prefix as LlmProvider) : "custom",
      model: known ? rest.join("/") : process.env.LLM_MODEL,
      baseUrl: process.env.LLM_API_BASE || undefined,
      apiKey: process.env.LLM_API_KEY || undefined,
    };
  }
  return null;
}

export function languageModel(cfg: LlmConfig): LanguageModel {
  const base = cfg.baseUrl || LLM_PROVIDERS[cfg.provider]?.baseUrl || undefined;
  switch (cfg.provider) {
    case "openai":
      return createOpenAI({ apiKey: cfg.apiKey, baseURL: base })(cfg.model);
    case "anthropic":
      return createAnthropic({ apiKey: cfg.apiKey, baseURL: base })(cfg.model);
    case "google":
      return createGoogle({ apiKey: cfg.apiKey, baseURL: base })(cfg.model);
    default: {
      if (!base) throw new Error("Set a base URL for this provider (e.g. http://localhost:11434/v1)");
      // Ollama's OpenAI-compatible API lives under /v1; accept the bare host too.
      const url = cfg.provider === "ollama" && !/\/v1\/?$/.test(base) ? `${base.replace(/\/$/, "")}/v1` : base;
      return createOpenAICompatible({ name: cfg.provider, baseURL: url, apiKey: cfg.apiKey })(cfg.model);
    }
  }
}

const SYSTEM = `You are a sharp, practical performance-marketing analyst writing a short weekly note for a founder.
Rules (strict):
- Use ONLY numbers that appear in the JSON facts. Never calculate, estimate, round differently, or invent numbers.
- Quote money exactly as formatted in the facts (with currency symbol).
- If something isn't in the facts, say you don't know.
- Be concrete: name campaigns. Recommend where to move budget and why, based on ROAS and revenue.
Format (Markdown):
## Summary  (2-3 sentences)
## What's working  (bullets)
## Wasted spend  (bullets)
## Recommendations  (3-5 numbered actions)
Keep it under 350 words.`;

/** Deterministic report used when no model is configured (or the model call fails). */
export function templateReport(f: Facts): string {
  const lines: string[] = [];
  const t = f.totals;
  const c = f.changeVsPreviousPeriod;
  lines.push("## Summary");
  lines.push(
    `From ${f.period.start} to ${f.period.end} you spent **${t.spend}** on ads and earned **${t.revenue}** in revenue ` +
      `(**${t.revenueAttributedToAds}** attributed to ads, ROAS **${t.roas}** using the ${f.attributionModel.replace("_", "-")} model). ` +
      `Spend changed ${c.spend} and revenue changed ${c.revenue} versus the previous period.`,
  );
  lines.push("", "## What's working");
  const winners = f.topCampaigns.filter((x) => x.roas !== "n/a" && parseFloat(x.roas) >= 1);
  if (winners.length === 0) lines.push("- No campaign returned more than it spent in this period.");
  for (const w of winners) lines.push(`- **${w.name}** (${w.platform}): ${w.revenue} revenue on ${w.spend} spend — ROAS ${w.roas}.`);
  lines.push("", "## Wasted spend");
  if (f.wastedSpend.length === 0) lines.push("- Nothing obvious: every campaign with meaningful spend produced revenue.");
  for (const w of f.wastedSpend) lines.push(`- **${w.name}** (${w.platform}): ${w.spend} spent, ${w.revenue} revenue, ${w.leads} leads — ROAS ${w.roas}.`);
  lines.push("", "## Recommendations");
  let i = 1;
  if (f.wastedSpend[0]) lines.push(`${i++}. Cut or restructure **${f.wastedSpend[0].name}** — it spent ${f.wastedSpend[0].spend} with ROAS ${f.wastedSpend[0].roas}.`);
  if (winners[0]) lines.push(`${i++}. Move budget toward **${winners[0].name}**, your best performer at ROAS ${winners[0].roas}.`);
  if (t.unattributedShare !== "n/a" && parseFloat(t.unattributedShare) > 20) {
    lines.push(`${i++}. ${t.unattributedShare} of revenue is unattributed — check the pixel is on every landing page and pass the visitor ID to Stripe checkout.`);
  }
  lines.push(`${i++}. Compare models (first-touch vs last-touch) before cutting prospecting campaigns; they often start journeys that retargeting and brand search finish.`);
  return lines.join("\n");
}

export async function generateReport(
  db: DB,
  ws: Workspace,
  opts: { start?: string; end?: string; model?: AttributionModel; days?: number; useLlm?: boolean } = {},
) {
  const { facts } = await buildFacts(db, ws, opts);
  const cfg = opts.useLlm === false ? null : await getLlmConfig(ws, db);
  let content = templateReport(facts);
  let modelName = "template";
  let error: string | null = null;
  if (cfg) {
    try {
      const { text } = await generateText({
        model: languageModel(cfg),
        system: SYSTEM,
        prompt: `Facts (JSON):\n${JSON.stringify(facts, null, 2)}\n\nWrite the weekly note.`,
        maxRetries: 1,
        timeout: { totalMs: 120_000 },
      });
      if (text.trim()) {
        content = text.trim();
        modelName = `${cfg.provider}/${cfg.model}`;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }
  const unverified = modelName === "template" ? [] : unverifiedNumbers(content, facts);
  const [row] = await db
    .insert(schema.aiReports)
    .values({
      workspaceId: ws.id,
      periodStart: facts.period.start,
      periodEnd: facts.period.end,
      modelName,
      facts: facts as unknown as Record<string, unknown>,
      contentMd: content,
      unverifiedNumbers: unverified,
    })
    .returning();
  return { report: row, error };
}
