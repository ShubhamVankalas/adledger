"use client";

import { CheckIcon, ChevronDownIcon, PlusIcon, TagIcon, UserRoundIcon, XIcon } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { UserAvatar } from "@/components/avatars";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { normalizeTag, type CrmMember, type Lifecycle } from "@/lib/crm-query";
import { cn } from "@/lib/utils";

// Inline editors for a contact's properties. They are controlled: the parent applies the change
// optimistically, calls the server action and offers Undo.

export const LIFECYCLE_LABEL: Record<Lifecycle, string> = { lead: "Lead", customer: "Customer" };

export function LifecycleBadge({ lifecycle, className }: { lifecycle: Lifecycle; className?: string }) {
  return (
    <Badge variant={lifecycle === "customer" ? "positive" : "secondary"} className={className}>
      {LIFECYCLE_LABEL[lifecycle]}
    </Badge>
  );
}

const TRIGGER =
  "inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 -mx-1.5 text-ui transition-colors duration-100 outline-none hover:bg-fill-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring aria-expanded:bg-fill-hover disabled:pointer-events-none";

export function LifecyclePicker({ value, onChange, disabled }: { value: Lifecycle; onChange: (v: Lifecycle) => void; disabled?: boolean }) {
  if (disabled) return <LifecycleBadge lifecycle={value} />;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={TRIGGER} aria-label={`Status: ${LIFECYCLE_LABEL[value]}. Change status`}>
        <LifecycleBadge lifecycle={value} />
        <ChevronDownIcon aria-hidden className="size-3.5 text-fg-faint" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Status</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={value} onValueChange={(v) => v !== value && onChange(v as Lifecycle)}>
            <DropdownMenuRadioItem value="lead">Lead</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="customer">Customer</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-caption text-pretty text-muted-foreground">A payment makes someone a customer automatically.</p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function memberName(m: Pick<CrmMember, "name" | "email"> | undefined | null): string {
  return m ? m.name?.trim() || m.email : "Unassigned";
}

export function OwnerChip({ member, compact }: { member: CrmMember | undefined; compact?: boolean }) {
  if (!member) return <span className="text-muted-foreground">{compact ? "—" : "Unassigned"}</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" title={memberName(member)}>
      <UserAvatar id={member.id} name={member.name} email={member.email} size="xs" />
      <span className={cn("truncate", compact && "sr-only @5xl:not-sr-only")}>{memberName(member)}</span>
    </span>
  );
}

export function OwnerPicker({
  value,
  members,
  viewerId,
  onChange,
  disabled,
}: {
  value: string | null;
  members: CrmMember[];
  viewerId: string;
  onChange: (ownerUserId: string | null) => void;
  disabled?: boolean;
}) {
  const current = members.find((m) => m.id === value);
  if (disabled) return <OwnerChip member={current} />;
  // The viewer first, then everyone else who can own contacts.
  const eligible = members.filter((m) => m.canEdit).sort((a, b) => (a.id === viewerId ? -1 : b.id === viewerId ? 1 : 0));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={TRIGGER} aria-label={`Owner: ${memberName(current)}. Change owner`}>
        {current ? <OwnerChip member={current} /> : <span className="inline-flex items-center gap-1.5 text-muted-foreground"><UserRoundIcon aria-hidden className="size-3.5" />Unassigned</span>}
        <ChevronDownIcon aria-hidden className="size-3.5 shrink-0 text-fg-faint" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Owner</DropdownMenuLabel>
          {eligible.map((m) => (
            <DropdownMenuItem key={m.id} onClick={() => m.id !== value && onChange(m.id)}>
              <UserAvatar id={m.id} name={m.name} email={m.email} size="xs" />
              <span className="min-w-0 flex-1 truncate">
                {memberName(m)}
                {m.id === viewerId ? <span className="text-muted-foreground"> (you)</span> : null}
              </span>
              {m.id === value ? <CheckIcon aria-hidden className="size-3.5" /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        {value ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onChange(null)}>
              <XIcon aria-hidden className="size-3.5 text-muted-foreground" />
              Remove owner
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TagList({ tags, max = 3, className }: { tags: string[]; max?: number; className?: string }) {
  if (!tags.length) return null;
  const shown = tags.slice(0, max);
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1", className)}>
      {shown.map((t) => (
        <Badge key={t} variant="outline" className="max-w-32 truncate font-normal">
          {t}
        </Badge>
      ))}
      {tags.length > max ? <span className="text-caption text-muted-foreground">+{tags.length - max}</span> : null}
    </span>
  );
}

/** Tags as removable chips plus an "add tag" popover with suggestions from the workspace. */
export function TagEditor({
  tags,
  suggestions,
  onAdd,
  onRemove,
  disabled,
}: {
  tags: string[];
  suggestions: string[];
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
  disabled?: boolean;
}) {
  if (disabled) return tags.length ? <TagList tags={tags} max={20} className="flex-wrap" /> : <span className="text-muted-foreground">No tags</span>;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {tags.map((t) => (
        <Badge key={t} variant="outline" className="h-6 max-w-40 gap-0.5 pr-0.5 font-normal">
          <span className="truncate">{t}</span>
          <button
            type="button"
            onClick={() => onRemove(t)}
            aria-label={`Remove tag ${t}`}
            className="flex size-4 items-center justify-center rounded-[3px] text-fg-faint transition-colors hover:bg-fill-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <XIcon aria-hidden className="size-3" />
          </button>
        </Badge>
      ))}
      <TagAdder existing={tags} suggestions={suggestions} onAdd={onAdd}>
        <PlusIcon aria-hidden className="size-3.5" />
        {tags.length ? <span className="sr-only">Add tag</span> : "Add tag"}
      </TagAdder>
    </span>
  );
}

/** Popover with a text field and matching workspace tags. Used on the record and by the bulk bar. */
export function TagAdder({
  existing = [],
  suggestions,
  onAdd,
  children,
  triggerClassName,
  side = "bottom",
}: {
  existing?: string[];
  suggestions: string[];
  onAdd: (tag: string) => void;
  children: React.ReactNode;
  triggerClassName?: string;
  side?: "top" | "bottom";
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const id = useId();
  const needle = normalizeTag(text);
  const matches = useMemo(
    () => suggestions.filter((s) => !existing.includes(s) && (!needle || s.includes(needle))).slice(0, 8),
    [suggestions, existing, needle],
  );
  const canCreate = needle.length > 0 && !suggestions.includes(needle) && !existing.includes(needle);
  const add = (tag: string) => {
    onAdd(tag);
    setText("");
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "inline-flex h-6 items-center gap-1 rounded-sm px-1.5 text-caption text-muted-foreground transition-colors duration-100 outline-none hover:bg-fill-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-expanded:bg-fill-hover",
          triggerClassName,
        )}
      >
        {children}
      </PopoverTrigger>
      <PopoverContent align="start" side={side} className="w-64 gap-0 p-0">
        <form
          className="border-b p-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (needle) add(needle);
          }}
        >
          <label htmlFor={id} className="sr-only">
            Tag
          </label>
          <div className="flex items-center gap-2 px-1.5">
            <TagIcon aria-hidden className="size-3.5 shrink-0 text-fg-faint" />
            <input
              id={id}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Find or create a tag…"
              autoComplete="off"
              spellCheck={false}
              maxLength={40}
              className="h-8 min-w-0 flex-1 bg-transparent text-ui outline-none placeholder:text-fg-faint max-sm:text-base"
            />
          </div>
        </form>
        <div className="max-h-60 overflow-y-auto p-1" role="listbox" aria-label="Tags">
          {matches.map((s) => (
            <button
              key={s}
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => add(s)}
              className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-ui outline-none hover:bg-fill-hover focus-visible:bg-fill-hover"
            >
              <span className="size-1.5 shrink-0 rounded-full bg-fg-faint" aria-hidden />
              <span className="truncate">{s}</span>
            </button>
          ))}
          {canCreate ? (
            <button
              type="button"
              onClick={() => add(needle)}
              className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-ui outline-none hover:bg-fill-hover focus-visible:bg-fill-hover"
            >
              <PlusIcon aria-hidden className="size-3.5 text-muted-foreground" />
              <span className="truncate">
                Create “<span className="font-medium">{needle}</span>”
              </span>
            </button>
          ) : null}
          {!matches.length && !canCreate ? <p className="px-2 py-2 text-caption text-muted-foreground">{needle ? "Already tagged." : "Type to create the first tag."}</p> : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
