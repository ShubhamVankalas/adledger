// Post-check: every number the model writes must come from the facts pack.

const NUM_RE = /-?\d[\d,]*(?:\.\d+)?/g;

function canonical(raw: string): number | null {
  const v = Number(raw.replace(/,/g, ""));
  return Number.isFinite(v) ? v : null;
}

function collect(value: unknown, into: Set<string>) {
  if (typeof value === "number") addVariants(value, into);
  else if (typeof value === "string") for (const m of value.match(NUM_RE) ?? []) {
    const v = canonical(m);
    if (v !== null) addVariants(v, into);
  }
  else if (Array.isArray(value)) value.forEach((v) => collect(v, into));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => collect(v, into));
}

function addVariants(v: number, into: Set<string>) {
  const abs = Math.abs(v);
  for (const x of [v, abs]) {
    into.add(String(x));
    for (const d of [0, 1, 2]) into.add(String(Number(x.toFixed(d))));
    // compact forms the model may use: 12.3k / 1.2M
    if (x >= 1000) for (const d of [0, 1, 2]) into.add(String(Number((x / 1000).toFixed(d))));
    if (x >= 1_000_000) for (const d of [0, 1, 2]) into.add(String(Number((x / 1_000_000).toFixed(d))));
  }
}

/** Returns the numbers in `text` that don't appear in `facts` (ignoring small counts and dates). */
export function unverifiedNumbers(text: string, facts: unknown): string[] {
  const allowed = new Set<string>();
  collect(facts, allowed);
  const withoutDates = text.replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ");
  const bad = new Set<string>();
  for (const m of withoutDates.match(NUM_RE) ?? []) {
    const v = canonical(m);
    if (v === null) continue;
    const abs = Math.abs(v);
    if (Number.isInteger(abs) && abs <= 10) continue; // "top 3 campaigns", "7 days"
    if (Number.isInteger(abs) && abs >= 1990 && abs <= 2100) continue; // years
    if (!allowed.has(String(v)) && !allowed.has(String(abs))) bad.add(m);
  }
  return [...bad];
}
