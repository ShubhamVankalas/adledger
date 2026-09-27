"use client";

import { AlertTriangleIcon, ChevronRightIcon, RotateCwIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-[70svh] items-center justify-center p-4 md:p-6">
      <div
        role="alert"
        className="flex w-full max-w-md flex-col items-center gap-5 rounded-2xl bg-card p-6 text-center shadow-sm ring-1 ring-foreground/10 sm:p-8"
      >
        <span className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangleIcon className="size-5" aria-hidden />
        </span>
        <div className="space-y-1.5">
          <h1 className="text-xl font-semibold tracking-tight text-balance">Something went wrong</h1>
          <p className="text-sm text-balance text-muted-foreground">
            This page couldn&rsquo;t load. Your data is safe. Try again, and if it keeps happening, check the server logs.
          </p>
        </div>
        <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
          <Button variant="outline" className="h-10 sm:h-8" render={<Link href="/" />}>
            Back to overview
          </Button>
          <Button className="h-10 sm:h-8" onClick={reset}>
            <RotateCwIcon aria-hidden /> Try again
          </Button>
        </div>
        {error.message || error.digest ? (
          <details className="group w-full border-t pt-4 text-left text-xs text-muted-foreground">
            <summary className="mx-auto flex w-fit cursor-pointer list-none items-center gap-1 rounded-md font-medium outline-none hover:text-foreground focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              Technical details
              <ChevronRightIcon className="size-3.5 transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden />
            </summary>
            <div className="mt-3 space-y-1.5 rounded-lg bg-muted/50 p-3">
              {error.message ? <p className="break-words">{error.message}</p> : null}
              {error.digest ? (
                <p>
                  Reference <code className="rounded bg-muted px-1.5 py-0.5 font-mono" translate="no">{error.digest}</code>
                </p>
              ) : null}
            </div>
          </details>
        ) : null}
      </div>
    </div>
  );
}
