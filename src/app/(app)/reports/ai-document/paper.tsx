import type { DocumentPreview, PreviewBlock } from "@/lib/ai/document-preview";
import { cn } from "@/lib/utils";

// In-app preview of an AI document: the same structure and figures as the PDF, drawn as HTML
// with the dashboard's tokens (so it follows the org accent and dark mode).

const TONE: Record<Extract<PreviewBlock, { type: "callout" }>["tone"], { box: string; bar: string; title: string }> = {
  neutral: { box: "bg-fill/70", bar: "bg-border-strong", title: "text-foreground" },
  positive: { box: "bg-positive-soft", bar: "bg-positive", title: "text-positive" },
  warning: { box: "bg-warning-soft", bar: "bg-warning", title: "text-warning-foreground" },
  negative: { box: "bg-negative-soft", bar: "bg-negative", title: "text-negative" },
};

function Line({ points, className }: { points: number[]; className: string }) {
  if (points.length < 2) return null;
  const d = points.map((p, i) => `${((i / (points.length - 1)) * 100).toFixed(2)},${(38 - p * 34).toFixed(2)}`).join(" ");
  return <polyline points={d} fill="none" strokeWidth={1.4} vectorEffect="non-scaling-stroke" strokeLinejoin="round" className={className} />;
}

function Block({ b }: { b: PreviewBlock }) {
  switch (b.type) {
    case "paragraph":
      return <p className="text-body text-pretty">{b.text}</p>;
    case "bullets":
      return (
        <ul className="grid list-disc gap-1 pl-5 text-body marker:text-fg-faint">
          {b.items.map((it, i) => (
            <li key={i} className="text-pretty">
              {it}
            </li>
          ))}
        </ul>
      );
    case "callout": {
      const t = TONE[b.tone];
      return (
        <div className={cn("flex overflow-hidden rounded-md", t.box)}>
          <span aria-hidden className={cn("w-0.5 shrink-0", t.bar)} />
          <div className="px-3 py-2.5">
            <p className={cn("text-ui font-semibold", t.title)}>{b.title}</p>
            {b.text ? <p className="mt-0.5 text-ui text-pretty">{b.text}</p> : null}
          </div>
        </div>
      );
    }
    case "kpis":
      return (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {b.items.map((k) => (
            <div key={k.label} className="rounded-md border bg-card px-2.5 py-2">
              <dt className="truncate text-caption text-muted-foreground" title={k.label}>
                {k.label}
              </dt>
              <dd className="mt-0.5 text-title-sm tabular-nums">{k.value}</dd>
              {k.change ? <dd className={cn("text-micro tabular-nums", k.good === null ? "text-muted-foreground" : k.good ? "text-positive" : "text-negative")}>{k.change} vs previous</dd> : null}
            </div>
          ))}
        </dl>
      );
    case "table":
      return (
        <figure>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[28rem] text-ui">
              <thead className="bg-fill/60 text-caption text-muted-foreground">
                <tr>
                  {b.columns.map((c) => (
                    <th key={c.label} scope="col" className={cn("px-2.5 py-1.5 font-medium", c.numeric ? "text-right" : "text-left")}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, i) => (
                  <tr key={i} className="border-t">
                    {r.map((cell, j) => (
                      <td key={j} className={cn("px-2.5 py-1.5", j ? "text-right tabular-nums" : "max-w-56 truncate font-medium")}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <figcaption className="mt-1 text-caption text-muted-foreground">
            {b.caption ? `${b.caption} · ` : ""}
            {b.source}
            {b.more > 0 ? ` · and ${b.more} more in the data` : ""}
          </figcaption>
        </figure>
      );
    case "chart":
      return (
        <figure>
          {b.lines.length ? (
            <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-28 w-full rounded-md border bg-card" role="img" aria-label={`${b.source}: ${b.lines.map((l) => l.label).join(" and ")} by day`}>
              {b.lines.map((l, i) => (
                <Line key={l.label} points={l.points} className={i === 0 && b.lines.length > 1 ? "stroke-chart-spend" : "stroke-chart-revenue"} />
              ))}
            </svg>
          ) : (
            <ul className="grid gap-1.5" aria-label={`${b.source} by ${b.metric.toLowerCase()}`}>
              {b.bars.map((bar, i) => (
                <li key={i} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2 text-caption">
                  <span className="truncate" title={bar.label}>
                    {bar.label}
                  </span>
                  <span className="h-2 rounded-sm bg-fill">
                    <span className={cn("block h-2 rounded-sm", bar.negative ? "bg-negative" : "bg-chart-revenue")} style={{ width: `${Math.max(1, bar.share * 100)}%` }} />
                  </span>
                  <span className="text-right font-medium tabular-nums">{bar.value}</span>
                </li>
              ))}
            </ul>
          )}
          <figcaption className="mt-1 text-caption text-muted-foreground">
            {b.caption ? `${b.caption} · ` : ""}
            {b.source} · {b.chart} chart of {b.metric.toLowerCase()} in the PDF
          </figcaption>
        </figure>
      );
  }
}

export function DocumentPaper({ preview }: { preview: DocumentPreview }) {
  return (
    <article className="mx-auto max-w-3xl rounded-md bg-card px-4 py-6 shadow-(--elev-md) sm:px-10 sm:py-10" aria-label={`Preview of ${preview.title}`}>
      <div aria-hidden className="h-0.5 w-6 rounded-full bg-brand-gradient" />
      <p className="mt-3 text-micro tracking-[0.08em] text-muted-foreground uppercase">AI document · {preview.period}</p>
      <h3 className="mt-1 text-title text-balance">{preview.title}</h3>
      {preview.subtitle ? <p className="mt-1 text-body text-muted-foreground">{preview.subtitle}</p> : null}
      {preview.summary ? (
        <div className="mt-5 rounded-md border-l-2 border-brand bg-fill/60 px-4 py-3">
          <p className="text-micro tracking-[0.08em] text-muted-foreground uppercase">Summary</p>
          <p className="mt-1 text-body text-pretty">{preview.summary}</p>
        </div>
      ) : null}
      {preview.sections.map((s, i) => (
        <section key={i} className="mt-7">
          <h4 className="flex items-center gap-2 text-title-sm">
            <span aria-hidden className="h-3 w-[3px] rounded-full bg-brand" />
            {s.heading}
          </h4>
          <div className="mt-3 grid gap-4">
            {s.blocks.map((b, j) => (
              <Block key={j} b={b} />
            ))}
          </div>
        </section>
      ))}
    </article>
  );
}
