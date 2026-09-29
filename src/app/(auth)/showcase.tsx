import { CircleDollarSignIcon, PlugZapIcon, ShieldCheckIcon, SparklesIcon, TargetIcon, type LucideIcon } from "lucide-react";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";

// Brand panel for the auth pages: full showcase on lg+, a compact header below. Everything is built from
// the design tokens (--brand, --brand-2, --brand-gradient), so organization themes and dark mode carry
// through. The surface is always dark so white text keeps its contrast whatever the theme. Keyframes live
// in globals.css ("Auth showcase"); prefers-reduced-motion collapses them to their end state.

const promise = "Know which ad actually made you money.";

const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

const surface = {
  "--on-brand": "color-mix(in oklch, var(--brand) 42%, white)",
  backgroundColor: "color-mix(in oklch, var(--brand) 26%, oklch(0.16 0.014 165))",
} as React.CSSProperties;

/** Gradient wash, drifting glows, grid and grain. Purely decorative. */
function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 opacity-45" style={{ backgroundImage: "var(--brand-gradient)" }} />
      <div className="absolute -top-1/4 -right-1/4 size-[70%] animate-[al-drift_18s_ease-in-out_infinite] rounded-full bg-brand/35 blur-3xl" />
      <div className="absolute -bottom-1/3 -left-1/4 size-[65%] animate-[al-drift_22s_ease-in-out_infinite_reverse] rounded-full bg-[var(--brand-2)]/25 blur-3xl" />
      <div
        className="absolute inset-0 opacity-70 [mask-image:radial-gradient(ellipse_at_70%_30%,black,transparent_75%)]"
        style={{
          backgroundImage: "linear-gradient(to right, oklch(1 0 0 / 0.07) 1px, transparent 1px), linear-gradient(to bottom, oklch(1 0 0 / 0.07) 1px, transparent 1px)",
          backgroundSize: "36px 36px",
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-black/10" />
      <div className="absolute inset-0 opacity-[0.16] mix-blend-overlay" style={{ backgroundImage: GRAIN }} />
    </div>
  );
}

/** Below lg: a slim brand header with the logo and the promise, above the form. */
export function ShowcaseHeader() {
  return (
    <header className="relative isolate overflow-hidden rounded-b-3xl px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-6 text-white sm:px-8 sm:pb-7 lg:hidden" style={surface}>
      <Backdrop />
      <div className="relative mx-auto flex w-full max-w-md flex-col gap-3 sm:max-w-lg">
        <Logo inverse />
        <p className="max-w-[22rem] text-lg leading-snug font-semibold tracking-[-0.015em] text-balance sm:text-xl">{promise}</p>
      </div>
    </header>
  );
}

const FEATURES: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: TargetIcon, title: "Attribution that adds up", body: "Ad spend, site visits, leads and Stripe revenue joined in one ledger." },
  { icon: CircleDollarSignIcon, title: "Profit per ad", body: "ROAS, CAC and profit down to the single ad, not just the campaign." },
  { icon: SparklesIcon, title: "Ask in plain English", body: "Bring your own AI model. Every number still comes from SQL." },
  { icon: PlugZapIcon, title: "Built-in MCP server", body: "Read-only access for Claude, ChatGPT or any MCP client." },
];

/** lg+: the full panel, sticky beside the (possibly long) form. */
export function Showcase() {
  return (
    <aside
      aria-label="About AdLedger"
      className="relative isolate hidden overflow-hidden text-white lg:sticky lg:top-0 lg:flex lg:self-start lg:h-svh lg:flex-col lg:justify-between lg:gap-8 lg:p-10 xl:p-12"
      style={surface}
    >
      <Backdrop />
      <Logo inverse className="relative" />

      <div className="relative flex min-h-0 flex-col gap-7 xl:gap-9">
        <div className="grid max-w-xl gap-3">
          <h2 className="text-4xl leading-[1.08] font-semibold tracking-[-0.03em] text-balance xl:text-[2.75rem]">{promise}</h2>
          <p className="max-w-md text-body/[1.375rem] text-pretty text-white/80 [@media(max-height:50rem)]:hidden">
            Open-source attribution that ties every dollar of ad spend to the revenue it brought in, on a server you own.
          </p>
        </div>

        <MiniDashboard />

        <ul className="grid max-w-xl grid-cols-2 gap-x-6 gap-y-5 [@media(max-height:47rem)]:hidden">
          {FEATURES.map((f) => (
            <li key={f.title} className="flex gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-(--on-brand) ring-1 ring-white/15 ring-inset">
                <f.icon aria-hidden className="size-4" />
              </span>
              <span className="grid content-start gap-0.5">
                <span className="text-ui font-medium">{f.title}</span>
                <span className="text-caption text-white/75">{f.body}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <p className="relative flex flex-wrap items-center gap-x-2.5 gap-y-1 text-caption text-white/80">
        <ShieldCheckIcon aria-hidden className="size-4 text-(--on-brand)" />
        <span>Self-hosted</span>
        <Dot />
        <span>Your data stays yours</span>
        <Dot />
        <span>Open source</span>
      </p>
    </aside>
  );
}

function Dot() {
  return <span aria-hidden className="size-[3px] rounded-full bg-white/50" />;
}

// ---------------------------------------------------------------------------------------------------
// Animated mini dashboard: revenue line draws in, KPI chips and ad rows rise, the end point pings.

const REVENUE = "M0 98 C22 96 38 84 62 86 S102 68 130 70 S176 80 204 58 S252 46 280 36 S344 24 372 15 L400 8";
const SPEND = "M0 108 C40 106 70 101 110 102 S190 94 230 96 S320 86 400 82";

const KPIS = [
  { label: "ROAS", value: "4.2x" },
  { label: "Ad spend", value: "$11.5k" },
  { label: "Leads", value: "312" },
];

const ADS = [
  { name: "Lookalike 1% · Meta", value: "$21.4k", width: 1, tone: "win" },
  { name: "Brand search · Google", value: "$14.8k", width: 0.69, tone: "win" },
  { name: "Retargeting · Meta", value: "$8.6k", width: 0.4, tone: "win" },
  { name: "Broad cold · Meta", value: "-$1.2k", width: 0.14, tone: "loss" },
] as const;

const rise = "animate-[al-rise_0.7s_var(--ease-out)_both]";

function MiniDashboard() {
  return (
    <div aria-hidden className="relative w-full max-w-[30rem] select-none">
      <div className="pointer-events-none absolute -top-4 right-3 z-10 animate-[al-rise_0.7s_var(--ease-out)_1.9s_both]">
        <div className="flex animate-[al-float_5s_ease-in-out_infinite] items-center gap-2 rounded-full border border-white/20 bg-black/40 py-1.5 pr-3 pl-2 text-micro text-white shadow-lg backdrop-blur-md">
          <span className="flex size-4 items-center justify-center rounded-full bg-(--on-brand) text-[0.6rem] leading-none font-bold text-black/80">$</span>
          <span>
            New sale <b className="font-semibold tabular-nums">$129</b> from Lookalike 1%
          </span>
        </div>
      </div>

      <div className={cn("rounded-2xl border border-white/15 bg-white/[0.07] p-4 shadow-2xl shadow-black/30 backdrop-blur-md", rise)} style={{ animationDelay: "150ms" }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-micro tracking-[0.04em] text-white/70 uppercase">Revenue · 30 days</p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-kpi-lg tabular-nums">$48,210</span>
              <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-micro font-medium text-(--on-brand) tabular-nums">+18.4%</span>
            </div>
          </div>
          <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-2 py-1 text-micro text-white/85">
            <span className="relative flex size-1.5">
              <span className="absolute inset-0 animate-[al-ping_2s_ease-out_infinite] rounded-full bg-(--on-brand)" />
              <span className="relative size-1.5 rounded-full bg-(--on-brand)" />
            </span>
            Live
          </span>
        </div>

        <div className="relative mt-3">
          <svg viewBox="0 0 400 120" preserveAspectRatio="none" className="block h-24 w-full overflow-visible">
            <defs>
              <linearGradient id="al-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" style={{ stopColor: "var(--on-brand)", stopOpacity: 0.38 }} />
                <stop offset="1" style={{ stopColor: "var(--on-brand)", stopOpacity: 0 }} />
              </linearGradient>
            </defs>
            {[30, 60, 90].map((y) => (
              <line key={y} x1="0" x2="400" y1={y} y2={y} stroke="white" strokeOpacity="0.09" vectorEffect="non-scaling-stroke" />
            ))}
            <path d={`${REVENUE} L400 120 L0 120 Z`} fill="url(#al-area)" className="animate-[al-fade_1.2s_ease-out_1.1s_both]" />
            <path
              d={SPEND}
              fill="none"
              className="animate-[al-fade_1.2s_ease-out_0.9s_both] stroke-white/45"
              strokeWidth="1.5"
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={REVENUE}
              fill="none"
              className="animate-[al-draw_2.2s_var(--ease-out)_0.3s_both] stroke-(--on-brand)"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength={1}
              strokeDasharray={1}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <span className="absolute top-[6.67%] right-0 flex size-2.5 -translate-y-1/2 translate-x-1/2 animate-[al-fade_0.4s_ease-out_2.3s_both]">
            <span className="absolute inset-0 animate-[al-ping_2.4s_ease-out_2.4s_infinite] rounded-full bg-(--on-brand)" />
            <span className="relative size-2.5 rounded-full bg-(--on-brand) ring-2 ring-black/30" />
          </span>
          <div className="mt-1.5 flex items-center gap-3 text-micro text-white/70">
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded-full bg-(--on-brand)" /> Revenue
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 border-t border-dashed border-white/60" /> Ad spend
            </span>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          {KPIS.map((k, i) => (
            <div key={k.label} className={cn("rounded-lg bg-white/[0.07] px-2.5 py-2 ring-1 ring-white/10 ring-inset", rise)} style={{ animationDelay: `${700 + i * 110}ms` }}>
              <p className="text-micro text-white/70">{k.label}</p>
              <p className="text-title-sm tabular-nums">{k.value}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-2.5 border-t border-white/10 pt-3 [@media(max-height:60rem)]:hidden">
          {ADS.map((a, i) => (
            <div key={a.name} className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1", rise)} style={{ animationDelay: `${1100 + i * 110}ms` }}>
              <span className="truncate text-caption text-white/85">{a.name}</span>
              <span className={cn("text-caption font-medium tabular-nums", a.tone === "loss" ? "text-[oklch(0.86_0.09_25)]" : "text-white")}>{a.value}</span>
              <span className="col-span-2 h-1 overflow-hidden rounded-full bg-white/10">
                <span
                  className={cn("block h-full origin-left animate-[al-grow_1s_var(--ease-out)_both] rounded-full", a.tone === "loss" ? "bg-[oklch(0.78_0.12_25)]" : "bg-(--on-brand)")}
                  style={{ width: `${a.width * 100}%`, animationDelay: `${1300 + i * 110}ms` }}
                />
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
