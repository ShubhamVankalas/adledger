import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, type LanguageModel } from "ai";
import { schema, type DB } from "../db";
import type { AttributionModel } from "../db/schema";
import { guardedFetch } from "../net";
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

/** `trusted`: set by the server operator (LLM_* env vars), so the base URL skips the private-network check. */
export type LlmConfig = { provider: LlmProvider; model: string; baseUrl?: string; apiKey?: string; trusted?: boolean };

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
      trusted: true,
    };
  }
  return null;
}

export function languageModel(cfg: LlmConfig): LanguageModel {
  const base = cfg.baseUrl || LLM_PROVIDERS[cfg.provider]?.baseUrl || undefined;
  // Base URLs typed into the dashboard may not reach private/metadata addresses (localhost and
  // host.docker.internal stay allowed for local models). See src/lib/net.ts.
  const fetch = cfg.trusted ? undefined : guardedFetch("llm");
  switch (cfg.provider) {
    case "openai":
      return createOpenAI({ apiKey: cfg.apiKey, baseURL: base, fetch })(cfg.model);
    case "anthropic":
      return createAnthropic({ apiKey: cfg.apiKey, baseURL: base, fetch })(cfg.model);
    case "google":
      return createGoogle({ apiKey: cfg.apiKey, baseURL: base, fetch })(cfg.model);
    default: {
      if (!base) throw new Error("Set a base URL for this provider (e.g. http://localhost:11434/v1)");
      // Ollama's OpenAI-compatible API lives under /v1; accept the bare host too.
      const url = cfg.provider === "ollama" && !/\/v1\/?$/.test(base) ? `${base.replace(/\/$/, "")}/v1` : base;
      return createOpenAICompatible({ name: cfg.provider, baseURL: url, apiKey: cfg.apiKey, fetch })(cfg.model);
    }
  }
}

const SYSTEM = `You are a sharp, practical performance-marketing analyst writing a short weekly note for a founder.
Rules (strict):
- Use ONLY numbers that appear in the JSON facts. Never calculate, estimate, round differently, or invent numbers.
- Quote money, percentages and ROAS exactly as formatted in the facts (with currency symbol).
- Name platforms, channels and the period exactly as the facts do (e.g. "Meta", "Paid social", period.label).
- If something isn't in the facts, say you don't know.
- Be concrete: name campaigns. Recommend where to move budget and why, based on ROAS and revenue.
Format (Markdown):
## Summary  (2-3 sentences)
## What's working  (bullets)
## Wasted spend  (bullets)
## Recommendations  (3-5 numbered actions)
Keep it under 350 words.`;

// ---- Template helpers: turn the pre-formatted facts into sentences. They only choose words;
// every figure in the output is copied verbatim from the facts pack.

const MINUS = "−";
/** True when a formatted amount is zero ("$0", "0x", "0"). */
const isZero = (s: string) => !/[1-9]/.test(s);
/** Signed percentage string ("+15.2%", "−0.1%", "0%") -> number; null for "new" / "n/a". */
function pctValue(s: string): number | null {
  const m = /^([+−-])?(\d+(?:\.\d+)?)%$/.exec(s);
  if (!m) return null;
  return (m[1] === MINUS || m[1] === "-" ? -1 : 1) * Number(m[2]);
}
const unsigned = (s: string) => s.replace(/^[+−-]/, "");
const counted = (count: string, one: string, many = `${one}s`) => `${count} ${count === "1" ? one : many}`;
const roasValue = (s: string) => (s === "n/a" ? null : parseFloat(s));

/** "was flat (−0.1%)", "was up 15.2%", "was down 8.0%", "started this period". */
function movement(change: string) {
  if (change === "new") return "started this period";
  const v = pctValue(change);
  if (v === null) return `changed ${change}`;
  if (v === 0) return "was flat";
  if (Math.abs(v) < 1) return `was flat (${change})`;
  return `was ${v > 0 ? "up" : "down"} ${unsigned(change)}`;
}

/** Deterministic report used when no model is configured (or the model call fails). */
export function templateReport(f: Facts): string {
  const lines: string[] = [];
  const t = f.totals;
  const c = f.changeVsPreviousPeriod;
  const model = f.attributionModelLabel.toLowerCase();
  const vs = f.period.days === 7 ? "the previous week" : `the previous ${f.period.days} days`;

  lines.push("## Summary");
  if (isZero(t.spend)) {
    lines.push(
      `**${f.period.label}:** no ad spend was recorded. You earned **${t.revenue}** in revenue` +
        (isZero(t.revenue) ? "." : `, and revenue ${movement(c.revenue)} on ${vs}.`),
    );
  } else {
    const credited = isZero(t.revenueAttributedToAds)
      ? "none of it attributed to ads yet"
      : `**${t.revenueAttributedToAds}** of it attributed to ads for a **${t.roas}** return on ad spend (${model} attribution)`;
    lines.push(
      `**${f.period.label}:** you spent **${t.spend}** on ads and earned **${t.revenue}** in revenue, ${credited}. ` +
        `Spend ${movement(c.spend)} and revenue ${movement(c.revenue)} on ${vs}.`,
    );
  }

  lines.push("", "## What's working");
  const winners = f.topCampaigns.filter((x) => (roasValue(x.roas) ?? 0) >= 1);
  if (winners.length === 0) lines.push("- No campaign returned more than it spent in this period.");
  for (const w of winners) lines.push(`- **${w.name}** (${w.platform}): ${w.revenue} in revenue on ${w.spend} of spend, a ${w.roas} return.`);

  lines.push("", "## Wasted spend");
  if (f.wastedSpend.length === 0) lines.push("- Nothing obvious: every campaign with meaningful spend produced revenue.");
  for (const w of f.wastedSpend) {
    const noLeads = isZero(w.leads);
    const leads = noLeads ? "no leads" : counted(w.leads, "lead");
    const result = !isZero(w.revenue)
      ? `for ${w.revenue} in revenue (${w.roas} ROAS) and ${leads}`
      : noLeads
        ? "with no leads and no attributed revenue"
        : `for ${leads} but no attributed revenue`;
    lines.push(`- **${w.name}** (${w.platform}): ${w.spend} spent ${result}.`);
  }

  lines.push("", "## Recommendations");
  let i = 1;
  const worst = f.wastedSpend[0];
  if (worst) {
    const why = isZero(worst.revenue) ? `${worst.spend} spent with no attributed revenue` : `${worst.spend} spent at a ${worst.roas} ROAS`;
    lines.push(`${i++}. Pause or rework **${worst.name}**: ${why}.`);
  }
  if (winners[0]) lines.push(`${i++}. Shift budget toward **${winners[0].name}**, your top revenue earner at a ${winners[0].roas} ROAS.`);
  if (t.unattributedShare !== "n/a" && parseFloat(t.unattributedShare) > 20) {
    lines.push(`${i++}. ${t.unattributedShare} of revenue has no tracked source. Make sure the pixel is on every landing page and the visitor ID is passed to checkout.`);
  }
  lines.push(`${i++}. Check the model comparison before cutting prospecting campaigns: they often start journeys that retargeting and brand search finish.`);
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
