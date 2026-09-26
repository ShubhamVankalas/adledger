"use client";

import { AlertTriangleIcon, RotateCwIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-[70svh] items-center justify-center p-4 md:p-6">
      <div role="alert" className="flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border bg-card p-6 text-center shadow-sm sm:p-8">
        <span className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangleIcon className="size-5" aria-hidden />
        </span>
        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold tracking-tight">Something went wrong</h1>
          <p className="text-sm break-words text-muted-foreground">{error.message || "An unexpected error occurred."}</p>
          {error.digest ? (
            <p className="text-xs text-muted-foreground">
              Reference <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{error.digest}</code>
            </p>
          ) : null}
        </div>
        <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
          <Button variant="outline" render={<Link href="/" />}>
            Back to overview
          </Button>
          <Button onClick={reset}>
            <RotateCwIcon /> Try again
          </Button>
        </div>
      </div>
    </div>
  );
}
