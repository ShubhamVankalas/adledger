// The AI insight widget quotes the latest weekly report (template or BYO model, numbers already
// verified against the facts pack); it never asks a model for new numbers.

export type InsightBullet = { tone: "good" | "bad" | "action"; text: string };

/** Three highlights from a report's Markdown: a win, a waste, and the first recommendation. */
export function insightBullets(md: string): InsightBullet[] {
  const sections = new Map<string, string[]>();
  let current = "";
  for (const line of md.split("\n")) {
    const h = /^#{1,3}\s+(.+)$/.exec(line.trim());
    if (h) {
      current = h[1].toLowerCase();
      continue;
    }
    const item = /^\s*(?:[-*]|\d+[.)])\s+(.+)$/.exec(line);
    if (item) sections.set(current, [...(sections.get(current) ?? []), item[1].trim()]);
  }
  const first = (match: RegExp) => [...sections.entries()].find(([k]) => match.test(k))?.[1][0];
  const picks: InsightBullet[] = [];
  const good = first(/working|wins?|highlights?/);
  const bad = first(/wasted|waste|problems?|watch/);
  const action = first(/recommend|next|actions?/);
  if (good) picks.push({ tone: "good", text: good });
  if (bad) picks.push({ tone: "bad", text: bad });
  if (action) picks.push({ tone: "action", text: action });
  if (picks.length === 0) for (const items of sections.values()) for (const t of items) if (picks.length < 3) picks.push({ tone: "action", text: t });
  return picks.slice(0, 3);
}
