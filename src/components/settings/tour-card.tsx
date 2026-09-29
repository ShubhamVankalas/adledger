"use client";

import { CompassIcon } from "lucide-react";
import { startProductTour } from "@/components/command-palette-store";
import { Button } from "@/components/ui/button";

/** Settings → Profile: replay the guided tour of the app. `completedOn` is a date already formatted by the server. */
export function TourCard({ completedOn }: { completedOn: string | null }) {
  return (
    <section
      aria-labelledby="product-tour-title"
      className="flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:flex-row sm:items-center"
    >
      <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand-foreground">
        <CompassIcon className="size-4" strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <h3 id="product-tour-title" className="text-sm font-medium">
          Product tour
        </h3>
        <p className="text-sm text-pretty text-muted-foreground">
          A two-minute walk through the pages and settings your role can use. {completedOn ? `You finished it on ${completedOn}.` : "You haven’t taken it yet."}
        </p>
      </div>
      <Button variant="outline" onClick={startProductTour} className="max-sm:h-10">
        {completedOn ? "Take the tour again" : "Take the tour"}
      </Button>
    </section>
  );
}
