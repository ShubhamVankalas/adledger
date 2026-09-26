"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useCopy } from "@/components/copy-field";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A code sample with its own toolbar. The code scrolls inside the box (never widens the page) and
 * the copy button sits in the toolbar, so it never covers the code.
 * `wrap` breaks long single-line values (URLs, UTM strings) instead of scrolling.
 */
export function Snippet({ code, label, wrap = false, className }: { code: string; label?: React.ReactNode; wrap?: boolean; className?: string }) {
  const { copied, copy } = useCopy();
  return (
    <div className={cn("min-w-0 overflow-hidden rounded-lg border bg-muted/40 dark:bg-muted/30", className)}>
      <div className="flex min-h-9 items-center justify-between gap-2 border-b bg-muted/50 py-1 pr-1 pl-3 dark:bg-muted/40">
        <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">{label}</span>
        <Button type="button" variant="ghost" size="sm" onClick={() => copy(code)} aria-label={copied ? "Copied" : "Copy code"} className="text-muted-foreground">
          {copied ? <CheckIcon className="text-success" /> : <CopyIcon />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre
        className={cn(
          "max-w-full overflow-x-auto p-3 font-mono text-xs leading-relaxed",
          wrap ? "break-all whitespace-pre-wrap" : "whitespace-pre",
        )}
        tabIndex={0}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

