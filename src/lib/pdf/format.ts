import { toMajor } from "../money";
import { SUPPORTED_SYMBOL_CHARS } from "./fonts";

// Print formatting. Same rules as src/lib/format.ts (whole units in tables, compact on tiles,
// "—" for no value, 3.25× for ratios, a real minus sign) with one print-specific twist: a
// currency symbol the embedded font can't draw is replaced by its ISO code.

const MINUS = "−";
const withMinus = (s: string) => s.replace(/^-/, MINUS).replace(/(\s)-/, `$1${MINUS}`);

const displayCache = new Map<string, "symbol" | "code">();
function currencyDisplay(currency: string): "symbol" | "code" {
  let d = displayCache.get(currency);
  if (!d) {
    const symbol = new Intl.NumberFormat("en-US", { style: "currency", currency }).formatToParts(0).find((p) => p.type === "currency")?.value ?? currency;
    d = [...symbol].every((c) => SUPPORTED_SYMBOL_CHARS.has(c)) ? "symbol" : "code";
    displayCache.set(currency, d);
  }
  return d;
}

function fmt(major: number, currency: string, o: Intl.NumberFormatOptions) {
  return withMinus(new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: currencyDisplay(currency), ...o }).format(major));
}

/** Whole units ($57,875); cents below 10; compact from 10M. */
export function moneyWhole(minor: number | null | undefined, currency: string): string {
  if (minor === null || minor === undefined) return "—";
  const major = toMajor(minor, currency);
  const abs = Math.abs(major);
  const small = abs > 0 && abs < 10 && !Number.isInteger(major);
  return fmt(major, currency, {
    notation: abs >= 10_000_000 ? "compact" : "standard",
    minimumFractionDigits: small ? 2 : 0,
    maximumFractionDigits: small ? 2 : abs >= 10_000_000 ? 1 : 0,
  });
}

/** Compact money for tiles and axis ticks: "$786", "$41.3K". */
export function moneyShort(minor: number | null | undefined, currency: string): string {
  if (minor === null || minor === undefined) return "—";
  const major = toMajor(minor, currency);
  if (Math.abs(major) < 1000) return moneyWhole(minor, currency);
  return fmt(major, currency, { notation: "compact", maximumFractionDigits: 1 });
}

/** Signed money difference: "+$1.2K", "−$340". */
export function moneyDelta(minor: number, currency: string): string {
  return `${minor > 0 ? "+" : minor < 0 ? MINUS : ""}${moneyShort(Math.abs(minor), currency)}`;
}

/** "3.25×", "0×", "—" when there was no spend. */
export function ratioX(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const s = v.toFixed(2);
  return s === "0.00" || s === "-0.00" ? "0×" : `${withMinus(s)}×`;
}

export function pct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const s = (v * 100).toFixed(digits);
  return Number(s) === 0 ? `${(0).toFixed(digits)}%` : `${withMinus(s)}%`;
}

export function signedPct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const s = Math.abs(v * 100).toFixed(digits);
  if (Number(s) === 0) return "0%";
  return `${v > 0 ? "+" : MINUS}${s}%`;
}

export function num(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return withMinus(new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(v));
}

export function compactNum(v: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
}

/** Credited counts: whole from 10 up, one decimal below. */
export const credit = (v: number | null | undefined) => (v === null || v === undefined ? "—" : num(v, Math.abs(v) >= 10 ? 0 : 1));

/** Relative change (cur vs prev), null when there's nothing to compare against. */
export function change(cur: number | null | undefined, prev: number | null | undefined): number | null {
  if (cur === null || cur === undefined || prev === null || prev === undefined || prev === 0) return null;
  return (cur - prev) / Math.abs(prev);
}

const day = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00Z`);
// Fixed three-letter months (ICU's en-GB prints "Sept"), day-first like a ledger.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "27 Sep 2026" */
export const longDate = (d: string) => {
  const t = day(d);
  return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}`;
};
/** "27 Sep" */
export const shortDate = (d: string) => {
  const t = day(d);
  return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}`;
};
/** "Sep 2026" */
export const monthLabel = (ym: string) => {
  const t = day(`${ym}-01`);
  return `${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}`;
};
/** "Sep ’26" (compact column headers). */
export const monthShort = (ym: string) => {
  const t = day(`${ym}-01`);
  return `${MONTHS[t.getUTCMonth()]} ’${String(t.getUTCFullYear()).slice(2)}`;
};

/** "1 – 27 Sep 2026", "28 Aug – 26 Sep 2026", "28 Dec 2025 – 3 Jan 2026". */
export function dateRange(start: string, end: string): string {
  const a = day(start);
  const b = day(end);
  if (start === end) return longDate(start);
  if (a.getUTCFullYear() !== b.getUTCFullYear()) return `${longDate(start)} – ${longDate(end)}`;
  if (a.getUTCMonth() === b.getUTCMonth()) return `${a.getUTCDate()} – ${longDate(end)}`;
  return `${shortDate(start)} – ${longDate(end)}`;
}

/**
 * Make a user-supplied string safe to print: strip control and bidi-override characters,
 * collapse whitespace, and cap the length. Everything user-controlled (campaign, workspace and
 * organization names) goes through this before it reaches the PDF, in text or inside a chart.
 */
export function safeText(value: unknown, max = 120): string {
  const s = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}
