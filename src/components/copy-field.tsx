"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API needs https; fall back to a hidden textarea.
      const t = document.createElement("textarea");
      t.value = text;
      document.body.appendChild(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return { copied, copy };
}

export function CopyButton({ value, className, label }: { value: string; className?: string; label?: string }) {
  const { copied, copy } = useCopy();
  return (
    <Button type="button" variant="outline" size={label ? "sm" : "icon-sm"} className={className} onClick={() => copy(value)} aria-label={label ? undefined : "Copy"}>
      {copied ? <CheckIcon className="text-success" /> : <CopyIcon />}
      {label ? (copied ? "Copied" : label) : null}
    </Button>
  );
}

export function CopyField({ value, mono = true, className }: { value: string; mono?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2 rounded-lg border bg-muted/40 py-1 pr-1 pl-3", className)}>
      <code className={cn("min-w-0 flex-1 truncate text-xs", !mono && "font-sans")}>{value}</code>
      <CopyButton value={value} />
    </div>
  );
}
