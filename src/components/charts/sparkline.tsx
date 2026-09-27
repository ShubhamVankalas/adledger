import { cn } from "@/lib/utils";

// Server-rendered SVG sparkline: no Recharts, no JavaScript. Days without a value (a ratio on a
// day with no spend) leave a gap instead of dropping to zero.

const W = 160;
const H = 24;

function path(values: (number | null)[], max: number, min: number): string {
  if (values.length < 2) return "";
  const span = max - min || 1;
  const step = W / (values.length - 1);
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) {
      pen = false;
      return;
    }
    const x = (i * step).toFixed(1);
    const y = (H - 1 - ((v - min) / span) * (H - 2)).toFixed(1);
    d += `${pen ? "L" : "M"}${x} ${y}`;
    pen = true;
  });
  return d;
}

export function Sparkline({
  values,
  previous,
  color,
  className,
}: {
  values: (number | null)[];
  /** The comparison period, drawn dashed underneath. */
  previous?: (number | null)[];
  color: string;
  className?: string;
}) {
  const finite = [...values, ...(previous ?? [])].filter((v): v is number => v !== null && Number.isFinite(v));
  if (finite.length < 2) return <div aria-hidden className={cn("h-6", className)} />;
  const max = Math.max(...finite);
  const min = Math.min(0, ...finite);
  const prev = previous ? path(previous, max, min) : "";
  return (
    <svg aria-hidden viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={cn("h-6 w-full overflow-visible", className)}>
      {prev ? (
        <path d={prev} fill="none" stroke="var(--fg-faint, var(--muted-foreground))" strokeOpacity={0.55} strokeWidth={1} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
      ) : null}
      <path d={path(values, max, min)} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
