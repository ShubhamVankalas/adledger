"use client";

import { ArrowLeftRightIcon, MailIcon, PhoneIcon } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { dismissDuplicateAction, mergeContactsAction } from "@/app/actions/hygiene";
import { ActionButton } from "@/components/action-button";
import { UserAvatar } from "@/components/avatars";
import { Badge } from "@/components/ui/badge";
import type { DuplicateContact, DuplicatePair, DuplicateReason } from "@/lib/contacts-merge";
import { longDate, moneyWhole, num, plural } from "@/lib/format";
import { cn } from "@/lib/utils";

const REASON: Record<DuplicateReason, string> = {
  same_phone: "Same phone number",
  same_email: "Same email, written differently",
  same_name: "Same name, one has no email",
};

const label = (c: DuplicateContact) => c.name?.trim() || c.email || "Unnamed contact";
const day = (iso: string | null) => (iso ? longDate(iso.slice(0, 10)) : "—");

function Side({ contact, pairKey, keep, onKeep, currency }: { contact: DuplicateContact; pairKey: string; keep: boolean; onKeep: () => void; currency: string }) {
  const id = useId();
  const history = [plural(contact.devices, "device"), plural(contact.leads, "lead"), plural(contact.payments, "payment")].join(" · ");
  return (
    <label
      htmlFor={id}
      className={cn(
        "relative grid min-w-0 cursor-pointer content-start gap-3 rounded-lg p-3.5 transition-[background-color,box-shadow] duration-150 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring",
        keep ? "bg-brand-soft shadow-[inset_0_0_0_1.5px_var(--brand)]" : "bg-bg-subtle shadow-(--elev-card) hover:bg-fill",
      )}
    >
      <input id={id} type="radio" name={`keep-${pairKey}`} checked={keep} onChange={onKeep} className="sr-only" />
      <div className="flex min-w-0 items-start gap-3">
        <UserAvatar id={contact.id} name={contact.name} email={contact.email ?? contact.id} size="md" />
        <div className="grid min-w-0 flex-1 gap-0.5">
          <p className="truncate text-ui font-medium" title={label(contact)}>
            {label(contact)}
          </p>
          {/* Owners and admins only (workspace.settings); route through displayEmail() once role masking lands. */}
          <p className="flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground">
            <MailIcon aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{contact.email ? (contact.name?.trim() ? contact.email : "No name on file") : "No email"}</span>
          </p>
          <p className="flex items-center gap-1.5 text-caption text-muted-foreground">
            <PhoneIcon aria-hidden className="size-3.5 shrink-0" />
            {contact.hasPhone ? "Has a phone number" : "No phone"}
          </p>
        </div>
        <Badge variant={keep ? "brand" : "outline"} className="shrink-0">
          {keep ? "Keep" : "Merge away"}
        </Badge>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-caption">
        <div className="grid gap-0.5">
          <dt className="text-muted-foreground">Status</dt>
          <dd className="font-medium">{contact.lifecycle === "customer" ? "Customer" : "Lead"}</dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-muted-foreground">Revenue</dt>
          <dd className="font-medium tabular-nums">
            {contact.payments || contact.revenueMinor ? moneyWhole(contact.revenueMinor, currency) : "—"}
            {contact.otherCurrencies ? <span className="font-normal text-muted-foreground"> + other currencies</span> : null}
          </dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-muted-foreground">Added</dt>
          <dd className="tabular-nums">{day(contact.firstSeenAt)}</dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-muted-foreground">Last activity</dt>
          <dd className="tabular-nums">{day(contact.lastActivityAt)}</dd>
        </div>
      </dl>
      <p className="border-t pt-2.5 text-caption text-muted-foreground tabular-nums">{history}</p>
    </label>
  );
}

function PairCard({ pair, currency, canMerge, onResolved }: { pair: DuplicatePair; currency: string; canMerge: boolean; onResolved: () => void }) {
  const [keepId, setKeepId] = useState(pair.suggestedKeepId);
  const keep = keepId === pair.a.id ? pair.a : pair.b;
  const away = keepId === pair.a.id ? pair.b : pair.a;
  const key = `${pair.a.id}-${pair.b.id}`;
  const headingId = useId();

  return (
    <li aria-labelledby={headingId} className="grid gap-3 rounded-xl bg-card p-4 shadow-(--elev-card)">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={headingId} className="sr-only">
          {label(pair.a)} and {label(pair.b)}
        </h3>
        {pair.reasons.map((r) => (
          <Badge key={r} variant={pair.strength === "strong" ? "default" : "secondary"}>
            {REASON[r]}
          </Badge>
        ))}
        {pair.strength === "possible" ? <span className="text-caption text-muted-foreground">Possible match: check before merging</span> : null}
      </div>

      <fieldset className="grid items-stretch gap-2 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <legend className="sr-only">Which contact to keep</legend>
        <Side contact={pair.a} pairKey={key} keep={keepId === pair.a.id} onKeep={() => setKeepId(pair.a.id)} currency={currency} />
        <button
          type="button"
          onClick={() => setKeepId(away.id)}
          aria-label="Swap which contact is kept"
          className="mx-auto flex size-8 items-center justify-center self-center rounded-full text-muted-foreground transition-[background-color,color] duration-100 hover:bg-fill-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring max-md:rotate-90"
        >
          <ArrowLeftRightIcon aria-hidden className="size-4" />
        </button>
        <Side contact={pair.b} pairKey={key} keep={keepId === pair.b.id} onKeep={() => setKeepId(pair.b.id)} currency={currency} />
      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-caption text-pretty text-muted-foreground">
          {canMerge
            ? `Keeps ${label(keep)}. Devices, leads and payments from ${label(away)} move over, blanks are filled in, and attribution is recalculated.`
            : "Ask an owner or admin to merge these contacts."}
        </p>
        <div className="flex shrink-0 flex-wrap gap-2 max-sm:w-full">
          <ActionButton variant="ghost" size="sm" className="max-sm:flex-1" action={() => dismissDuplicateAction(pair.a.id, pair.b.id)} onDone={(r) => r.ok && onResolved()}>
            Not the same person
          </ActionButton>
          {canMerge ? (
            <ActionButton
              size="sm"
              className="max-sm:flex-1"
              action={() => mergeContactsAction(keep.id, away.id)}
              onDone={(r) => r.ok && onResolved()}
              confirm={`Merge ${label(away)} into ${label(keep)}? ${label(away)} is removed and everything it had moves to ${label(keep)}. This can’t be undone.`}
              confirmLabel="Merge contacts"
            >
              Merge
            </ActionButton>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function DuplicatesList({ pairs, currency, canMerge, summary, capped }: { pairs: DuplicatePair[]; currency: string; canMerge: boolean; summary: string; capped: boolean }) {
  const [resolved, setResolved] = useState<Set<string>>(() => new Set());
  const visible = pairs.filter((p) => !resolved.has(`${p.a.id}-${p.b.id}`) && !resolved.has(p.a.id) && !resolved.has(p.b.id));

  return (
    <section aria-label="Suggested duplicates" className="grid gap-3">
      <p className="text-ui text-muted-foreground tabular-nums" aria-live="polite">
        {visible.length ? `${num(visible.length)} ${visible.length === 1 ? "pair" : "pairs"} to review · ${summary}` : "All reviewed."}
        {capped ? " Showing the first 50; more appear as you work through these." : ""}
      </p>
      {visible.length ? (
        <ul className="grid gap-3">
          {visible.map((pair) => (
            <PairCard
              key={`${pair.a.id}-${pair.b.id}`}
              pair={pair}
              currency={currency}
              canMerge={canMerge}
              onResolved={() => setResolved((s) => new Set(s).add(`${pair.a.id}-${pair.b.id}`))}
            />
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-ui text-muted-foreground">
          Nothing left to review.{" "}
          <Link href="/contacts" className="font-medium text-foreground underline decoration-border-strong underline-offset-3 hover:decoration-foreground">
            Open contacts
          </Link>
        </p>
      )}
    </section>
  );
}
