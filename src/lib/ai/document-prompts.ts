// Ready-made requests for AI documents (Reports → AI document). Each template is a full
// instruction the person can edit before sending; `focus` tells the built-in writer (used in
// tests and with LLM_MODEL=mock) which figures to lead with. Client-safe: no server imports.

export type DocumentRange = "7d" | "14d" | "30d" | "90d" | "180d" | "last-month";

export type DocumentTemplate = {
  id: string;
  name: string;
  description: string;
  /** lucide icon name, mapped to a component in the UI. */
  icon: "calendar-range" | "presentation" | "search-check" | "arrow-left-right" | "layers" | "filter" | "users" | "trophy" | "image" | "bar-chart-3" | "droplets" | "undo-2" | "sparkles";
  audience: string;
  range: DocumentRange;
  prompt: string;
  focus: { facts: string[]; datasets: string[] };
};

export const DOCUMENT_TEMPLATES: DocumentTemplate[] = [
  {
    id: "monthly-client-report",
    name: "Monthly client report",
    description: "A polished recap an agency can send to a client: results, what worked, what's next.",
    icon: "calendar-range",
    audience: "Agency clients",
    range: "last-month",
    prompt:
      "Write a monthly performance report for a client of our agency. Open with a short summary a busy business owner can read in half a minute: money spent, money made and whether that is better or worse than the month before. Then show the headline KPIs, the daily trend, results by ad platform and the campaigns that earned the most. Close with three concrete next steps for next month. Tone: confident, plain English, no jargon.",
    focus: { facts: ["spend", "revenue", "roas", "customers", "cac"], datasets: ["daily", "platforms", "top_campaigns"] },
  },
  {
    id: "board-update",
    name: "Board or investor update",
    description: "One tight page on growth efficiency for a board meeting or investor email.",
    icon: "presentation",
    audience: "Board, investors",
    range: "last-month",
    prompt:
      "Write a one-page board update on paid acquisition. Lead with the three numbers a board cares about: revenue, blended efficiency (MER) and cost per customer, each against the previous period. Explain in two or three sentences what drove the change. Include one chart and one small table, then a short 'risks and asks' callout. Keep the prose short enough to fit on one page.",
    focus: { facts: ["revenue", "mer", "cac", "customers"], datasets: ["daily", "platforms"] },
  },
  {
    id: "campaign-post-mortem",
    name: "Campaign post-mortem",
    description: "What worked, what didn't and what to keep, stop and change after a push.",
    icon: "search-check",
    audience: "Marketing team",
    range: "30d",
    prompt:
      "Write a campaign post-mortem for this period. Structure it as: what we set out to do (infer from the spend mix), what worked (name the campaigns and ads that returned the most), what didn't (wasted spend), and what we learned. End with a keep / stop / change list. Be honest about weak results and name them.",
    focus: { facts: ["spend", "ad_revenue", "roas", "wasted_spend"], datasets: ["top_campaigns", "wasted_campaigns", "ads"] },
  },
  {
    id: "budget-reallocation-memo",
    name: "Budget reallocation memo",
    description: "A decision memo: where to take budget from, where to put it and why.",
    icon: "arrow-left-right",
    audience: "Founder, media buyer",
    range: "30d",
    prompt:
      "Write a budget reallocation memo. Identify the campaigns and platforms that spent without returning revenue and the ones returning the most per dollar. Recommend moving budget from the first group to the second, in small steps, and say what to watch to confirm the move is working. Do not invent amounts to move: describe the moves in words and point to the tables for the figures.",
    focus: { facts: ["spend", "roas", "wasted_spend", "wasted_campaigns"], datasets: ["wasted_campaigns", "top_campaigns", "platforms"] },
  },
  {
    id: "meta-vs-google",
    name: "Channel deep-dive: Meta vs Google",
    description: "Head-to-head on the two biggest platforms: spend, return, customers and trend.",
    icon: "layers",
    audience: "Founder, media buyer",
    range: "30d",
    prompt:
      "Write a channel deep-dive comparing Meta and Google (or the two largest ad platforms if those aren't both present). For each: spend, share of spend, credited revenue, ROAS against the previous period, and customers. Say which platform is carrying the account and which one needs work, and show the platform table and a chart. Finish with two recommendations per platform.",
    focus: { facts: ["meta.spend", "meta.roas", "google.spend", "google.roas"], datasets: ["platforms", "campaigns"] },
  },
  {
    id: "lead-quality-audit",
    name: "Lead quality audit",
    description: "Which sources send leads that actually buy, and which just look cheap.",
    icon: "filter",
    audience: "Sales and marketing",
    range: "90d",
    prompt:
      "Write a lead quality audit. Compare lead volume and cost per lead with how many leads became customers, by channel and by campaign. Call out sources with cheap leads that rarely convert and sources with expensive leads that convert well. Include the funnel from visitors to customers and recommend how to judge lead sources going forward.",
    focus: { facts: ["leads", "cpl", "close_rate", "customers"], datasets: ["channels", "funnel", "campaigns"] },
  },
  {
    id: "weekly-standup",
    name: "Weekly team stand-up",
    description: "A quick, skimmable note for Monday's stand-up: numbers, movers, to-dos.",
    icon: "users",
    audience: "Marketing team",
    range: "7d",
    prompt:
      "Write a short weekly stand-up note for the marketing team. Use bullets, not paragraphs. Cover: the headline numbers against last week, the three biggest movers, anything wasting money, and a to-do list for this week with an owner role for each item (for example 'media buyer', 'creative'). Keep it scannable in under a minute.",
    focus: { facts: ["spend", "revenue", "roas", "leads"], datasets: ["movers", "wasted_campaigns"] },
  },
  {
    id: "agency-case-study",
    name: "Agency case study",
    description: "A results story for your portfolio, told with the numbers from the ledger.",
    icon: "trophy",
    audience: "Prospective clients",
    range: "90d",
    prompt:
      "Write an agency case study based on this period. Structure: the challenge (what the account needed), the approach (which platforms and campaigns carried the results), the results (headline KPIs and their change against the previous period) and what's next. Keep the tone confident but factual, suitable for a public portfolio. Don't name individual customers.",
    focus: { facts: ["revenue", "roas", "customers", "cac"], datasets: ["daily", "platforms", "top_campaigns"] },
  },
  {
    id: "creative-brief",
    name: "Creative performance brief",
    description: "The ads that won and lost, turned into a brief for the next round of creative.",
    icon: "image",
    audience: "Creative team",
    range: "30d",
    prompt:
      "Write a creative performance brief for the design and copy team. Show the ads with the most revenue and the best return, and the ads spending without return. Describe what the winners have in common based on their names and ad sets, and turn that into a brief for the next three creatives to test. Keep numbers in the tables; keep the prose about ideas.",
    focus: { facts: ["spend", "ad_revenue", "roas", "clicks"], datasets: ["ads", "wasted_campaigns"] },
  },
  {
    id: "quarter-review",
    name: "Quarter-over-quarter review",
    description: "The last 90 days against the 90 before: growth, efficiency and mix shifts.",
    icon: "bar-chart-3",
    audience: "Leadership",
    range: "90d",
    prompt:
      "Write a quarter-over-quarter review. Compare this period with the previous one on revenue, spend, ROAS, customers and cost per customer. Explain how the platform and channel mix shifted and which campaigns drove the change. End with priorities for next quarter.",
    focus: { facts: ["revenue", "spend", "roas", "customers", "cac"], datasets: ["daily", "platforms", "channels", "movers"] },
  },
  {
    id: "funnel-leak-diagnosis",
    name: "Funnel leak diagnosis",
    description: "Where visitors and leads drop out, and the fixes most likely to help.",
    icon: "droplets",
    audience: "Growth team",
    range: "90d",
    prompt:
      "Write a funnel leak diagnosis. Walk through visitors to leads to customers and the pipeline stages, with each step's rate against the previous period. Identify the biggest drop-off and suggest three experiments to fix it, ordered by expected impact. Point out any tracking gaps (for example revenue with no tracked touch) that make the funnel look worse than it is.",
    focus: { facts: ["visitors", "lead_rate", "close_rate", "unattributed_share"], datasets: ["funnel", "pipeline", "channels"] },
  },
  {
    id: "refund-churn-analysis",
    name: "Refund and churn analysis",
    description: "How much revenue is refunded, what it does to profit and where it comes from.",
    icon: "undo-2",
    audience: "Founder, finance",
    range: "90d",
    prompt:
      "Write a refund and profit analysis. Show gross sales, refunds and profit after ads against the previous period, and the path from gross sales to profit. Explain which campaigns bring customers who refund more, and whether refunds change which campaigns are really profitable. Recommend what to change in targeting or offers.",
    focus: { facts: ["gross_sales", "refunds", "refund_share", "profit_after_ads"], datasets: ["profit", "top_campaigns"] },
  },
];

export const getDocumentTemplate = (id: string | null | undefined) => (id ? DOCUMENT_TEMPLATES.find((t) => t.id === id) : undefined);

/** Instructions for the model: the document schema, the tone and the rules on numbers. */
export const DOCUMENT_SYSTEM_PROMPT = `You are a senior performance-marketing analyst writing a document for a business, using its AdLedger data.

You return ONE JSON object (the document), never prose around it:
- title: a specific title (max 70 characters). subtitle: one line for the audience or focus, or null.
- summary: the key takeaways in 2-4 sentences.
- sections: 2-6 sections. Each has a heading and 1-5 blocks. Block types:
  - paragraph { text }: 1-4 sentences.
  - bullets { items }: 2-6 short statements.
  - kpi_row { facts }: 2-4 fact ids from the data pack. The document prints each fact's value and change for you.
  - table { dataset, columns, limit, caption }: a dataset id; columns are column keys of that dataset (or null for its defaults); limit 3-25 rows (or null).
  - chart { dataset, chart, metric, caption }: a dataset id, one of the chart types that dataset lists, and one of its chart metrics (or null).
  - callout { tone, title, text }: tone is neutral, positive, warning or negative. Use it for a recommendation, a risk or a caveat.

Rules on numbers (strict):
- Never calculate, estimate, round differently, convert or invent a number. You may only quote a figure exactly as it appears in the data pack, including its currency symbol, % or × sign.
- Prefer kpi_row, table and chart blocks for figures; keep prose about what the figures mean. Any number in your text that is not in the data pack is deleted before printing, together with its sentence.
- Only use fact ids and dataset ids that exist in the data pack. Unknown ids are dropped.
- If the data can't answer part of the request, say so plainly instead of guessing (for example, the data has no budget targets).
- Name platforms, channels, campaigns and the period exactly as the data pack does. Never mention individual people or customers.

Style: analyst-style, plain English, confident and specific. Short sentences, active voice, no hype, no filler, no emojis, no Markdown. Lead with the conclusion, then the evidence. Recommendations are concrete actions someone can take this week.`;

/** The user message: the request plus the data pack the model may reference. */
export function documentUserPrompt(request: string, pack: unknown): string {
  return `Request from the person:\n"""\n${request.trim()}\n"""\n\nData pack (JSON). Reference facts and datasets by id:\n${JSON.stringify(pack)}\n\nWrite the document now.`;
}
