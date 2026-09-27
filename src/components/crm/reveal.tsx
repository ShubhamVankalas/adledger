"use client";

import { EyeIcon, EyeOffIcon, Loader2Icon } from "lucide-react";
import { createContext, use, useState, useTransition } from "react";
import { toast } from "sonner";
import { revealContactEmailsAction } from "@/app/actions/security";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Contact emails are masked on screen for everyone ("p•••@gmail.com"). Members allowed to see
// contact PII can reveal them; each reveal asks the server (which writes contact.pii_revealed to
// the audit log) and lasts until they hide them or leave the page.

type State = { emails: Record<string, string> | null; pending: boolean; toggle: () => void; canReveal: boolean };
const RevealContext = createContext<State>({ emails: null, pending: false, toggle: () => undefined, canReveal: false });

export function RevealProvider({ ids, canReveal, children }: { ids: string[]; canReveal: boolean; children: React.ReactNode }) {
  const [emails, setEmails] = useState<Record<string, string> | null>(null);
  const [pending, start] = useTransition();
  const toggle = () => {
    if (emails) return setEmails(null);
    start(async () => {
      const r = await revealContactEmailsAction(ids);
      if (!r.ok) {
        toast.error(r.message ?? "Couldn't show the emails.");
        return;
      }
      setEmails((r.data?.emails as Record<string, string>) ?? {});
    });
  };
  return <RevealContext value={{ emails, pending, toggle, canReveal }}>{children}</RevealContext>;
}

/** The revealed address for one contact, or null while it is masked. */
export function useRevealedEmail(id: string): string | null {
  return use(RevealContext).emails?.[id] ?? null;
}

/** A contact's email: masked, or the real address once revealed. */
export function Email({ id, masked, className }: { id: string; masked: string; className?: string }) {
  const { emails } = use(RevealContext);
  const real = emails?.[id];
  return (
    <span className={className} translate="no" data-revealed={real ? "" : undefined}>
      {real ?? masked}
    </span>
  );
}

/** "Show emails" / "Hide emails". Renders nothing for roles that can't reveal. */
export function RevealToggle({
  label = "emails",
  className,
  labelClassName,
  compact = false,
}: {
  label?: string;
  className?: string;
  /** e.g. "hidden @3xl:inline" to show only the eye icon in narrow containers (the button keeps its aria-label). */
  labelClassName?: string;
  compact?: boolean;
}) {
  const { emails, pending, toggle, canReveal } = use(RevealContext);
  if (!canReveal) return null;
  const shown = Boolean(emails);
  return (
    <Button
      type="button"
      variant={compact ? "ghost" : "outline"}
      size={compact ? "xs" : "sm"}
      onClick={toggle}
      disabled={pending}
      aria-pressed={shown}
      className={cn(!compact && "h-10 sm:h-7", className)}
      title={shown ? undefined : "Showing emails is recorded in the audit log"}
      aria-label={shown ? `Hide ${label}` : `Show ${label}`}
    >
      {pending ? <Loader2Icon className="animate-spin" /> : shown ? <EyeOffIcon /> : <EyeIcon />}
      <span className={labelClassName}>{shown ? `Hide ${label}` : `Show ${label}`}</span>
    </Button>
  );
}
