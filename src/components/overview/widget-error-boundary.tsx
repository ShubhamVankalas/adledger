"use client";

import { RotateCwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { Component, useTransition, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// One failing widget shows an inline error with Retry; the rest of the board keeps working.

type Props = { title: string; compact?: boolean; children: ReactNode };

export class WidgetErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <WidgetError title={this.props.title} compact={this.props.compact} onRetry={() => this.setState({ failed: false })} />;
  }
}

function WidgetError({ title, compact, onRetry }: { title: string; compact?: boolean; onRetry: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div role="alert" className={cn("flex h-full flex-col justify-center gap-1", compact ? "px-4" : "items-center px-8 text-center")}>
      <p className="text-[13px] font-medium">{compact ? title : `${title} didn’t load`}</p>
      {!compact ? <p className="text-xs text-muted-foreground">Something went wrong while loading this widget. The server log has the details.</p> : null}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(() => {
            router.refresh();
            onRetry();
          })
        }
        className={cn(
          "mt-1.5 inline-flex h-7 items-center gap-1.5 self-start rounded-md border px-2.5 text-xs font-medium transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60",
          !compact && "self-center",
        )}
      >
        <RotateCwIcon aria-hidden className={cn("size-3", pending && "animate-spin")} />
        {pending ? "Retrying…" : "Retry"}
      </button>
    </div>
  );
}
