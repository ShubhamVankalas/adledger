// Pure helpers behind <CountUp/> (components/count-up.tsx): split an already formatted number
// ("$41,294", "2.35x", "−12.5%", "$41.3K") into prefix / digits / suffix so the digits can be
// animated while the surrounding symbols stay exactly as the formatter wrote them.

export type CountParts = {
  prefix: string;
  suffix: string;
  /** The numeric magnitude (sign stays in the prefix, e.g. "−$"). */
  value: number;
  decimals: number;
  grouped: boolean;
};

// Exactly one run of digits (with optional thousands commas and decimals); anything else ("12:30",
// "3 of 40", "—", "1.2.3") is left alone and never animated.
const COUNTABLE = /^(\D*)(\d[\d,]*(?:\.\d+)?)(\D*)$/;
const GROUPED = /^\d{1,3}(,\d{3})+(\.\d+)?$/;

export function parseCountable(text: string): CountParts | null {
  const m = COUNTABLE.exec(text);
  if (!m) return null;
  const digits = m[2];
  const grouped = digits.includes(",");
  // "1,23" or "12,3456" are not en-US thousands groups: don't guess.
  if (grouped && !GROUPED.test(digits)) return null;
  const value = Number(digits.replaceAll(",", ""));
  if (!Number.isFinite(value)) return null;
  return { prefix: m[1], suffix: m[3], value, decimals: digits.split(".")[1]?.length ?? 0, grouped };
}

/** Render `n` in the same shape as the original text (same decimals, same grouping, same symbols). */
export function formatCount(parts: CountParts, n: number): string {
  const body = n.toLocaleString("en-US", { minimumFractionDigits: parts.decimals, maximumFractionDigits: parts.decimals, useGrouping: parts.grouped });
  return `${parts.prefix}${body}${parts.suffix}`;
}
