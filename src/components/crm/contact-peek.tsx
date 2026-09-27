"use client";

import { ArrowUpRightIcon, ChevronDownIcon, ChevronUpIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadContactAction } from "@/app/actions/crm";
import { Keycaps } from "@/components/keycaps";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import type { ContactRecord, CrmAbilities, CrmMember } from "@/lib/crm-query";
import { cn } from "@/lib/utils";
import { ContactPanel, type PanelCommands } from "./contact-panel";
import { contactName } from "./crm-format";

/**
 * The preview sheet on /contacts: the full ContactPanel for one row, with J/K to move through
 * the table, O or Enter to open the record page and Esc to close. The previous contact stays on
 * screen (dimmed) while the next one loads, so moving never flashes a blank panel.
 */
export function ContactPeek({
  contactId,
  position,
  total,
  onClose,
  onMove,
  onOpen,
  members,
  tagSuggestions,
  abilities,
  viewerId,
  now,
}: {
  contactId: string | null;
  position: number;
  total: number;
  onClose: () => void;
  onMove: (delta: 1 | -1) => void;
  onOpen: (id: string) => void;
  members: CrmMember[];
  tagSuggestions: string[];
  abilities: CrmAbilities;
  viewerId: string;
  now: string;
}) {
  const [record, setRecord] = useState<ContactRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const cache = useRef(new Map<string, ContactRecord>());
  const latest = useRef<string | null>(null);
  const commands = useRef<PanelCommands | null>(null);

  const load = useCallback(async (id: string, fresh = false) => {
    latest.current = id;
    const hit = cache.current.get(id);
    if (hit && !fresh) {
      setRecord(hit);
      setError(null);
    }
    setLoading(true);
    const res = await loadContactAction(id).catch(() => ({ ok: false, message: "Couldn't reach the server. Check your connection." }) as const);
    if (latest.current !== id) return; // a newer row was opened meanwhile
    setLoading(false);
    if (!res.ok) {
      setError(res.message ?? "Couldn't load this contact.");
      return;
    }
    const r = (res as { data?: { record?: ContactRecord } }).data?.record ?? null;
    if (r) cache.current.set(id, r);
    setRecord(r);
    setError(null);
  }, []);

  useEffect(() => {
    if (contactId) void load(contactId);
  }, [contactId, load]);

  const shown = record;
  const stale = loading && shown?.contact.id !== contactId;

  return (
    <Sheet open={contactId !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[500px]"
        onKeyDown={(e) => {
          if (e.metaKey || e.ctrlKey || e.altKey) return;
          const t = e.target as HTMLElement;
          if (t.closest("input, textarea, select, [role=menu], [role=listbox], [contenteditable=true]")) return;
          if (e.key === "j") {
            e.preventDefault();
            onMove(1);
          } else if (e.key === "k") {
            e.preventDefault();
            onMove(-1);
          } else if ((e.key === "n" || e.key === "t") && commands.current) {
            e.preventDefault();
            if (e.key === "n") commands.current.note();
            else commands.current.task();
          } else if ((e.key === "o" || e.key === "Enter") && contactId && t.tagName !== "BUTTON" && t.tagName !== "A") {
            e.preventDefault();
            onOpen(contactId);
          }
        }}
      >
        <div className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-1 border-b bg-popover/95 px-3 backdrop-blur-sm">
          <Button variant="ghost" size="icon-sm" aria-label="Previous contact (K)" disabled={position <= 1} onClick={() => onMove(-1)}>
            <ChevronUpIcon />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Next contact (J)" disabled={position >= total} onClick={() => onMove(1)}>
            <ChevronDownIcon />
          </Button>
          <span className="num ml-1 text-caption whitespace-nowrap text-muted-foreground">
            {position.toLocaleString("en-US")} of {total.toLocaleString("en-US")}
          </span>
          <span className="flex-1" />
          {contactId ? (
            <Button
              variant="ghost"
              size="sm"
              render={
                <Link
                  href={`/contacts/${contactId}`}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                    e.preventDefault();
                    onOpen(contactId);
                  }}
                />
              }
            >
              <span className="max-sm:sr-only">Open record</span>
              <Keycaps keys="o" className="max-sm:hidden" />
              <ArrowUpRightIcon className="sm:hidden" />
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={onClose} className="text-muted-foreground" aria-label="Close preview">
            <span className="max-sm:hidden">Close</span>
            <Keycaps keys="escape" className="max-sm:hidden" />
            <XIcon className="sm:hidden" />
          </Button>
        </div>

        <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-5 pb-10 transition-opacity duration-150", stale && "opacity-60")} aria-busy={loading || undefined}>
          {shown ? (
            <>
              <SheetTitle className="sr-only">{contactName(shown.contact)}</SheetTitle>
              <SheetDescription className="sr-only">Contact preview. Press J or K to move between contacts.</SheetDescription>
              <ContactPanel
                key={shown.contact.id}
                record={shown}
                members={members}
                tagSuggestions={tagSuggestions}
                abilities={abilities}
                viewerId={viewerId}
                now={now}
                variant="peek"
                onChanged={() => load(shown.contact.id, true)}
                commandsRef={commands}
              />
            </>
          ) : error ? (
            <div className="space-y-3 py-10 text-center">
              <SheetTitle className="text-title-sm">Couldn’t open this contact</SheetTitle>
              <SheetDescription>{error}</SheetDescription>
              {contactId ? (
                <Button variant="outline" size="sm" onClick={() => void load(contactId, true)}>
                  Try again
                </Button>
              ) : null}
            </div>
          ) : (
            <PeekSkeleton />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function PeekSkeleton() {
  return (
    <div className="reveal-delayed space-y-5" aria-label="Loading contact">
      <SheetTitle className="sr-only">Loading contact…</SheetTitle>
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
      </div>
      <Skeleton className="h-36 w-full rounded-lg" />
      <div className="space-y-2">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-7 w-full" />
        ))}
      </div>
    </div>
  );
}
