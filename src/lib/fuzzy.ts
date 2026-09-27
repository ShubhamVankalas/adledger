// Tiny fuzzy matcher for the command palette (no dependency). Scores how well a query matches a
// label plus optional keywords; 0 means "no match". Every word of the query must match somewhere:
// an exact label beats a prefix, a prefix beats a word start, a word start beats a substring, and
// a loose subsequence on the label ("intgr" → "Integrations") is the last resort. Keywords only
// count for prefix, word-start and substring hits, so short queries don't match everything.

const WORD = /[\s/·:&,._-]+/;

function wordScore(word: string, text: string, words: string[], loose: boolean): number {
  if (text === word) return 100;
  if (text.startsWith(word)) return 80;
  if (words.some((w) => w.startsWith(word))) return 60;
  if (text.includes(word)) return 40;
  // Subsequence from a word start: "intgr" → "Integrations", but "pri" ↛ "Profile & security".
  if (loose && word.length >= 4 && words.some((w, i) => w[0] === word[0] && isSubsequence(word, words.slice(i).join(" ")))) return 15;
  return 0;
}

function isSubsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (let j = 0; j < hay.length && i < needle.length; j++) if (hay[j] === needle[i]) i++;
  return i === needle.length;
}

export function normalize(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Score `query` against a label (weighted fully) and keywords (weighted lower). */
export function fuzzyScore(query: string, label: string, keywords: readonly string[] = []): number {
  const q = normalize(query);
  if (!q) return 1;
  const l = normalize(label);
  const lWords = l.split(WORD).filter(Boolean);
  const k = keywords.map(normalize);
  const kWords = k.flatMap((x) => x.split(WORD)).filter(Boolean);
  // A whole-query hit on the label outranks word-by-word matching.
  if (l === q) return 1000;
  if (l.startsWith(q)) return 900 - Math.min(l.length, 100);
  let total = 0;
  for (const word of q.split(WORD).filter(Boolean)) {
    const onLabel = wordScore(word, l, lWords, true);
    const onKeywords = Math.max(0, ...k.map((kw) => wordScore(word, kw, kWords, false))) * 0.7;
    const best = Math.max(onLabel, onKeywords);
    if (best === 0) return 0;
    total += best;
  }
  // Shorter labels win ties ("Ads" before "Ad sets" for "ad").
  return total - Math.min(l.length, 60) / 100;
}
