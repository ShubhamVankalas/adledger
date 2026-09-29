"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { completeTourAction } from "@/app/actions/tour";
import { START_TOUR_EVENT } from "@/components/command-palette-store";
import { LogoMark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { tourMayAutoStart, tourStepsFor, type ResolvedTourStep } from "@/lib/tour";
import { TourRunner, type TourOutcome } from "./tour-runner";

// Mounted once in the app layout. Offers the tour to someone who has never finished it (a small
// welcome first), and starts it on request from Settings, the profile menu or the ⌘K palette.

/** "Maybe later" hides the welcome for a day in this browser. */
const SNOOZE_MS = 24 * 60 * 60 * 1000;
const snoozeKey = (userId: string) => `adledger:tour-snoozed:${userId}`;

function snoozed(userId: string) {
  try {
    const at = Number(localStorage.getItem(snoozeKey(userId)));
    return Number.isFinite(at) && at > Date.now() - SNOOZE_MS;
  } catch {
    return false;
  }
}

function snooze(userId: string) {
  try {
    localStorage.setItem(snoozeKey(userId), String(Date.now()));
  } catch {
    // private mode: the welcome may show again on the next page load, which is fine
  }
}

type Run = { steps: ResolvedTourStep[]; origin: string; mod: string };

export function ProductTour({
  permissions,
  autoStart,
  completed,
  userId,
}: {
  /** Every permission the viewer holds; decides which steps they get. */
  permissions: readonly string[];
  /** Offer the tour by itself (never finished, and not switched off for this install). */
  autoStart: boolean;
  /** The account has already finished or skipped it once (the server stores that only once). */
  completed: boolean;
  userId: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [welcome, setWelcome] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const offered = useRef(false);
  const stored = useRef(completed);
  const primary = useRef<HTMLButtonElement>(null);
  const starting = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const start = useCallback(() => {
    const phone = window.matchMedia("(max-width: 767px)").matches;
    const steps = tourStepsFor((p) => permissions.includes(p), { phone });
    if (steps.length === 0) return;
    const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K";
    setRun((current) => current ?? { steps, mod, origin: window.location.pathname + window.location.search });
  }, [permissions]);

  // Replay on request. Menus and the palette are still closing, so wait a beat before taking focus.
  useEffect(() => {
    const onStart = () => {
      clearTimeout(starting.current);
      starting.current = setTimeout(start, 260);
    };
    window.addEventListener(START_TOUR_EVENT, onStart);
    return () => {
      window.removeEventListener(START_TOUR_EVENT, onStart);
      clearTimeout(starting.current);
    };
  }, [start]);

  // First login: greet once the page has settled (never over onboarding).
  useEffect(() => {
    if (!autoStart || stored.current || offered.current || !tourMayAutoStart(pathname) || snoozed(userId)) return;
    const t = setTimeout(() => {
      offered.current = true;
      setWelcome(true);
    }, 900);
    return () => clearTimeout(t);
  }, [autoStart, pathname, userId]);

  const close = useCallback(
    (outcome: TourOutcome) => {
      const origin = run?.origin;
      setRun(null);
      if (!stored.current) {
        stored.current = true;
        void completeTourAction(outcome);
      }
      if (outcome === "skipped") toast("Tour skipped", { description: "Take it again any time from your profile menu, or search “tour” in the command palette." });
      // The tour may have walked through other pages; leave the person where they started.
      if (origin && origin !== window.location.pathname + window.location.search) router.push(origin);
    },
    [run, router],
  );

  return (
    <>
      <Dialog
        open={welcome}
        onOpenChange={(open) => {
          if (open) return;
          snooze(userId);
          setWelcome(false);
        }}
      >
        <DialogContent showCloseButton={false} initialFocus={primary} className="sm:max-w-[26rem]">
          <div className="grid gap-4">
            <LogoMark className="size-11" />
            <DialogHeader className="gap-1.5 pr-0">
              <DialogTitle className="text-title text-balance">Welcome to AdLedger</DialogTitle>
              <DialogDescription className="text-body text-pretty">
                Your ads, leads and revenue in one ledger, so you can see which ad actually made you money. A short tour shows you where everything is.
              </DialogDescription>
            </DialogHeader>
            <p className="text-caption text-muted-foreground">About two minutes. Skip whenever you like, and replay it later from your profile menu.</p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                snooze(userId);
                setWelcome(false);
              }}
              className="max-sm:h-10"
            >
              Maybe later
            </Button>
            <Button
              ref={primary}
              onClick={() => {
                setWelcome(false);
                clearTimeout(starting.current);
                starting.current = setTimeout(start, 250);
              }}
              className="max-sm:h-10"
            >
              Take a 2-minute tour
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {run ? <TourRunner steps={run.steps} mod={run.mod} onClose={close} /> : null}
    </>
  );
}
