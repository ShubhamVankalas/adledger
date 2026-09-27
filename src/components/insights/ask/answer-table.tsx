import { ArrowUpRightIcon } from "lucide-react";
import Link from "next/link";
import { PlatformBadge } from "@/components/platform-badge";
import { formatCell, isNumericKind } from "@/lib/ai/ask-format";
import type { AskTable } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

const sourceLabel = (href: string) => (href.startsWith("/performance") ? "Open in Performance" : "Open in Overview");

/** A tool result exactly as the SQL returned it, formatted the same way the model saw it. */
export function AnswerTable({ table }: { table: AskTable }) {
  const single = table.rows.length === 1 && table.columns.length > 3 && table.columns.every((c) => isNumericKind(c.kind));
  return (
    <figure className="@container overflow-hidden rounded-xl bg-card shadow-(--elev-card)">
      <figcaption className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 pt-3 pb-2.5">
        <span className="min-w-0">
          <span className="block text-ui font-medium">{table.title}</span>
          <span className="block text-caption text-muted-foreground">{table.caption}</span>
        </span>
        <Link
          href={table.source}
          className="-mr-1.5 inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-caption font-medium text-muted-foreground transition-colors duration-100 hover:bg-fill hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:h-9"
        >
          {sourceLabel(table.source)}
          <ArrowUpRightIcon aria-hidden className="size-3.5" />
        </Link>
      </figcaption>
      {table.rows.length === 0 ? (
        <p className="border-t px-4 py-3 text-ui text-muted-foreground">No rows for this period.</p>
      ) : single ? (
        // One row of KPIs reads better as a grid of figures than as a one-line table.
        <dl className="grid grid-cols-2 gap-px border-t bg-border sm:grid-cols-4">
          {table.columns.map((c) => (
            <div key={c.key} className="bg-card px-4 py-2.5">
              <dt className="truncate text-caption text-muted-foreground">{c.label}</dt>
              <dd className="num text-body font-medium">{formatCell(c.kind, table.rows[0][c.key], table.currency)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="max-h-[26rem] overflow-auto border-t">
          <table className="w-full text-ui">
            <thead className="sticky top-0 z-[1] bg-bg-subtle">
              <tr className="text-caption text-muted-foreground">
                {table.columns.map((c, i) => (
                  <th key={c.key} scope="col" className={cn("px-3 py-2 font-medium whitespace-nowrap", isNumericKind(c.kind) ? "text-right" : "text-left", i === 0 && "pl-4", i === table.columns.length - 1 && "pr-4")}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {table.rows.map((r, ri) => (
                <tr key={ri} className="h-10">
                  {table.columns.map((c, i) => (
                    <td
                      key={c.key}
                      className={cn(
                        "px-3 whitespace-nowrap",
                        isNumericKind(c.kind) ? "num text-right" : "text-left",
                        c.kind === "text" && "max-w-[16rem] truncate",
                        i === 0 && "pl-4 font-medium",
                        i === table.columns.length - 1 && "pr-4",
                      )}
                      title={c.kind === "text" ? String(r[c.key] ?? "") : undefined}
                    >
                      {c.kind === "platform" ? <PlatformBadge platform={String(r[c.key] ?? "")} compact="auto" /> : formatCell(c.kind, r[c.key], table.currency)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </figure>
  );
}
