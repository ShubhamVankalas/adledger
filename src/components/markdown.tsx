import { Fragment } from "react";
import { cn } from "@/lib/utils";

// Minimal, safe Markdown renderer for AI reports: headings, lists, bold, italics, code.
// Never renders raw HTML.

function inline(text: string, key: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|_[^_]+_)/g);
  return parts.map((p, i) => {
    const k = `${key}-${i}`;
    if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={k} className="font-semibold text-foreground">{p.slice(2, -2)}</strong>;
    if (/^`[^`]+`$/.test(p)) return <code key={k} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{p.slice(1, -1)}</code>;
    if (/^(\*[^*]+\*|_[^_]+_)$/.test(p)) return <em key={k}>{p.slice(1, -1)}</em>;
    return <Fragment key={k}>{p}</Fragment>;
  });
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const lines = source.replace(/\r/g, "").split("\n");
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push(<p key={`p${blocks.length}`}>{inline(para.join(" "), `p${blocks.length}`)}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    const k = `l${blocks.length}`;
    blocks.push(
      <Tag key={k} className={cn("space-y-1.5 pl-5", list.ordered ? "list-decimal" : "list-disc", "marker:text-muted-foreground")}>
        {list.items.map((it, i) => (
          <li key={i}>{inline(it, `${k}-${i}`)}</li>
        ))}
      </Tag>,
    );
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      flushList();
      const level = h[1].length;
      blocks.push(
        <h3 key={`h${blocks.length}`} className={cn("font-semibold tracking-tight text-foreground", level <= 2 ? "mt-5 text-base first:mt-0" : "mt-4 text-sm")}>
          {inline(h[2], `h${blocks.length}`)}
        </h3>,
      );
    } else if (ul || ol) {
      flushPara();
      const ordered = !!ol;
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push((ul ?? ol)![1]);
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return <div className={cn("space-y-3 text-sm leading-relaxed text-foreground/85", className)}>{blocks}</div>;
}
