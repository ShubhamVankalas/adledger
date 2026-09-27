"use client";

import {
  ArrowDownIcon,
  ArrowUpIcon,
  CalendarIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  CircleDollarSignIcon,
  FlagIcon,
  ListFilterIcon,
  MegaphoneIcon,
  PlusIcon,
  SearchIcon,
  Settings2Icon,
  TagIcon,
  UserRoundIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { deleteViewAction, saveViewAction, updateViewAction } from "@/app/actions/crm";
import { BrandGlyph } from "@/components/brand-icon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ADDED_LABELS,
  ADDED_RANGES,
  COLUMN_LABELS,
  CONTACT_COLUMNS,
  contactQueryParams,
  DEFAULT_COLUMNS,
  DEFAULT_QUERY,
  STARTER_VIEWS,
  VIEW_KEYS,
  viewSignature,
  type AddedRange,
  type ContactColumn,
  type ContactQuery,
  type ContactSort,
  type ContactView,
  type CrmMember,
  type FilterOptions,
} from "@/lib/crm-query";
import { moneyWhole, platformLabel } from "@/lib/format";
import { fromDecimalString } from "@/lib/money";
import { cn } from "@/lib/utils";
import { memberName } from "./properties";
import { runAction } from "./run-action";

type Navigate = (patch: Partial<ContactQuery>, opts?: { replace?: boolean }) => void;

// ---------------------------------------------------------------- view tabs

export function ViewTabs({
  query,
  views,
  counts,
  highValueMinor,
  currency,
  onNavigateHref,
}: {
  query: ContactQuery;
  views: ContactView[];
  counts: Record<string, number>;
  highValueMinor: number | null;
  currency: string;
  onNavigateHref: (href: string) => void;
}) {
  const active = views.find((v) => v.id === query.view);
  const current = contactQueryParams(query, VIEW_KEYS);
  const changed = active ? viewSignature(current) !== viewSignature(active.filters) : false;
  const starterChanged = !active && Object.keys(current).length > 0;
  const hrefFor = (v: ContactView) => `/contacts?${new URLSearchParams({ view: v.id, ...v.filters })}`;

  return (
    <div className="flex min-w-0 items-center gap-2">
      <nav aria-label="Views" className="-mx-1 flex min-w-0 items-center gap-0.5 overflow-x-auto px-1 [scrollbar-width:none]">
        {STARTER_VIEWS.map((s) => {
          const on = query.view === s.id;
          return (
            <Link
              key={s.id}
              href={s.id === "all" ? "/contacts" : `/contacts?view=${s.id}`}
              aria-current={on ? "page" : undefined}
              title={s.id === "high" ? (highValueMinor ? `Customers with at least ${moneyWhole(highValueMinor, currency)} in revenue (top 10%)` : "No paying customers yet") : undefined}
              className={cn(
                "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-ui font-medium whitespace-nowrap text-muted-foreground transition-colors duration-100 outline-none hover:bg-fill-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                on && "bg-fill-active text-foreground hover:bg-fill-active",
              )}
            >
              {s.label}
              <span className="num text-caption font-normal text-muted-foreground">{(counts[s.id] ?? 0).toLocaleString("en-US")}</span>
            </Link>
          );
        })}
        {views.map((v) =>
          v.id === query.view ? (
            <ViewMenu key={v.id} view={v} changed={changed} current={current} onNavigateHref={onNavigateHref} />
          ) : (
            <Link
              key={v.id}
              href={hrefFor(v)}
              className="inline-flex h-7 max-w-44 shrink-0 items-center rounded-md px-2.5 text-ui font-medium whitespace-nowrap text-muted-foreground transition-colors duration-100 outline-none hover:bg-fill-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            >
              <span className="truncate">{v.name}</span>
            </Link>
          ),
        )}
        <NewViewButton current={current} onNavigateHref={onNavigateHref} highlight={starterChanged} />
      </nav>
    </div>
  );
}

function ViewMenu({ view, changed, current, onNavigateHref }: { view: ContactView; changed: boolean; current: Record<string, string>; onNavigateHref: (href: string) => void }) {
  const [renaming, setRenaming] = useState(false);
  return (
    <span className="inline-flex shrink-0 items-center">
      <DropdownMenu>
        <DropdownMenuTrigger
          className="inline-flex h-7 max-w-52 items-center gap-1 rounded-md bg-fill-active px-2.5 text-ui font-medium text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
          aria-label={`${view.name} view options`}
        >
          <span className="truncate">{view.name}</span>
          {changed ? <span className="size-1.5 shrink-0 rounded-full bg-brand" aria-label="Unsaved changes" /> : null}
          <ChevronDownIcon aria-hidden className="size-3.5 shrink-0 text-fg-faint" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-52">
          {changed ? (
            <>
              <DropdownMenuItem
                onClick={() =>
                  void runAction(updateViewAction(view.id, { filters: current }), { success: `Saved “${view.name}”` }).then((r) => r.ok && onNavigateHref(`/contacts?${new URLSearchParams({ view: view.id, ...current })}`))
                }
              >
                <CheckIcon />
                Save changes
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onNavigateHref(`/contacts?${new URLSearchParams({ view: view.id, ...view.filters })}`)}>
                <XIcon />
                Discard changes
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuItem onClick={() => setRenaming(true)}>Rename…</DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={() =>
              void runAction(deleteViewAction(view.id), {
                success: `Deleted “${view.name}”`,
                undo: async () => {
                  const r = await saveViewAction(view.name, view.filters);
                  if (r.ok) onNavigateHref(`/contacts?${new URLSearchParams({ view: String(r.data?.id), ...view.filters })}`);
                  return r;
                },
              }).then((r) => r.ok && onNavigateHref("/contacts"))
            }
          >
            Delete view
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {changed ? (
        <Button
          variant="ghost"
          size="xs"
          className="ml-1 text-brand-foreground hover:text-brand-foreground"
          onClick={() =>
            void runAction(updateViewAction(view.id, { filters: current }), { success: `Saved “${view.name}”` }).then((r) => r.ok && onNavigateHref(`/contacts?${new URLSearchParams({ view: view.id, ...current })}`))
          }
        >
          Save
        </Button>
      ) : null}
      {renaming ? (
        <NameDialog
          title="Rename view"
          initial={view.name}
          confirm="Rename"
          onClose={() => setRenaming(false)}
          onSubmit={async (name) => {
            const r = await runAction(updateViewAction(view.id, { name }), { success: "View renamed" });
            if (r.ok) setRenaming(false);
          }}
        />
      ) : null}
    </span>
  );
}

function NewViewButton({ current, onNavigateHref, highlight }: { current: Record<string, string>; onNavigateHref: (href: string) => void; highlight: boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const id = useId();
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setName("");
      }}
    >
      <PopoverTrigger
        className={cn(
          "inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-ui font-medium text-muted-foreground transition-colors duration-100 outline-none hover:bg-fill-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring aria-expanded:bg-fill-hover",
          highlight && "text-brand-foreground",
        )}
        aria-label="Save as a new view"
      >
        <PlusIcon aria-hidden className="size-3.5" />
        <span className={cn(!highlight && "sr-only")}>Save view</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim() || busy) return;
            setBusy(true);
            const r = await runAction(saveViewAction(name.trim(), current));
            setBusy(false);
            if (r.ok) {
              setOpen(false);
              onNavigateHref(`/contacts?${new URLSearchParams({ view: String(r.data?.id), ...current })}`);
            }
          }}
        >
          <div className="space-y-1.5">
            <label htmlFor={id} className="text-ui font-medium">
              New view
            </label>
            <p className="text-caption text-muted-foreground">Saves the current filters, columns and sort as a tab only you see.</p>
          </div>
          <input
            id={id}
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            placeholder="e.g. Meta buyers this quarter…"
            autoComplete="off"
            className="h-8 w-full rounded-md border border-border-strong bg-transparent px-2.5 text-ui outline-none placeholder:text-fg-faint focus-visible:outline-2 focus-visible:outline-ring max-sm:text-base"
          />
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={!name.trim() || busy}>
              {busy ? "Saving…" : "Save view"}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function NameDialog({ title, initial, confirm, onClose, onSubmit }: { title: string; initial: string; confirm: string; onClose: () => void; onSubmit: (name: string) => Promise<void> }) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const id = useId();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            setBusy(true);
            await onSubmit(name.trim());
            setBusy(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <label htmlFor={id} className="sr-only">
            View name
          </label>
          <input
            id={id}
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            autoComplete="off"
            className="h-9 w-full rounded-md border border-border-strong bg-transparent px-2.5 text-body outline-none focus-visible:outline-2 focus-visible:outline-ring max-sm:text-base"
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || busy}>
              {busy ? "Saving…" : confirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- search

export function SearchBox({ value, onChange }: { value: string; onChange: (q: string) => void }) {
  const [text, setText] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Follow the URL when it changes elsewhere (a view tab, "Clear filters").
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setText(value);
  }
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <div className="relative w-full min-w-0 sm:w-56">
      <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-faint" />
      <input
        type="search"
        data-hotkey-search
        value={text}
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => onChange(v.trim()), 300);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            clearTimeout(timer.current);
            onChange(text.trim());
          }
          if (e.key === "Escape" && text) {
            e.preventDefault();
            e.stopPropagation();
            setText("");
            onChange("");
          }
        }}
        placeholder="Search name or email…"
        aria-label="Search contacts"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        className="h-8 w-full rounded-md border border-border bg-surface pr-8 pl-8 text-ui outline-none transition-[border-color,box-shadow] duration-100 placeholder:text-fg-faint hover:border-border-strong focus-visible:border-border-strong focus-visible:shadow-[0_0_0_3px_var(--ring)] max-sm:h-9 max-sm:text-base [&::-webkit-search-cancel-button]:hidden"
      />
      {text ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setText("");
            onChange("");
          }}
          className="absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-fg-faint hover:bg-fill-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <XIcon aria-hidden className="size-3.5" />
        </button>
      ) : (
        <kbd aria-hidden className="kbd pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 max-sm:hidden">
          /
        </kbd>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- filters

type Field = "lc" | "platform" | "campaign" | "revenue" | "tag" | "owner" | "added";
const FIELDS: { id: Field; label: string; icon: typeof FlagIcon }[] = [
  { id: "lc", label: "Status", icon: FlagIcon },
  { id: "platform", label: "First touch platform", icon: MegaphoneIcon },
  { id: "campaign", label: "First touch campaign", icon: MegaphoneIcon },
  { id: "revenue", label: "Revenue", icon: CircleDollarSignIcon },
  { id: "tag", label: "Tag", icon: TagIcon },
  { id: "owner", label: "Owner", icon: UserRoundIcon },
  { id: "added", label: "Date added", icon: CalendarIcon },
];

export function FilterMenu({
  query,
  options,
  members,
  viewerId,
  currency,
  navigate,
  open,
  onOpenChange,
  field,
  onFieldChange,
}: {
  query: ContactQuery;
  options: FilterOptions;
  members: CrmMember[];
  viewerId: string;
  currency: string;
  navigate: Navigate;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  field: Field | null;
  onFieldChange: (f: Field | null) => void;
}) {
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) onFieldChange(null);
      }}
    >
      <PopoverTrigger render={<Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" />}>
        <ListFilterIcon />
        Filter
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 gap-0 p-0">
        {field === null ? (
          <div className="p-1" role="menu" aria-label="Filter by">
            <p className="px-2 pt-1.5 pb-1 text-caption font-medium text-muted-foreground">Filter by</p>
            {FIELDS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="menuitem"
                onClick={() => onFieldChange(f.id)}
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-ui outline-none hover:bg-fill-hover focus-visible:bg-fill-hover"
              >
                <f.icon aria-hidden className="size-4 text-muted-foreground" strokeWidth={1.75} />
                <span className="flex-1">{f.label}</span>
                {isActive(query, f.id) ? <span className="size-1.5 rounded-full bg-brand" aria-label="active" /> : null}
              </button>
            ))}
          </div>
        ) : (
          <FieldEditor
            field={field}
            query={query}
            options={options}
            members={members}
            viewerId={viewerId}
            currency={currency}
            navigate={navigate}
            onBack={() => onFieldChange(null)}
            onDone={() => onOpenChange(false)}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

const isActive = (q: ContactQuery, f: Field) =>
  f === "lc" ? Boolean(q.lc) : f === "platform" ? q.platform.length > 0 : f === "campaign" ? Boolean(q.campaign) : f === "revenue" ? Boolean(q.revMin || q.revMax) : f === "tag" ? q.tag.length > 0 : f === "owner" ? Boolean(q.owner) : Boolean(q.added);

function Option({ selected, onClick, children, multi }: { selected: boolean; onClick: () => void; children: React.ReactNode; multi?: boolean }) {
  return (
    <button
      type="button"
      role={multi ? "menuitemcheckbox" : "menuitemradio"}
      aria-checked={selected}
      onClick={onClick}
      className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-ui outline-none hover:bg-fill-hover focus-visible:bg-fill-hover"
    >
      <span
        aria-hidden
        className={cn(
          "flex size-4 shrink-0 items-center justify-center border transition-colors",
          multi ? "rounded-[4px]" : "rounded-full",
          selected ? "border-transparent bg-primary text-primary-foreground" : "border-border-strong",
        )}
      >
        {selected ? <CheckIcon className="size-3" strokeWidth={2.5} /> : null}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-2">{children}</span>
    </button>
  );
}

function FieldEditor({
  field,
  query,
  options,
  members,
  viewerId,
  currency,
  navigate,
  onBack,
  onDone,
}: {
  field: Field;
  query: ContactQuery;
  options: FilterOptions;
  members: CrmMember[];
  viewerId: string;
  currency: string;
  navigate: Navigate;
  onBack: () => void;
  onDone: () => void;
}) {
  const label = FIELDS.find((f) => f.id === field)!.label;
  const [search, setSearch] = useState("");
  const [min, setMin] = useState(query.revMin ?? "");
  const [max, setMax] = useState(query.revMax ?? "");
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const campaigns = useMemo(() => options.campaigns.filter((c) => c.name.toLowerCase().includes(search.toLowerCase())).slice(0, 50), [options.campaigns, search]);
  const tags = useMemo(() => options.tags.filter((t) => t.tag.includes(search.toLowerCase())), [options.tags, search]);
  const searchable = field === "campaign" || field === "tag";

  return (
    <div>
      <div className="flex h-10 items-center gap-1 border-b px-1">
        <Button variant="ghost" size="icon-sm" aria-label="Back to fields" onClick={onBack}>
          <ChevronLeftIcon />
        </Button>
        <span className="text-ui font-medium">{label}</span>
        {isActive(query, field) ? (
          <Button
            variant="ghost"
            size="xs"
            className="ml-auto text-muted-foreground"
            onClick={() => {
              navigate(clearField(field));
              onDone();
            }}
          >
            Clear
          </Button>
        ) : null}
      </div>
      {searchable ? (
        <div className="border-b px-2.5">
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={field === "tag" ? "Find a tag…" : "Find a campaign…"}
            aria-label={field === "tag" ? "Find a tag" : "Find a campaign"}
            autoComplete="off"
            className="h-9 w-full bg-transparent text-ui outline-none placeholder:text-fg-faint max-sm:text-base"
          />
        </div>
      ) : null}
      <div className="max-h-72 overflow-y-auto p-1" role="menu" aria-label={label}>
        {field === "lc"
          ? (["lead", "customer"] as const).map((v) => (
              <Option
                key={v}
                selected={query.lc === v}
                onClick={() => {
                  navigate({ lc: query.lc === v ? null : v });
                  onDone();
                }}
              >
                {v === "lead" ? "Lead" : "Customer"}
              </Option>
            ))
          : null}
        {field === "platform" ? (
          <>
            {options.platforms.map((p) => (
              <Option key={p.id} multi selected={query.platform.includes(p.id)} onClick={() => navigate({ platform: toggle(query.platform, p.id) })}>
                <span aria-hidden className="inline-flex">
                  <BrandGlyph id={p.id} className="size-3.5" />
                </span>
                <span className="flex-1 truncate">{platformLabel(p.id)}</span>
                <span className="num text-caption text-fg-faint">{p.count.toLocaleString("en-US")}</span>
              </Option>
            ))}
            <Option multi selected={query.platform.includes("none")} onClick={() => navigate({ platform: toggle(query.platform, "none") })}>
              <span className="flex-1 text-muted-foreground">No ad platform (organic, direct)</span>
            </Option>
          </>
        ) : null}
        {field === "campaign" ? (
          campaigns.length ? (
            campaigns.map((c) => (
              <Option
                key={c.id}
                selected={query.campaign === c.id}
                onClick={() => {
                  navigate({ campaign: query.campaign === c.id ? null : c.id });
                  onDone();
                }}
              >
                <span aria-hidden className="inline-flex">
                  <BrandGlyph id={c.platform} className="size-3.5" />
                </span>
                <span className="flex-1 truncate" title={c.name}>
                  {c.name}
                </span>
                <span className="num text-caption text-fg-faint">{c.count.toLocaleString("en-US")}</span>
              </Option>
            ))
          ) : (
            <p className="px-2 py-2 text-caption text-muted-foreground">{options.campaigns.length ? "No campaign matches." : "No contacts came from a campaign yet."}</p>
          )
        ) : null}
        {field === "tag" ? (
          tags.length ? (
            tags.map((t) => (
              <Option key={t.tag} multi selected={query.tag.includes(t.tag)} onClick={() => navigate({ tag: toggle(query.tag, t.tag) })}>
                <span className="flex-1 truncate">{t.tag}</span>
                <span className="num text-caption text-fg-faint">{t.count.toLocaleString("en-US")}</span>
              </Option>
            ))
          ) : (
            <p className="px-2 py-2 text-caption text-muted-foreground">{options.tags.length ? "No tag matches." : "No tags yet. Tag contacts from the table or their record."}</p>
          )
        ) : null}
        {field === "owner" ? (
          <>
            <Option
              selected={query.owner === "me"}
              onClick={() => {
                navigate({ owner: query.owner === "me" ? null : "me" });
                onDone();
              }}
            >
              Me
            </Option>
            <Option
              selected={query.owner === "none"}
              onClick={() => {
                navigate({ owner: query.owner === "none" ? null : "none" });
                onDone();
              }}
            >
              <span className="text-muted-foreground">Unassigned</span>
            </Option>
            {members
              .filter((m) => m.canEdit && m.id !== viewerId)
              .map((m) => (
                <Option
                  key={m.id}
                  selected={query.owner === m.id}
                  onClick={() => {
                    navigate({ owner: query.owner === m.id ? null : m.id });
                    onDone();
                  }}
                >
                  <span className="truncate">{memberName(m)}</span>
                </Option>
              ))}
          </>
        ) : null}
        {field === "added"
          ? (Object.keys(ADDED_RANGES) as AddedRange[]).map((r) => (
              <Option
                key={r}
                selected={query.added === r}
                onClick={() => {
                  navigate({ added: query.added === r ? null : r });
                  onDone();
                }}
              >
                In the {ADDED_LABELS[r]}
              </Option>
            ))
          : null}
        {field === "revenue" ? (
          <form
            className="space-y-3 p-2"
            onSubmit={(e) => {
              e.preventDefault();
              navigate({ revMin: min.trim() || null, revMax: max.trim() || null });
              onDone();
            }}
          >
            <p className="text-caption text-muted-foreground">Net revenue per contact, in {currency}.</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="text-caption font-medium">At least</span>
                <input
                  inputMode="decimal"
                  value={min}
                  onChange={(e) => setMin(e.target.value.replace(/[^\d.]/g, ""))}
                  placeholder="0"
                  className="num h-8 w-full rounded-md border border-border-strong bg-transparent px-2.5 text-ui outline-none focus-visible:outline-2 focus-visible:outline-ring max-sm:text-base"
                />
              </label>
              <label className="space-y-1">
                <span className="text-caption font-medium">At most</span>
                <input
                  inputMode="decimal"
                  value={max}
                  onChange={(e) => setMax(e.target.value.replace(/[^\d.]/g, ""))}
                  placeholder="No limit"
                  className="num h-8 w-full rounded-md border border-border-strong bg-transparent px-2.5 text-ui outline-none focus-visible:outline-2 focus-visible:outline-ring max-sm:text-base"
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-1">
              {[
                ["Paying", "0.01", ""],
                ["Over 100", "100", ""],
                ["Over 1,000", "1000", ""],
              ].map(([l, lo, hi]) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => {
                    setMin(lo);
                    setMax(hi);
                  }}
                  className="h-6 rounded-sm bg-fill px-2 text-caption text-muted-foreground hover:bg-fill-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {l}
                </button>
              ))}
            </div>
            <div className="flex justify-end">
              <Button type="submit" size="sm">
                Apply
              </Button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}

function clearField(f: Field): Partial<ContactQuery> {
  switch (f) {
    case "lc":
      return { lc: null };
    case "platform":
      return { platform: [] };
    case "campaign":
      return { campaign: null };
    case "revenue":
      return { revMin: null, revMax: null };
    case "tag":
      return { tag: [] };
    case "owner":
      return { owner: null };
    case "added":
      return { added: null };
  }
}

/** Active filters as removable chips ("First touch is Meta, Google ×"). Clicking a chip edits it. */
export function FilterChips({
  query,
  options,
  members,
  currency,
  navigate,
  onEdit,
}: {
  query: ContactQuery;
  options: FilterOptions;
  members: CrmMember[];
  currency: string;
  navigate: Navigate;
  onEdit: (f: Field) => void;
}) {
  const chips: { field: Field | "q"; label: React.ReactNode; clear: Partial<ContactQuery> }[] = [];
  if (query.q) chips.push({ field: "q", label: <>Search contains <b>“{query.q}”</b></>, clear: { q: "" } });
  if (query.lc) chips.push({ field: "lc", label: <>Status is <b>{query.lc === "lead" ? "Lead" : "Customer"}</b></>, clear: { lc: null } });
  if (query.platform.length)
    chips.push({ field: "platform", label: <>First touch is <b>{query.platform.map((p) => (p === "none" ? "no ad platform" : platformLabel(p))).join(", ")}</b></>, clear: { platform: [] } });
  if (query.campaign)
    chips.push({ field: "campaign", label: <>Campaign is <b>{options.campaigns.find((c) => c.id === query.campaign)?.name ?? "a removed campaign"}</b></>, clear: { campaign: null } });
  if (query.revMin || query.revMax) {
    const fmt = (v: string) => moneyWhole(fromDecimalString(v, currency), currency);
    const text = query.revMin && query.revMax ? `${fmt(query.revMin)} – ${fmt(query.revMax)}` : query.revMin ? `at least ${fmt(query.revMin)}` : `at most ${fmt(query.revMax!)}`;
    chips.push({ field: "revenue", label: <>Revenue <b>{text}</b></>, clear: { revMin: null, revMax: null } });
  }
  if (query.tag.length) chips.push({ field: "tag", label: <>Tag is <b>{query.tag.join(", ")}</b></>, clear: { tag: [] } });
  if (query.owner) {
    const who = query.owner === "me" ? "me" : query.owner === "none" ? "unassigned" : memberName(members.find((m) => m.id === query.owner));
    chips.push({ field: "owner", label: <>Owner is <b>{who}</b></>, clear: { owner: null } });
  }
  if (query.added) chips.push({ field: "added", label: <>Added in the <b>{ADDED_LABELS[query.added]}</b></>, clear: { added: null } });
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
      {chips.map((c) => (
        <span key={c.field} className="inline-flex h-7 max-w-full items-center rounded-md bg-surface text-caption shadow-sm [&_b]:font-medium">
          {c.field === "q" ? (
            <span className="truncate pl-2.5 text-muted-foreground">{c.label}</span>
          ) : (
            <button
              type="button"
              onClick={() => onEdit(c.field as Field)}
              className="h-full truncate rounded-l-md pl-2.5 text-left text-muted-foreground outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&_b]:text-foreground"
            >
              {c.label}
            </button>
          )}
          <button
            type="button"
            aria-label="Remove filter"
            onClick={() => navigate(c.clear)}
            className="flex h-full w-7 shrink-0 items-center justify-center rounded-r-md text-fg-faint outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <XIcon aria-hidden className="size-3.5" />
          </button>
        </span>
      ))}
      {chips.length > 1 ? (
        <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => navigate({ q: "", lc: null, platform: [], campaign: null, revMin: null, revMax: null, tag: [], owner: null, added: null })}>
          Clear all
        </Button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- display

const SORT_LABELS: Record<ContactSort, string> = {
  first_seen: "Date added",
  last_activity: "Last activity",
  revenue: "Revenue",
  orders: "Orders",
  touches: "Touches",
  engagement: "Engagement",
  name: "Name",
};

export function DisplayMenu({ query, navigate }: { query: ContactQuery; navigate: Navigate }) {
  const cols = query.cols;
  const move = (c: ContactColumn, delta: -1 | 1) => {
    const i = cols.indexOf(c);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= cols.length) return;
    const next = [...cols];
    [next[i], next[j]] = [next[j], next[i]];
    navigate({ cols: next }, { replace: true });
  };
  const toggle = (c: ContactColumn) => {
    const next = cols.includes(c) ? cols.filter((x) => x !== c) : [...cols, c];
    navigate({ cols: next.length ? next : DEFAULT_COLUMNS }, { replace: true });
  };
  const hidden = CONTACT_COLUMNS.filter((c) => !cols.includes(c));
  const isDefault = cols.join() === DEFAULT_COLUMNS.join() && query.density === "compact" && !query.group && query.sort === DEFAULT_QUERY.sort && query.dir === DEFAULT_QUERY.dir;
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" />}>
        <Settings2Icon />
        Display
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-0 p-0">
        <div className="space-y-3 border-b p-3">
          <Row label="Sort by">
            <select
              value={query.sort}
              onChange={(e) => navigate({ sort: e.target.value as ContactSort, dir: e.target.value === "name" ? "asc" : "desc" })}
              aria-label="Sort by"
              className="h-7 min-w-0 flex-1 rounded-md border border-border-strong bg-surface px-2 text-ui text-foreground outline-none focus-visible:outline-2 focus-visible:outline-ring"
            >
              {(Object.keys(SORT_LABELS) as ContactSort[]).map((s) => (
                <option key={s} value={s}>
                  {SORT_LABELS[s]}
                </option>
              ))}
            </select>
            <Button variant="outline" size="icon-sm" aria-label={query.dir === "asc" ? "Ascending. Switch to descending" : "Descending. Switch to ascending"} onClick={() => navigate({ dir: query.dir === "asc" ? "desc" : "asc" })}>
              {query.dir === "asc" ? <ArrowUpIcon /> : <ArrowDownIcon />}
            </Button>
          </Row>
          <Row label="Group by">
            <Segmented
              value={query.group ?? "none"}
              options={[
                ["none", "None"],
                ["lifecycle", "Status"],
              ]}
              onChange={(v) => navigate({ group: v === "lifecycle" ? "lifecycle" : null })}
              label="Group by"
            />
          </Row>
          <Row label="Density">
            <Segmented
              value={query.density}
              options={[
                ["compact", "Compact"],
                ["comfortable", "Comfortable"],
              ]}
              onChange={(v) => navigate({ density: v as ContactQuery["density"] }, { replace: true })}
              label="Row density"
            />
          </Row>
        </div>
        <div className="p-1">
          <p className="flex items-center justify-between px-2 pt-1.5 pb-1 text-caption font-medium text-muted-foreground">
            Columns
            {!isDefault ? (
              <button
                type="button"
                className="rounded-sm text-caption font-normal hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                onClick={() => navigate({ cols: DEFAULT_COLUMNS, density: "compact", group: null, sort: DEFAULT_QUERY.sort, dir: DEFAULT_QUERY.dir })}
              >
                Reset
              </button>
            ) : null}
          </p>
          <ul className="max-h-72 overflow-y-auto">
            {[...cols, ...hidden].map((c) => {
              const on = cols.includes(c);
              const i = cols.indexOf(c);
              return (
                <li key={c} className="group/col flex h-8 items-center gap-1 rounded-md pr-1 hover:bg-fill-hover">
                  <label className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 px-2 text-ui">
                    <input type="checkbox" checked={on} onChange={() => toggle(c)} className="size-3.5 accent-[var(--ink)]" />
                    <span className={cn("truncate", !on && "text-muted-foreground")}>{COLUMN_LABELS[c]}</span>
                  </label>
                  {on ? (
                    <span className="flex opacity-60 group-hover/col:opacity-100 focus-within:opacity-100">
                      <Button variant="ghost" size="icon-xs" aria-label={`Move ${COLUMN_LABELS[c]} left`} disabled={i === 0} onClick={() => move(c, -1)}>
                        <ArrowUpIcon />
                      </Button>
                      <Button variant="ghost" size="icon-xs" aria-label={`Move ${COLUMN_LABELS[c]} right`} disabled={i === cols.length - 1} onClick={() => move(c, 1)}>
                        <ArrowDownIcon />
                      </Button>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 shrink-0 text-caption text-muted-foreground">{label}</span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">{children}</div>
    </div>
  );
}

function Segmented({ value, options, onChange, label }: { value: string; options: [string, string][]; onChange: (v: string) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex h-7 flex-1 items-center rounded-[7px] bg-fill p-0.5">
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => value !== v && onChange(v)}
          className={cn(
            "h-full flex-1 rounded-[5px] px-2 text-caption font-medium text-muted-foreground transition-[color,background-color,box-shadow] duration-150 outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
            value === v && "bg-surface text-foreground shadow-sm",
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

export type { Field as FilterField };
