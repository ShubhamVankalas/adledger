"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { moneyShort, plural } from "@/lib/format";
import { ratioX } from "@/lib/metrics";
import type { PerfRowV2, Quadrant } from "@/lib/reports-performance";
import { cn } from "@/lib/utils";

// Scale / Test / Fix / Kill: every row with spend as a bubble. x = spend (log scale when spends
// differ by more than 20×), y = ROAS, bubble area = revenue. The lines split at the median spend
// and at the ROAS bar (the workspace target, or break-even 1×). Click a bubble to peek.

export const QUADRANTS: Record<Quadrant, { label: string; hint: string; fill: string; stroke: string; text: string; dot: string }> = {
  scale: { label: "Scale", hint: "Big spend that pays back", fill: "fill-positive/20", stroke: "stroke-positive", text: "text-positive", dot: "border-positive bg-positive/20" },
  test: { label: "Test", hint: "Pays back on small spend: try more", fill: "fill-brand/15", stroke: "stroke-brand", text: "text-brand-foreground", dot: "border-brand bg-brand/15" },
  fix: { label: "Fix", hint: "Small spend, not paying back yet", fill: "fill-warning/20", stroke: "stroke-warning", text: "text-warning-foreground", dot: "border-warning bg-warning/20" },
  kill: { label: "Kill", hint: "Big spend that doesn't pay back", fill: "fill-negative/15", stroke: "stroke-negative", text: "text-negative", dot: "border-negative bg-negative/15" },
};
const ORDER: Quadrant[] = ["scale", "test", "fix", "kill"];

const PAD = { top: 16, right: 20, bottom: 36, left: 48 };

function niceLogTicks(min: number, max: number): number[] {
  const out: number[] = [];
  for (let p = Math.floor(Math.log10(min)); p <= Math.ceil(Math.log10(max)); p++) {
    for (const m of [1, 2, 5]) {
      const v = m * 10 ** p;
      if (v >= min && v <= max) out.push(v);
    }
  }
  return out;
}

function niceLinearTicks(max: number, count = 4): number[] {
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

export function QuadrantChart({
  rows,
  split,
  currency,
  noun,
  roasLabel,
  onPeek,
  peekId,
}: {
  rows: PerfRowV2[];
  split: { spendMinor: number; roas: number };
  currency: string;
  /** Plural noun for the rows ("campaigns"). */
  noun: string;
  /** "break-even" or "target". */
  roasLabel: string;
  onPeek: (id: string) => void;
  peekId: string | null;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const placed = useMemo(() => rows.filter((r) => (r.spendMinor ?? 0) > 0 && r.quadrant), [rows]);
  const height = width < 520 ? 300 : 380;
  const geo = useMemo(() => {
    if (!placed.length || !width) return null;
    const spends = placed.map((r) => r.spendMinor!);
    const minS = Math.min(...spends);
    const maxS = Math.max(...spends);
    const log = maxS / Math.max(1, minS) > 20;
    const x0 = log ? minS / 1.4 : 0;
    const x1 = log ? maxS * 1.4 : maxS * 1.08;
    const roasValues = placed.map((r) => r.roas ?? 0).sort((a, b) => a - b);
    // Cap the axis at the 95th percentile so one outlier doesn't squash everything else.
    const p95 = roasValues[Math.min(roasValues.length - 1, Math.floor(roasValues.length * 0.95))];
    const yMax = Math.max(split.roas * 2, p95 * 1.15, 0.5);
    const iw = width - PAD.left - PAD.right;
    const ih = height - PAD.top - PAD.bottom;
    const x = (v: number) => PAD.left + (log ? (Math.log10(v) - Math.log10(x0)) / (Math.log10(x1) - Math.log10(x0)) : (v - x0) / (x1 - x0)) * iw;
    const y = (v: number) => PAD.top + ih - (Math.min(v, yMax) / yMax) * ih;
    const maxRev = Math.max(1, ...placed.map((r) => Math.max(0, r.revenueMinor ?? 0)));
    const rMax = width < 520 ? 14 : 20;
    const r = (rev: number) => 3.5 + Math.sqrt(Math.max(0, rev) / maxRev) * rMax;
    const xTicks = log ? niceLogTicks(x0, x1) : niceLinearTicks(x1, width < 520 ? 3 : 5).filter((t) => t > 0);
    const yTicks = niceLinearTicks(yMax, 4);
    return { x, y, r, xTicks, yTicks, yMax, iw, ih, log, sx: x(Math.max(split.spendMinor, x0)), sy: y(split.roas) };
  }, [placed, width, height, split]);

  const summary = useMemo(() => {
    const total = placed.reduce((s, r) => s + (r.spendMinor ?? 0), 0);
    return ORDER.map((q) => {
      const list = placed.filter((r) => r.quadrant === q);
      const spend = list.reduce((s, r) => s + (r.spendMinor ?? 0), 0);
      return { q, count: list.length, spend, share: total ? spend / total : 0 };
    });
  }, [placed]);

  const hovered = geo && hover ? placed.find((r) => r.id === hover) : null;
  // Big bubbles first so small ones stay clickable on top.
  const drawOrder = useMemo(() => [...placed].sort((a, b) => (b.revenueMinor ?? 0) - (a.revenueMinor ?? 0)), [placed]);
  const hidden = rows.length - placed.length;

  return (
    <div className="space-y-3">
      <div className="surface-card rounded-xl p-3 md:p-4">
        <div ref={wrap} className="relative w-full" style={{ height }}>
          {!placed.length ? (
            <p className="flex h-full items-center justify-center text-ui text-muted-foreground">No {noun} with spend in this period.</p>
          ) : geo ? (
            <svg width={width} height={height} role="group" aria-label={`Spend against ROAS for ${plural(placed.length, noun.replace(/s$/, ""), noun)}`} className="block overflow-visible">
              {/* Quadrant tints */}
              <rect x={geo.sx} y={PAD.top} width={PAD.left + geo.iw - geo.sx} height={geo.sy - PAD.top} className="fill-positive/[0.04]" />
              <rect x={geo.sx} y={geo.sy} width={PAD.left + geo.iw - geo.sx} height={PAD.top + geo.ih - geo.sy} className="fill-negative/[0.04]" />
              {/* Grid */}
              {geo.yTicks.map((t) => (
                <g key={`y${t}`}>
                  <line x1={PAD.left} x2={PAD.left + geo.iw} y1={geo.y(t)} y2={geo.y(t)} className="stroke-chart-grid" />
                  <text x={PAD.left - 8} y={geo.y(t)} dy="0.32em" textAnchor="end" className="num fill-fg-faint text-[11px]">
                    {ratioX(t, t >= 10 || Number.isInteger(t) ? 0 : 1)}
                  </text>
                </g>
              ))}
              {geo.xTicks.map((t) => (
                <text key={`x${t}`} x={geo.x(t)} y={PAD.top + geo.ih + 20} textAnchor="middle" className="num fill-fg-faint text-[11px]">
                  {moneyShort(t, currency)}
                </text>
              ))}
              <text x={PAD.left + geo.iw} y={height - 2} textAnchor="end" className="fill-muted-foreground text-[11px]">
                Spend{geo.log ? " (log scale)" : ""} →
              </text>
              {/* Split lines */}
              <line x1={geo.sx} x2={geo.sx} y1={PAD.top} y2={PAD.top + geo.ih} strokeDasharray="3 4" className="stroke-border-strong" />
              <line x1={PAD.left} x2={PAD.left + geo.iw} y1={geo.sy} y2={geo.sy} strokeDasharray="3 4" className="stroke-border-strong" />
              <text x={PAD.left + 6} y={geo.sy - 6} className="num fill-muted-foreground text-[11px]">
                {ratioX(split.roas)} {roasLabel}
              </text>
              {/* Corner labels */}
              <CornerLabel q="test" x={PAD.left + 6} y={PAD.top + 14} anchor="start" />
              <CornerLabel q="scale" x={PAD.left + geo.iw - 6} y={PAD.top + 14} anchor="end" />
              <CornerLabel q="fix" x={PAD.left + 6} y={PAD.top + geo.ih - 8} anchor="start" />
              <CornerLabel q="kill" x={PAD.left + geo.iw - 6} y={PAD.top + geo.ih - 8} anchor="end" />
              {/* Bubbles */}
              {drawOrder.map((row) => {
                const q = QUADRANTS[row.quadrant!];
                const active = hover === row.id || peekId === row.id;
                return (
                  <circle
                    key={row.id}
                    cx={geo.x(row.spendMinor!)}
                    cy={geo.y(row.roas ?? 0)}
                    r={geo.r(row.revenueMinor ?? 0)}
                    role="button"
                    tabIndex={0}
                    aria-label={`${row.name}: ${moneyShort(row.spendMinor, currency)} spend, ${ratioX(row.roas)} ROAS, ${q.label}`}
                    className={cn(q.fill, q.stroke, "cursor-pointer outline-none transition-[stroke-width,fill-opacity] duration-100", active ? "stroke-2" : "stroke-1")}
                    onMouseEnter={() => setHover(row.id)}
                    onMouseLeave={() => setHover((h) => (h === row.id ? null : h))}
                    onFocus={() => setHover(row.id)}
                    onBlur={() => setHover((h) => (h === row.id ? null : h))}
                    onClick={() => onPeek(row.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onPeek(row.id);
                      }
                    }}
                  />
                );
              })}
            </svg>
          ) : null}
          {hovered && geo ? (
            <div
              role="status"
              className="pointer-events-none absolute z-10 w-max max-w-64 -translate-x-1/2 -translate-y-full rounded-lg bg-popover px-2.5 py-2 text-caption shadow-md"
              style={{ left: Math.min(Math.max(geo.x(hovered.spendMinor!), 120), width - 120), top: geo.y(hovered.roas ?? 0) - geo.r(hovered.revenueMinor ?? 0) - 8 }}
            >
              <p className="truncate font-medium text-foreground">{hovered.name}</p>
              <p className={cn("font-medium", QUADRANTS[hovered.quadrant!].text)}>{QUADRANTS[hovered.quadrant!].label}</p>
              <dl className="num mt-1 grid grid-cols-[auto_auto] gap-x-3 text-muted-foreground">
                <dt>Spend</dt>
                <dd className="text-right text-foreground">{moneyShort(hovered.spendMinor, currency)}</dd>
                <dt>Revenue</dt>
                <dd className="text-right text-foreground">{moneyShort(hovered.revenueMinor, currency)}</dd>
                <dt>ROAS</dt>
                <dd className="text-right text-foreground">{ratioX(hovered.roas)}</dd>
              </dl>
            </div>
          ) : null}
        </div>
      </div>
      <ul className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="Quadrant summary">
        {summary.map(({ q, count, spend, share }) => (
          <li key={q} className="surface-card rounded-lg px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-ui font-medium">
              <span aria-hidden className={cn("size-2 rounded-full border", QUADRANTS[q].dot)} />
              {QUADRANTS[q].label}
              <span className="num ml-auto font-normal text-muted-foreground">{count}</span>
            </p>
            <p className="mt-0.5 text-caption text-muted-foreground">{QUADRANTS[q].hint}</p>
            <p className="num mt-1.5 text-caption text-muted-foreground">
              <span className="font-medium text-foreground">{moneyShort(spend, currency)}</span> spend · {Math.round(share * 100)}%
            </p>
          </li>
        ))}
      </ul>
      {hidden > 0 ? (
        <p className="text-caption text-muted-foreground">
          {plural(hidden, noun.replace(/s$/, ""), noun)} without spend in this period {hidden === 1 ? "isn't" : "aren't"} plotted.
        </p>
      ) : null}
    </div>
  );
}

function CornerLabel({ q, x, y, anchor }: { q: Quadrant; x: number; y: number; anchor: "start" | "end" }) {
  const d = QUADRANTS[q];
  return (
    <text x={x} y={y} textAnchor={anchor} className={cn("fill-current text-[11px] font-medium tracking-[0.04em] uppercase", d.text)} opacity={0.85}>
      {d.label}
    </text>
  );
}
