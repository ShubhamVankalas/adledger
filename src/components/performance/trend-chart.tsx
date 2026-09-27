"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { moneyShort, moneyWhole, shortDate } from "@/lib/format";

// Daily spend (bars) against credited revenue (line) for one row of the Performance table. Hand
// SVG instead of Recharts: the peek opens often and should stay light. Long ranges fold into weeks.

type Point = { date: string; spendMinor: number; revenueMinor: number };

const H = 132;
const PAD = { top: 8, right: 4, bottom: 18, left: 4 };

/** Fold daily points into weekly buckets when there are too many bars to read. */
function bucket(points: Point[]): { points: Point[]; weekly: boolean } {
  if (points.length <= 62) return { points, weekly: false };
  const out: Point[] = [];
  for (let i = 0; i < points.length; i += 7) {
    const chunk = points.slice(i, i + 7);
    out.push({
      date: chunk[0].date,
      spendMinor: chunk.reduce((s, p) => s + p.spendMinor, 0),
      revenueMinor: chunk.reduce((s, p) => s + p.revenueMinor, 0),
    });
  }
  return { points: out, weekly: true };
}

export function TrendChart({ data, currency }: { data: Point[]; currency: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { points, weekly } = useMemo(() => bucket(data), [data]);
  const geo = useMemo(() => {
    if (!width || !points.length) return null;
    const max = Math.max(1, ...points.map((p) => Math.max(p.spendMinor, p.revenueMinor)));
    const iw = width - PAD.left - PAD.right;
    const ih = H - PAD.top - PAD.bottom;
    const step = iw / points.length;
    const bw = Math.max(1, Math.min(14, step * 0.62));
    const x = (i: number) => PAD.left + step * i + step / 2;
    const y = (v: number) => PAD.top + ih - (v / max) * ih;
    const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.revenueMinor).toFixed(1)}`).join("");
    const area = `${line}L${x(points.length - 1).toFixed(1)} ${y(0)}L${x(0).toFixed(1)} ${y(0)}Z`;
    return { x, y, bw, step, line, area, ih };
  }, [points, width]);

  const empty = points.every((p) => p.spendMinor === 0 && p.revenueMinor === 0);
  const h = hover !== null ? points[hover] : null;

  return (
    <div>
      <div className="mb-2 flex items-center gap-4 text-caption text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-[2px] bg-chart-spend/60" />
          Spend
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-3 rounded-full bg-chart-revenue" />
          Revenue
        </span>
        {weekly ? <span className="ml-auto">Weekly</span> : null}
      </div>
      <div
        ref={wrap}
        className="relative w-full"
        style={{ height: H }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          if (!geo) return;
          const left = e.currentTarget.getBoundingClientRect().left;
          const i = Math.floor((e.clientX - left - PAD.left) / geo.step);
          setHover(i >= 0 && i < points.length ? i : null);
        }}
      >
        {empty ? (
          <p className="flex h-full items-center justify-center rounded-lg bg-fill/60 text-caption text-muted-foreground">No spend or revenue in this period.</p>
        ) : geo ? (
          <svg width={width} height={H} className="block overflow-visible" role="img" aria-label={`${weekly ? "Weekly" : "Daily"} spend and revenue`}>
            <line x1={PAD.left} x2={width - PAD.right} y1={geo.y(0)} y2={geo.y(0)} className="stroke-chart-grid" />
            {points.map((p, i) => (
              <rect
                key={p.date}
                x={geo.x(i) - geo.bw / 2}
                y={geo.y(p.spendMinor)}
                width={geo.bw}
                height={Math.max(0, geo.y(0) - geo.y(p.spendMinor))}
                rx={Math.min(2, geo.bw / 2)}
                className={hover === i ? "fill-chart-spend/80" : "fill-chart-spend/45"}
              />
            ))}
            <path d={geo.area} className="fill-chart-revenue/10" />
            <path d={geo.line} fill="none" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" className="stroke-chart-revenue" />
            {h && hover !== null ? (
              <>
                <line x1={geo.x(hover)} x2={geo.x(hover)} y1={PAD.top} y2={geo.y(0)} className="stroke-border-strong" strokeDasharray="2 3" />
                <circle cx={geo.x(hover)} cy={geo.y(h.revenueMinor)} r={3} className="fill-card stroke-chart-revenue" strokeWidth={1.5} />
              </>
            ) : null}
            <text x={PAD.left} y={H - 3} className="num fill-fg-faint text-[11px]">
              {shortDate(points[0].date)}
            </text>
            <text x={width - PAD.right} y={H - 3} textAnchor="end" className="num fill-fg-faint text-[11px]">
              {shortDate(points[points.length - 1].date)}
            </text>
          </svg>
        ) : null}
        {h && geo && hover !== null ? (
          <div
            className="pointer-events-none absolute top-0 z-10 w-max -translate-x-1/2 rounded-lg bg-popover px-2.5 py-1.5 text-caption shadow-md"
            style={{ left: Math.min(Math.max(geo.x(hover), 72), width - 72) }}
          >
            <p className="font-medium text-foreground">{weekly ? `Week of ${shortDate(h.date)}` : shortDate(h.date)}</p>
            <p className="num text-muted-foreground">
              Spend <span className="text-foreground">{moneyWhole(h.spendMinor, currency)}</span> · Revenue{" "}
              <span className="text-foreground">{moneyWhole(h.revenueMinor, currency)}</span>
            </p>
          </div>
        ) : null}
      </div>
      <p className="sr-only">
        {`Total spend ${moneyShort(
          data.reduce((s, p) => s + p.spendMinor, 0),
          currency,
        )}, total revenue ${moneyShort(
          data.reduce((s, p) => s + p.revenueMinor, 0),
          currency,
        )}.`}
      </p>
    </div>
  );
}
