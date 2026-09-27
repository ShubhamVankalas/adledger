import type { ReportKindId } from "@/lib/report-kinds/types";
import { cn } from "@/lib/utils";

// Miniature of each PDF's first page, drawn as inline SVG (no image assets, no PDF rendering in
// the browser). Shapes mirror the real layout: masthead, cover title, then the kind's signature
// chart. Colours follow the report's meaning: green revenue, slate spend, red waste.

const text = "fill-foreground/12";
const faint = "fill-foreground/[0.07]";

function Lines({ x, y, widths, gap = 4.5, h = 2 }: { x: number; y: number; widths: number[]; gap?: number; h?: number }) {
  return (
    <>
      {widths.map((w, i) => (
        <rect key={i} x={x} y={y + i * gap} width={w} height={h} rx={1} className={text} />
      ))}
    </>
  );
}

/** Masthead + cover block shared by every thumbnail. */
function Cover({ w }: { w: number }) {
  return (
    <>
      <rect x={8} y={7} width={5} height={5} rx={1.2} className="fill-emerald-600" />
      <rect x={15} y={8.5} width={18} height={2} rx={1} className={text} />
      <rect x={w - 34} y={8.5} width={26} height={1.6} rx={0.8} className={faint} />
      <rect x={8} y={15} width={w - 16} height={0.5} className="fill-foreground/10" />
      <rect x={8} y={20} width={6} height={1} rx={0.5} className="fill-emerald-600" />
      <rect x={8} y={24} width={22} height={1.4} rx={0.7} className={faint} />
      <rect x={8} y={28} width={40} height={4.5} rx={1.2} className="fill-foreground/70" />
      <rect x={8} y={35.5} width={46} height={1.6} rx={0.8} className={text} />
    </>
  );
}

function Tiles({ x, y, cols, rows, w, h, spark = true }: { x: number; y: number; cols: number; rows: number; w: number; h: number; spark?: boolean }) {
  const gap = 2.5;
  const tw = (w - gap * (cols - 1)) / cols;
  const out = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const tx = x + c * (tw + gap);
      const ty = y + r * (h + gap);
      out.push(
        <g key={`${r}-${c}`}>
          <rect x={tx} y={ty} width={tw} height={h} rx={1.5} className="fill-card stroke-foreground/10" strokeWidth={0.4} />
          <rect x={tx + 2.5} y={ty + 2.5} width={tw * 0.35} height={1.3} rx={0.6} className={faint} />
          <rect x={tx + 2.5} y={ty + 5.5} width={tw * 0.55} height={3} rx={0.8} className="fill-foreground/55" />
          {spark ? (
            <polyline
              points={`${tx + 2.5},${ty + h - 3} ${tx + tw * 0.3},${ty + h - 5} ${tx + tw * 0.5},${ty + h - 3.8} ${tx + tw * 0.72},${ty + h - 6} ${tx + tw - 2.5},${ty + h - 4.5}`}
              fill="none"
              strokeWidth={0.6}
              strokeLinejoin="round"
              className={(r + c) % 3 === 0 ? "stroke-slate-400" : "stroke-emerald-500"}
            />
          ) : null}
        </g>,
      );
    }
  return <>{out}</>;
}

function Combo({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const n = 14;
  const bw = (w / n) * 0.6;
  const rev = [0.45, 0.7, 0.5, 0.8, 0.62, 0.9, 0.55, 0.68, 0.95, 0.6, 0.78, 0.7, 0.88, 0.74];
  const pts = rev.map((v, i) => `${x + (i + 0.5) * (w / n)},${y + h - v * h}`).join(" ");
  return (
    <>
      {[0.33, 0.66].map((t) => (
        <rect key={t} x={x} y={y + h * t} width={w} height={0.3} className="fill-foreground/10" />
      ))}
      {rev.map((_, i) => (
        <rect key={i} x={x + (i + 0.5) * (w / n) - bw / 2} y={y + h - h * 0.28} width={bw} height={h * 0.28} rx={0.4} className="fill-slate-400/45" />
      ))}
      <polygon points={`${x + 0.5 * (w / n)},${y + h} ${pts} ${x + (n - 0.5) * (w / n)},${y + h}`} className="fill-emerald-500/10" />
      <polyline points={pts} fill="none" strokeWidth={0.8} strokeLinejoin="round" className="stroke-emerald-500" />
    </>
  );
}

function TableRows({ x, y, w, rows, gap = 5 }: { x: number; y: number; w: number; rows: number; gap?: number }) {
  return (
    <>
      <rect x={x} y={y} width={w} height={3.5} className="fill-foreground/[0.05]" />
      {Array.from({ length: rows }, (_, i) => (
        <g key={i}>
          <rect x={x + 1.5} y={y + 6 + i * gap} width={w * 0.34} height={1.6} rx={0.8} className={text} />
          <rect x={x + w * 0.56} y={y + 6 + i * gap} width={w * 0.1} height={1.6} rx={0.8} className={faint} />
          <rect x={x + w * 0.72} y={y + 6 + i * gap} width={w * 0.1} height={1.6} rx={0.8} className={faint} />
          <rect x={x + w * 0.88} y={y + 6 + i * gap} width={w * 0.1} height={1.6} rx={0.8} className={faint} />
          <rect x={x} y={y + 9 + i * gap} width={w} height={0.3} className="fill-foreground/[0.07]" />
        </g>
      ))}
    </>
  );
}

function Executive() {
  return (
    <>
      <Cover w={120} />
      <rect x={8} y={41} width={104} height={11} rx={1.8} className="fill-foreground/[0.04]" />
      <Lines x={11} y={43.5} widths={[88, 70, 78]} gap={2.8} h={1.2} />
      <Tiles x={8} y={56} cols={3} rows={2} w={104} h={15} />
      <Combo x={8} y={92} w={104} h={24} />
      <TableRows x={8} y={121} w={50} rows={3} />
      <TableRows x={62} y={121} w={50} rows={3} />
      <rect x={8} y={143} width={104} height={0.4} className="fill-foreground/10" />
      <Lines x={8} y={146} widths={[46, 40]} gap={3} h={1.1} />
    </>
  );
}

function Weekly() {
  return (
    <>
      <Cover w={120} />
      <Tiles x={8} y={42} cols={4} rows={2} w={104} h={11} spark={false} />
      <Combo x={8} y={71} w={104} h={26} />
      <Lines x={8} y={103} widths={[56, 50, 58, 44]} gap={4} h={1.4} />
      <rect x={8} y={121} width={58} height={10} rx={1.5} className="fill-amber-400/20" />
      <rect x={8} y={121} width={1.2} height={10} className="fill-amber-500" />
      <circle cx={88} cy={115} r={10} fill="none" strokeWidth={4} className="stroke-emerald-500" strokeDasharray="36 63" />
      <circle cx={88} cy={115} r={10} fill="none" strokeWidth={4} className="stroke-blue-500/80" strokeDasharray="27 63" strokeDashoffset={-36} />
      <TableRows x={8} y={136} w={104} rows={3} gap={4.5} />
    </>
  );
}

function Attribution() {
  const lines: [number, number, string][] = [
    [52, 88, "stroke-emerald-500"],
    [84, 60, "stroke-blue-500"],
    [74, 70, "stroke-blue-500"],
    [92, 94, "stroke-foreground/30"],
    [98, 102, "stroke-emerald-500"],
    [104, 106, "stroke-foreground/30"],
  ];
  return (
    <>
      <Cover w={120} />
      <rect x={8} y={42} width={104} height={10} rx={1.8} className="fill-card stroke-foreground/10" strokeWidth={0.4} />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <rect key={i} x={11 + i * 17} y={45.5} width={11} height={3} rx={0.8} className={i >= 4 ? (i === 4 ? "fill-emerald-500/70" : "fill-blue-500/70") : "fill-foreground/45"} />
      ))}
      <rect x={30} y={58} width={0.4} height={52} className="fill-foreground/15" />
      <rect x={70} y={58} width={0.4} height={52} className="fill-foreground/15" />
      {lines.map(([a, b, cls], i) => (
        <g key={i}>
          <line x1={30} y1={a} x2={70} y2={b} strokeWidth={0.9} className={cls} />
          <rect x={74} y={b - 0.8} width={30 - i * 2} height={1.4} rx={0.7} className={faint} />
        </g>
      ))}
      <rect x={8} y={115} width={50} height={16} rx={1.5} className="fill-emerald-500/10" />
      <rect x={62} y={115} width={50} height={16} rx={1.5} className="fill-foreground/[0.04]" />
      <Lines x={11} y={118} widths={[34, 42, 38]} gap={3.5} h={1.2} />
      <Lines x={65} y={118} widths={[30, 40, 26]} gap={3.5} h={1.2} />
      <TableRows x={8} y={136} w={104} rows={3} gap={4.5} />
    </>
  );
}

function Ltv() {
  const ramp = ["fill-emerald-100", "fill-emerald-200", "fill-emerald-300", "fill-emerald-500", "fill-emerald-600", "fill-emerald-700"];
  return (
    <>
      <rect x={8} y={7} width={5} height={5} rx={1.2} className="fill-emerald-600" />
      <rect x={15} y={8.5} width={18} height={2} rx={1} className={text} />
      <rect x={126} y={8.5} width={26} height={1.6} rx={0.8} className={faint} />
      <rect x={8} y={15} width={144} height={0.5} className="fill-foreground/10" />
      <rect x={8} y={20} width={6} height={1} rx={0.5} className="fill-emerald-600" />
      <rect x={8} y={24} width={40} height={4} rx={1.2} className="fill-foreground/70" />
      <rect x={8} y={31} width={60} height={1.5} rx={0.75} className={text} />
      {Array.from({ length: 6 }, (_, r) =>
        Array.from({ length: 8 - r }, (_, c) => <rect key={`${r}-${c}`} x={20 + c * 12} y={39 + r * 6.5} width={11.2} height={5.7} rx={0.8} className={ramp[Math.min(5, Math.floor((c + 1) * 0.7) + 1 - (r > 3 ? 1 : 0))]} />),
      )}
      {Array.from({ length: 6 }, (_, r) => (
        <rect key={r} x={8} y={41 + r * 6.5} width={9} height={1.5} rx={0.75} className={faint} />
      ))}
      <polyline points="10,112 26,100 44,94 62,90 80,88" fill="none" strokeWidth={0.8} className="stroke-emerald-500" />
      <polyline points="10,110 26,101 44,97 62,95" fill="none" strokeWidth={0.8} className="stroke-blue-500" />
      <polyline points="10,111 26,104 44,101" fill="none" strokeWidth={0.8} className="stroke-amber-500" />
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          <rect x={92} y={86 + i * 6} width={16} height={1.5} rx={0.75} className={faint} />
          <rect x={112} y={85.5 + i * 6} width={36} height={3} rx={0.8} className="fill-foreground/[0.05]" />
          <rect x={112} y={85.5 + i * 6} width={[16, 20, 36, 5, 3][i]} height={3} rx={0.8} className={i >= 3 ? "fill-red-500/70" : "fill-emerald-500/80"} />
        </g>
      ))}
    </>
  );
}

function Waste() {
  return (
    <>
      <Cover w={120} />
      <rect x={8} y={42} width={104} height={10} rx={1.8} className="fill-card stroke-foreground/10" strokeWidth={0.4} />
      <rect x={11} y={45.5} width={14} height={3} rx={0.8} className="fill-red-500/70" />
      {[1, 2, 3, 4].map((i) => (
        <rect key={i} x={11 + i * 21} y={45.5} width={11} height={3} rx={0.8} className="fill-foreground/45" />
      ))}
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <circle cx={11} cy={60 + i * 9} r={2} className="fill-foreground/[0.07]" />
          <rect x={16} y={58.5 + i * 9} width={70 - i * 8} height={1.8} rx={0.9} className={text} />
          <rect x={16} y={62 + i * 9} width={56} height={1.2} rx={0.6} className={faint} />
          <rect x={74} y={61.8 + i * 9} width={14} height={1.6} rx={0.6} className="fill-emerald-500/60" />
        </g>
      ))}
      {[40, 28, 26, 23, 13].map((w, i) => (
        <g key={i}>
          <rect x={8} y={90 + i * 5} width={24} height={1.5} rx={0.75} className={faint} />
          <rect x={40} y={89.5 + i * 5} width={62} height={2.6} rx={0.6} className="fill-foreground/[0.05]" />
          <rect x={40} y={89.5 + i * 5} width={w * 1.5} height={2.6} rx={0.6} className="fill-red-500/75" />
        </g>
      ))}
      <TableRows x={8} y={119} w={104} rows={5} gap={4.5} />
    </>
  );
}

const DRAW: Record<ReportKindId, () => React.ReactElement> = {
  "executive-summary": Executive,
  "weekly-performance": Weekly,
  "attribution-models": Attribution,
  "ltv-cohorts": Ltv,
  "wasted-spend": Waste,
};

/** The paper sits low in the frame and is cropped at the bottom, like a page peeking out of a tray. */
export function ReportThumbnail({ kind, orientation, className }: { kind: ReportKindId; orientation: "portrait" | "landscape"; className?: string }) {
  const Draw = DRAW[kind];
  const landscape = orientation === "landscape";
  return (
    <div aria-hidden className={cn("relative h-44 overflow-hidden bg-muted/60 sm:h-48", className)}>
      <svg
        viewBox={landscape ? "0 0 160 120" : "0 0 120 160"}
        className={cn(
          "absolute left-1/2 -translate-x-1/2 rounded-[3px] bg-card shadow-[0_0_0_1px_oklch(0.2_0.02_165/0.08),0_8px_24px_-8px_oklch(0.2_0.02_165/0.18)] transition-transform duration-200 ease-out group-hover/report:-translate-y-1 motion-reduce:transition-none dark:shadow-[0_0_0_1px_oklch(1_0_0/0.08),0_8px_24px_-8px_oklch(0_0_0/0.5)]",
          landscape ? "top-6 w-[66%] max-w-72" : "top-5 w-[46%] max-w-52",
        )}
      >
        <Draw />
      </svg>
    </div>
  );
}
