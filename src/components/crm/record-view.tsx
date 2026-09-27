"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import type { ContactRecord, CrmAbilities, CrmMember } from "@/lib/crm-query";
import { useHotkeys } from "@/lib/hotkeys";
import { ContactPanel } from "./contact-panel";
import { LIST_CONTEXT_KEY } from "./contacts-view";

/** The record page body: the shared ContactPanel. Server actions revalidate the page, so props refresh on their own. */
export function RecordView(props: { record: ContactRecord; members: CrmMember[]; tagSuggestions: string[]; abilities: CrmAbilities; viewerId: string; now: string }) {
  return <ContactPanel {...props} variant="page" onChanged={noop} />;
}
const noop = () => undefined;
const noSubscribe = () => () => undefined;
function readList(): string | null {
  try {
    return sessionStorage.getItem(LIST_CONTEXT_KEY);
  } catch {
    return null;
  }
}

/**
 * "‹ 12 of 50 ›" in the record header when the contact was opened from the Contacts table:
 * J and K walk the same list the table showed.
 */
export function RecordPager({ id }: { id: string }) {
  const router = useRouter();
  const raw = useSyncExternalStore(noSubscribe, readList, () => null);
  const ctx = useMemo(() => {
    try {
      const v = JSON.parse(raw ?? "null");
      return v && Array.isArray(v.ids) && typeof v.href === "string" ? (v as { ids: string[]; href: string }) : null;
    } catch {
      return null;
    }
  }, [raw]);
  const index = ctx ? ctx.ids.indexOf(id) : -1;
  const prev = index > 0 ? ctx!.ids[index - 1] : null;
  const next = index >= 0 && index < ctx!.ids.length - 1 ? ctx!.ids[index + 1] : null;
  useHotkeys(
    index >= 0
      ? [
          { id: "record.next", keys: "j", label: "Next contact in the list", group: "Contacts", run: () => (next ? void router.push(`/contacts/${next}`) : false) },
          { id: "record.prev", keys: "k", label: "Previous contact in the list", group: "Contacts", run: () => (prev ? void router.push(`/contacts/${prev}`) : false) },
        ]
      : [],
  );
  if (index < 0 || !ctx) return null;
  return (
    <div className="hidden items-center gap-0.5 sm:flex">
      <Button variant="ghost" size="icon-sm" aria-label="Previous contact (K)" disabled={!prev} render={prev ? <Link href={`/contacts/${prev}`} /> : undefined}>
        <ChevronLeftIcon />
      </Button>
      <Link href={ctx.href} className="num rounded-sm px-1 text-caption text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
        {index + 1} of {ctx.ids.length}
      </Link>
      <Button variant="ghost" size="icon-sm" aria-label="Next contact (J)" disabled={!next} render={next ? <Link href={`/contacts/${next}`} /> : undefined}>
        <ChevronRightIcon />
      </Button>
    </div>
  );
}
