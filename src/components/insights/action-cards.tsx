import { ArrowRightIcon, CircleGaugeIcon, RadarIcon, TrendingDownIcon, TrendingUpIcon, ScissorsIcon, ShuffleIcon } from "lucide-react";
import Link from "next/link";
import type { ActionCard, Segment } from "@/lib/reports-insights";
import { cn } from "@/lib/utils";

const KIND = {
  shift: { icon: ShuffleIcon, label: "Move budget" },
  cut: { icon: ScissorsIcon, label: "Losing money" },
  scale: { icon: TrendingUpIcon, label: "Room to grow" },
  drop: { icon: TrendingDownIcon, label: "Dropped" },
  cac: { icon: CircleGaugeIcon, label: "Costs up" },
  tracking: { icon: RadarIcon, label: "Tracking" },
} satisfies Record<ActionCard["kind"], { icon: typeof ShuffleIcon; label: string }>;

const ICON_TONE: Record<ActionCard["tone"], string> = {
  opportunity: "bg-positive-soft text-positive",
  warning: "bg-warning-soft text-warning-foreground",
  info: "bg-fill text-muted-foreground",
};

/**
 * A figure inside a sentence that links to the report row it came from. Colour only when the
 * number is a gain or a loss, always alongside the sign or ratio that says so.
 */
export function NumberChip({ text, href, tone }: { text: string; href: string; tone?: "good" | "bad" }) {
  return (
    <Link
      href={href}
      title="Open the report this number comes from"
      className={cn(
        "num mx-px inline rounded-[4px] bg-fill px-1 py-px font-medium whitespace-nowrap [box-decoration-break:clone] transition-colors duration-100 outline-none hover:bg-fill-active focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
        tone === "good" ? "text-positive" : tone === "bad" ? "text-negative" : "text-foreground",
      )}
    >
      {text}
    </Link>
  );
}

function Text({ segments }: { segments: Segment[] }) {
  return segments.map((s, i) =>
    typeof s === "string" ? (
      <span key={i}>{s}</span>
    ) : s.kind === "name" ? (
      // Names read as links; the chips are for figures.
      <Link key={i} href={s.href} className="rounded-sm font-medium text-foreground underline decoration-border-strong underline-offset-[3px] transition-colors duration-100 hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring">
        {s.text}
      </Link>
    ) : (
      <NumberChip key={i} text={s.text} href={s.href} tone={s.tone} />
    ),
  );
}

/** Three to five read-only recommendations. Every number is a door to the row behind it. */
export function ActionCards({ cards, caption }: { cards: ActionCard[]; caption: string }) {
  return (
    <section aria-labelledby="moves-title" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="moves-title" className="text-title-sm">
          What to look at
        </h2>
        <p className="text-caption text-muted-foreground">{caption}</p>
      </div>
      {cards.length ? (
        <ul className="grid gap-3 md:grid-cols-2">
          {cards.map((c) => {
            const k = KIND[c.kind];
            return (
              <li key={c.id} className="flex min-w-0 flex-col rounded-xl bg-card shadow-(--elev-card)">
                <div className="flex min-w-0 flex-1 flex-col gap-2 px-4 pt-4 pb-3 md:px-5">
                  <p className="flex items-center gap-2 text-caption font-medium text-muted-foreground">
                    <span className={cn("flex size-6 items-center justify-center rounded-md", ICON_TONE[c.tone])}>
                      <k.icon aria-hidden className="size-3.5" />
                    </span>
                    {k.label}
                  </p>
                  <p className="text-body leading-7 font-medium text-pretty">
                    <Text segments={c.title} />
                  </p>
                  <p className="text-ui leading-6 text-pretty text-muted-foreground">
                    <Text segments={c.evidence} />
                  </p>
                </div>
                <div className="border-t px-4 py-2.5 md:px-5">
                  <Link
                    href={c.action.href}
                    className="-mx-1.5 inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-ui font-medium text-foreground transition-colors duration-100 hover:bg-fill focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:h-10"
                  >
                    {c.action.label}
                    <ArrowRightIcon aria-hidden className="size-3.5 text-muted-foreground" />
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="flex items-start gap-3 rounded-xl bg-card px-4 py-4 shadow-(--elev-card) md:px-5">
          <CircleGaugeIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="text-ui font-medium">Nothing needs your attention</p>
            <p className="text-ui text-pretty text-muted-foreground">No campaign is losing money at a scale worth acting on, and costs are steady. Cards appear here when that changes.</p>
          </div>
        </div>
      )}
    </section>
  );
}
