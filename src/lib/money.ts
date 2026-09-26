// Money is always integer minor units (cents, paise, yen...) + ISO 4217 code. Never floats.

const EXPONENTS: Record<string, number> = {
  // zero-decimal
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0, PYG: 0,
  RWF: 0, UGX: 0, UYI: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  // three-decimal
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
};

export function currencyExponent(currency: string): number {
  return EXPONENTS[currency.toUpperCase()] ?? 2;
}

/** Google Ads micros (1/1,000,000 of a unit) -> minor units, rounded half away from zero. */
export function fromMicros(micros: number | string | bigint, currency: string): number {
  const m = BigInt(micros);
  const divisor = 10n ** BigInt(6 - currencyExponent(currency));
  const neg = m < 0n;
  const abs = neg ? -m : m;
  let q = abs / divisor;
  if ((abs % divisor) * 2n >= divisor) q += 1n;
  return Number(neg ? -q : q);
}

/**
 * Decimal string in major units ("123.45", as returned by Meta) -> minor units.
 * Parsed as a string so no binary floating point is involved.
 */
export function fromDecimalString(value: string | number, currency: string): number {
  const s = String(value).trim();
  const match = /^(-)?(\d*)(?:\.(\d*))?$/.exec(s);
  if (!match || (!match[2] && !match[3])) throw new Error(`Invalid decimal amount: ${s}`);
  const exp = currencyExponent(currency);
  const neg = match[1] === "-";
  const whole = BigInt(match[2] || "0");
  const frac = (match[3] ?? "").padEnd(exp + 1, "0");
  let minor = whole * 10n ** BigInt(exp) + BigInt(frac.slice(0, exp) || "0");
  if (Number(frac[exp] ?? "0") >= 5) minor += 1n;
  return Number(neg ? -minor : minor);
}

/**
 * Split `totalMinor` across `weights` so the parts sum exactly to the total
 * (largest-remainder method). Ties go to the earliest index. Negative totals
 * (refunds) are split by magnitude and re-signed.
 */
export function allocate(totalMinor: number, weights: number[]): number[] {
  if (!Number.isSafeInteger(totalMinor)) throw new Error("totalMinor must be a safe integer");
  if (weights.length === 0) return [];
  if (weights.some((w) => !(w >= 0) || !Number.isFinite(w))) {
    throw new Error("weights must be finite and >= 0");
  }
  // Integer arithmetic throughout: weights are scaled to integers, shares use BigInt.
  let w = weights.map((x) => BigInt(Math.round(x * 1e9)));
  if (w.every((x) => x === 0n)) w = weights.map(() => 1n);
  const wSum = w.reduce((a, b) => a + b, 0n);

  const sign = totalMinor < 0 ? -1 : 1;
  const total = BigInt(Math.abs(totalMinor));
  const parts = w.map((x) => (total * x) / wSum);
  const rems = w.map((x) => (total * x) % wSum);
  let remainder = total - parts.reduce((a, b) => a + b, 0n);
  const order = rems
    .map((r, i) => ({ i, r }))
    .sort((a, b) => (b.r > a.r ? 1 : b.r < a.r ? -1 : a.i - b.i));
  for (let k = 0; remainder > 0n; k++, remainder--) parts[order[k].i] += 1n;
  return parts.map((p) => (p === 0n ? 0 : Number(p) * sign));
}

/** Minor units -> localized string, e.g. 123456 USD -> "$1,234.56". */
export function formatMoney(
  minor: number,
  currency: string,
  opts: { compact?: boolean; locale?: string } = {},
): string {
  const exp = currencyExponent(currency);
  const major = minor / 10 ** exp;
  return new Intl.NumberFormat(opts.locale ?? "en-US", {
    style: "currency",
    currency,
    notation: opts.compact ? "compact" : "standard",
    minimumFractionDigits: opts.compact ? 0 : exp,
    maximumFractionDigits: opts.compact ? 1 : exp,
  }).format(major);
}

/** Minor units -> major-unit number, for display/ratios only (never stored). */
export function toMajor(minor: number, currency: string): number {
  return minor / 10 ** currencyExponent(currency);
}
