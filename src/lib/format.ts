// Client-safe formatting helpers (no server imports). Display only: data stays in integer
// minor units and exact credited counts; these functions decide how a number reads on screen.
//
// Money
//   money()      exact, with cents — individual payments and anything a user reconciles.
//   moneyWhole() whole units ($41,294) — tables, headline KPIs, unit costs (CPL, CAC, LTV).
//                Keeps cents only below 10 so $4.50 never reads as "$5". Compact from 10M.
//   moneyShort() compact ($41.3K; $786 below 1,000) — secondary text, chips, dense cards.
// Counts
//   credit()     credited leads/customers. Linear attribution splits a person across touches,
//                so counts can be fractional: whole numbers from 10 up, one decimal below.
//                CSV exports keep the exact value.
// Ratios
//   roas()       "2.35x", "0x" when nothing came back, "—" when there was no spend.
//   pct() / signedPct() use a real minus sign (−) and one decimal by default.
import { formatMoney, toMajor } from "./money";

const MINUS = "−";
const withMinus = (s: string) => s.replace(/^-/, MINUS);

export const money = (minor: number | null | undefined, currency: string, compact = false) =>
  minor === null || minor === undefined ? "—" : withMinus(formatMoney(minor, currency, { compact }));

/** Whole currency units ($57,875, not $57,874.93); cents below 10; compact from 10M. */
export const moneyWhole = (minor: number | null | undefined, currency: string) => {
  if (minor === null || minor === undefined) return "—";
  const major = toMajor(minor, currency);
  const abs = Math.abs(major);
  const small = abs > 0 && abs < 10 && !Number.isInteger(major);
  return withMinus(
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: abs >= 10_000_000 ? "compact" : "standard",
      minimumFractionDigits: small ? 2 : 0,
      maximumFractionDigits: small ? 2 : abs >= 10_000_000 ? 1 : 0,
    }).format(major),
  );
};

/** Headline numbers on KPI cards. Same rule as tables so a figure reads the same everywhere. */
export const moneyKpi = moneyWhole;

/** Compact money for secondary text and dense cards: "$786" under 1,000, "$41.3K" above. */
export const moneyShort = (minor: number | null | undefined, currency: string) => {
  if (minor === null || minor === undefined) return "—";
  if (Math.abs(toMajor(minor, currency)) < 1000) return moneyWhole(minor, currency);
  return withMinus(formatMoney(minor, currency, { compact: true }));
};

/** Signed money for differences: "+$1.2K", "−$340", "$0" (`whole: true` → "+$1,234"). */
export const moneyDelta = (minor: number, currency: string, opts: { whole?: boolean } = {}) =>
  `${minor > 0 ? "+" : minor < 0 ? MINUS : ""}${(opts.whole ? moneyWhole : moneyShort)(Math.abs(minor), currency)}`;

export const roas = (v: number | null | undefined) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const s = v.toFixed(2);
  return s === "0.00" || s === "-0.00" ? "0x" : `${withMinus(s)}x`;
};

export const pct = (v: number | null | undefined, digits = 1) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const s = (v * 100).toFixed(digits);
  return Number(s) === 0 ? `${(0).toFixed(digits)}%` : `${withMinus(s)}%`;
};

/** Change as a signed percentage: "+15.2%", "−0.1%", "0%". `v` is a ratio (0.152). */
export const signedPct = (v: number | null | undefined, digits = 1) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const s = Math.abs(v * 100).toFixed(digits);
  if (Number(s) === 0) return "0%";
  return `${v > 0 ? "+" : MINUS}${s}%`;
};

export const num = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined
    ? "—"
    : withMinus(new Intl.NumberFormat("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(v));

export const compactNum = (v: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);

/** Credited count (leads, customers): whole from 10 up, one decimal below ("0.5", "4.5", "52"). */
export const credit = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : num(v, Math.abs(v) >= 10 ? 0 : 1);

/** True when a credited count isn't a whole number (it came from multi-touch credit). */
export const isFractional = (v: number | null | undefined) =>
  v !== null && v !== undefined && Math.abs(v - Math.round(v)) > 1e-9;

export const FRACTIONAL_NOTE = "Fractional credit from multi-touch attribution";

/** Tooltip for a credited count that was rounded or is fractional: the exact value and why. */
export const creditTitle = (v: number | null | undefined, noun: string) =>
  isFractional(v) ? `${num(v, 2)} ${noun} credited · ${FRACTIONAL_NOTE.toLowerCase()}` : undefined;

/** "1 lead", "2.5 leads", "244 leads": singular only when the number shown is exactly 1. */
export const countLabel = (v: number, one: string, many = `${one}s`) => {
  const s = credit(v);
  return `${s} ${s === "1" ? one : many}`;
};

/** "1 campaign", "11 campaigns" for whole counts. */
export const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;

export function delta(cur: number | null, prev: number | null): number | null {
  if (cur === null || prev === null || prev === 0) return null;
  return (cur - prev) / Math.abs(prev);
}

// Dates. Report dates are calendar days ("YYYY-MM-DD") already in the workspace timezone.
const day = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00Z`);
const fmt = (d: string, opts: Intl.DateTimeFormatOptions) => day(d).toLocaleDateString("en-US", { timeZone: "UTC", ...opts });

/** "Sep 20" */
export const shortDate = (d: string) => fmt(d, { month: "short", day: "numeric" });
/** "Sep 20, 2026" */
export const longDate = (d: string) => fmt(d, { month: "short", day: "numeric", year: "numeric" });

/**
 * "Sep 20 – 26", "Aug 29 – Sep 26", "Dec 28, 2025 – Jan 3, 2026". `year: true` adds the year
 * to single-year ranges too ("Sep 20 – 26, 2026").
 */
export function dateRange(start: string, end: string, opts: { year?: boolean } = {}) {
  const a = day(start);
  const b = day(end);
  const y = opts.year ? `, ${b.getUTCFullYear()}` : "";
  if (start.slice(0, 10) === end.slice(0, 10)) return `${shortDate(start)}${y}`;
  if (a.getUTCFullYear() !== b.getUTCFullYear()) return `${longDate(start)} – ${longDate(end)}`;
  if (a.getUTCMonth() === b.getUTCMonth()) return `${shortDate(start)} – ${b.getUTCDate()}${y}`;
  return `${shortDate(start)} – ${shortDate(end)}${y}`;
}

/** Inclusive number of calendar days in a report period. */
export const periodDays = (start: string, end: string) => Math.round((day(end).getTime() - day(start).getTime()) / 86_400_000) + 1;

export const PLATFORM_LABELS: Record<string, string> = {
  meta: "Meta",
  google: "Google",
  microsoft: "Microsoft",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  pinterest: "Pinterest",
  snapchat: "Snapchat",
  reddit: "Reddit",
  x: "X",
  other: "Other",
};

const titleCase = (s: string) => s.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export const platformLabel = (id: string | null | undefined) => (id ? (PLATFORM_LABELS[id] ?? titleCase(id)) : "—");

export const CHANNEL_LABELS: Record<string, string> = {
  paid_social: "Paid social",
  paid_search: "Paid search",
  organic: "Organic",
  referral: "Referral",
  direct: "Direct",
  email: "Email",
  unattributed: "Unattributed",
};

export const channelLabel = (id: string | null | undefined) => (id ? (CHANNEL_LABELS[id] ?? titleCase(id)) : "—");

export const MODEL_LABELS: Record<string, string> = {
  first_touch: "First touch",
  last_touch: "Last touch",
  linear: "Linear",
};

const LLM_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Gemini",
  ollama: "Ollama",
  lmstudio: "LM Studio",
  openrouter: "OpenRouter",
  deepseek: "DeepSeek",
};

/** Who wrote an AI report: "Rule-based" for the built-in template, else "gpt-5-mini via OpenAI". */
export function reportSourceLabel(modelName: string | null | undefined): string {
  if (!modelName || modelName === "template") return "Rule-based";
  const [provider, ...rest] = modelName.split("/");
  const model = rest.join("/");
  if (!model) return modelName;
  const via = LLM_LABELS[provider];
  return via ? `${model} via ${via}` : model;
}

export function timeAgo(date: string | Date | null | undefined): string {
  if (!date) return "never";
  const s = Math.round((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
