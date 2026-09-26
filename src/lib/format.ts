// Client-safe formatting helpers (no server imports).
import { formatMoney, toMajor } from "./money";

export const money = (minor: number | null | undefined, currency: string, compact = false) =>
  minor === null || minor === undefined ? "—" : formatMoney(minor, currency, { compact });

/** Whole units for headline numbers ($57,875 instead of $57,874.93), compact above 10M. */
export const moneyKpi = (minor: number | null | undefined, currency: string) => {
  if (minor === null || minor === undefined) return "—";
  const major = toMajor(minor, currency);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: Math.abs(major) >= 10_000_000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(major) >= 1000 ? 0 : 2,
  }).format(major);
};

export const roas = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v.toFixed(2)}x`);

export const pct = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined ? "—" : `${(v * 100).toFixed(digits)}%`;

export const num = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined
    ? "—"
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(v);

export const compactNum = (v: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);

export function delta(cur: number | null, prev: number | null): number | null {
  if (cur === null || prev === null || prev === 0) return null;
  return (cur - prev) / Math.abs(prev);
}

export const CHANNEL_LABELS: Record<string, string> = {
  paid_social: "Paid social",
  paid_search: "Paid search",
  organic: "Organic",
  referral: "Referral",
  direct: "Direct",
  email: "Email",
  unattributed: "Unattributed",
};

export const MODEL_LABELS: Record<string, string> = {
  first_touch: "First touch",
  last_touch: "Last touch",
  linear: "Linear",
};

export function timeAgo(date: string | Date | null | undefined): string {
  if (!date) return "never";
  const s = Math.round((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
