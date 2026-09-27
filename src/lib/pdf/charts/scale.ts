// Scales for the PDF chart kit: "nice" ticks (1, 2, 2.5, 5 × 10^n), linear and band scales.
// Pure number maths, no d3. Every coordinate a chart draws comes from here, so no string from
// report data ever reaches a drawing attribute.

/** Step size that yields about `count` ticks across `span`, rounded to 1, 2, 2.5 or 5 × 10^n. */
export function niceStep(span: number, count: number): number {
  if (!(span > 0) || !Number.isFinite(span)) return 1;
  const raw = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return nice * mag;
}

export type Ticks = { min: number; max: number; step: number; ticks: number[] };

/**
 * Nice axis bounds and ticks covering [min, max]. The domain always includes 0 when the data
 * is all positive or all negative (bars must start at zero), unless `includeZero` is false.
 */
export function niceTicks(min: number, max: number, count = 4, opts: { includeZero?: boolean } = {}): Ticks {
  let lo = Number.isFinite(min) ? min : 0;
  let hi = Number.isFinite(max) ? max : 0;
  if (opts.includeZero !== false) {
    lo = Math.min(0, lo);
    hi = Math.max(0, hi);
  }
  // No data at all: just a zero baseline (fractional ticks would read "$0.00, $0.00…").
  if (lo === 0 && hi === 0) return { min: 0, max: 1, step: 1, ticks: [0] };
  if (lo === hi) {
    // Flat data: give it some room so the line sits mid-chart instead of on an edge.
    if (lo > 0) {
      hi = hi * 1.5;
      lo = opts.includeZero === false ? lo * 0.5 : 0;
    } else {
      lo = lo * 1.5;
      hi = opts.includeZero === false ? hi * 0.5 : 0;
    }
  }
  const step = niceStep(hi - lo, count);
  const nMin = Math.floor(lo / step + 1e-9) * step;
  const nMax = Math.ceil(hi / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = nMin, i = 0; v <= nMax + step * 1e-9 && i < 50; v += step, i++) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toPrecision(12)));
  return { min: nMin, max: nMax, step, ticks };
}

/** Linear map from `domain` to `range`. */
export function linear(domain: [number, number], range: [number, number]) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  return (v: number) => r0 + (v - d0) * k;
}

/** Evenly spaced bands (bars) across `range` with `padding` (0–1) between them. */
export function band(n: number, range: [number, number], padding = 0.25) {
  const [r0, r1] = range;
  const count = Math.max(1, n);
  const stepW = (r1 - r0) / count;
  const width = stepW * (1 - padding);
  return { step: stepW, width, x: (i: number) => r0 + i * stepW + (stepW - width) / 2, center: (i: number) => r0 + i * stepW + stepW / 2 };
}

/** Point positions for a series across `n` evenly spaced x slots (first and last at the edges). */
export function pointX(n: number, range: [number, number]) {
  const [r0, r1] = range;
  return (i: number) => (n <= 1 ? (r0 + r1) / 2 : r0 + (i * (r1 - r0)) / (n - 1));
}

/** Pick at most `max` evenly spaced label indexes out of `n` (always the first and last). */
export function labelIndexes(n: number, max: number): number[] {
  if (n <= 0) return [];
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const out = new Set<number>([0, n - 1]);
  const step = (n - 1) / (max - 1);
  for (let k = 1; k < max - 1; k++) out.add(Math.round(k * step));
  return [...out].sort((a, b) => a - b);
}

/** Clamp to finite numbers (NaN/Infinity become 0) so a bad value can't break a path. */
export const finite = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Round a coordinate to 2 decimals (keeps PDFs small and paths deterministic). */
export const r2 = (v: number) => Math.round(v * 100) / 100;
