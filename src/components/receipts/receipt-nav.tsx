"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useHotkeys } from "@/lib/hotkeys";

/** Newer / older payment buttons for a receipt, with J (older) and K (newer) like a mail list. */
export function ReceiptNav({ newerHref, olderHref }: { newerHref: string | null; olderHref: string | null }) {
  const router = useRouter();
  useHotkeys([
    { id: "receipts.older", keys: "j", label: "Older payment", group: "Receipts", run: () => (olderHref ? router.push(olderHref) : false) },
    { id: "receipts.newer", keys: "k", label: "Newer payment", group: "Receipts", run: () => (newerHref ? router.push(newerHref) : false) },
  ]);
  const item = (href: string | null, label: string, hint: string, icon: React.ReactNode) =>
    href ? (
      <Button variant="outline" size="icon-sm" aria-label={`${label} (${hint})`} title={`${label} · ${hint}`} render={<Link href={href} scroll={false} />}>
        {icon}
      </Button>
    ) : (
      <Button variant="outline" size="icon-sm" aria-label={label} disabled>
        {icon}
      </Button>
    );
  return (
    <div className="flex items-center gap-1">
      {item(newerHref, "Newer payment", "K", <ChevronLeftIcon />)}
      {item(olderHref, "Older payment", "J", <ChevronRightIcon />)}
    </div>
  );
}
