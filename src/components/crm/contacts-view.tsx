"use client";

import { ArrowDownIcon, ArrowUpIcon, ChevronLeftIcon, ChevronRightIcon, SearchXIcon, UsersIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { navProgress } from "@/components/app-shell";
import { BrandGlyph } from "@/components/brand-icon";
import { Button } from "@/components/ui/button";
import {
  COLUMN_LABELS,
  COLUMN_SORT,
  contactsHref,
  hasFilters,
  NUMERIC_COLUMNS,
  type ContactColumn,
  type ContactGroupTotals,
  type ContactListRow,
  type ContactQuery,
  type ContactTotals,
  type ContactView,
  type CrmAbilities,
  type CrmMember,
  type FilterOptions,
  type Lifecycle,
} from "@/lib/crm-query";
import { useHotkeys } from "@/lib/hotkeys";
import { channelLabel, moneyWhole, num, platformLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BulkBar } from "./bulk-bar";
import { ContactAvatar } from "./contact-avatar";
import { Engagement } from "./contact-panel";
import { ContactPeek } from "./contact-peek";
import { DisplayMenu, FilterChips, FilterMenu, SearchBox, ViewTabs, type FilterField } from "./contacts-toolbar";
import { contactName, relative, shortDay, touchSource } from "./crm-format";
import { LifecycleBadge, OwnerChip, TagList } from "./properties";

export const LIST_CONTEXT_KEY = "adledger:crm-list";

type Props = {
  query: ContactQuery;
  rows: ContactListRow[];
  nextCursor: string | null;
  prevCursor: string | null;
  totals: ContactTotals;
  groups: ContactGroupTotals | null;
  counts: Record<string, number>;
  views: ContactView[];
  options: FilterOptions;
  members: CrmMember[];
  abilities: CrmAbilities;
  viewerId: string;
  currency: string;
  timezone: string;
  now: string;
  highValueMinor: number | null;
  canSetup: boolean;
};

/**
 * Contacts v2: view tabs, filter chips, Display options, a keyboard-driven table with footer
 * totals and group-by, checkbox selection with a floating bulk bar, and the preview sheet.
 * All table state lives in the URL; changes keep the old rows on screen (dimmed) until the new
 * ones arrive.
 */
export function ContactsView(p: Props) {
  const { query, rows, totals, currency, timezone: tz, now, members, abilities } = p;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState<number>(-1);
  const [peek, setPeek] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterField, setFilterField] = useState<FilterField | null>(null);
  const anchor = useRef<number | null>(null);
  const bodyRef = useRef<HTMLTableSectionElement>(null);

  useEffect(() => {
    if (pending) navProgress.start("contacts");
    else navProgress.done("contacts");
  }, [pending]);
  useEffect(() => () => navProgress.done("contacts"), []);

  // A new page of rows: drop selection and focus that no longer point at visible rows.
  const rowIds = rows.map((r) => r.id).join(",");
  const [seenRows, setSeenRows] = useState(rowIds);
  if (seenRows !== rowIds) {
    setSeenRows(rowIds);
    const visible = new Set(rows.map((r) => r.id));
    setSelected((s) => new Set([...s].filter((id) => visible.has(id))));
    setFocus(-1);
  }

  const go = useCallback((href: string, replace = false) => startTransition(() => (replace ? router.replace(href, { scroll: false }) : router.push(href, { scroll: false }))), [router]);
  const navigate = useCallback(
    (patch: Partial<ContactQuery>, opts: { replace?: boolean } = {}) => go(contactsHref(query, patch), opts.replace),
    [go, query],
  );

  const tagSuggestions = useMemo(() => p.options.tags.map((t) => t.tag), [p.options.tags]);
  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  const rememberList = useCallback(() => {
    try {
      sessionStorage.setItem(LIST_CONTEXT_KEY, JSON.stringify({ ids: rows.map((r) => r.id), href: contactsHref(query, { cursor: query.cursor }) }));
    } catch {}
  }, [rows, query]);
  const openRecord = useCallback(
    (id: string) => {
      rememberList();
      router.push(`/contacts/${id}`);
    },
    [rememberList, router],
  );

  const toggle = (index: number, range: boolean) => {
    const id = rows[index]?.id;
    if (!id) return;
    setSelected((s) => {
      const next = new Set(s);
      if (range && anchor.current !== null) {
        const [a, b] = [Math.min(anchor.current, index), Math.max(anchor.current, index)];
        const on = !s.has(id);
        for (let i = a; i <= b; i++) {
          if (on) next.add(rows[i].id);
          else next.delete(rows[i].id);
        }
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    anchor.current = index;
  };

  const moveFocus = (delta: number) => {
    if (!rows.length) return;
    const next = Math.min(rows.length - 1, Math.max(0, (focus < 0 ? (delta > 0 ? -1 : rows.length) : focus) + delta));
    setFocus(next);
    bodyRef.current?.querySelector<HTMLElement>(`[data-row="${next}"]`)?.scrollIntoView({ block: "nearest" });
  };
  const peekIndex = peek ? rows.findIndex((r) => r.id === peek) : -1;
  const movePeek = (delta: 1 | -1) => {
    const i = peekIndex + delta;
    if (i < 0 || i >= rows.length) return;
    setPeek(rows[i].id);
    setFocus(i);
    bodyRef.current?.querySelector<HTMLElement>(`[data-row="${i}"]`)?.scrollIntoView({ block: "nearest" });
  };

  useHotkeys([
    { id: "contacts.next", keys: "j", label: "Next contact", group: "Contacts", run: () => moveFocus(1) },
    { id: "contacts.prev", keys: "k", label: "Previous contact", group: "Contacts", run: () => moveFocus(-1) },
    { id: "contacts.peek", keys: "space", label: "Preview the focused contact", group: "Contacts", run: () => (focus >= 0 ? void setPeek(rows[focus].id) : false) },
    { id: "contacts.open", keys: "o", label: "Open the focused contact", group: "Contacts", run: () => (focus >= 0 ? void openRecord(rows[focus].id) : false) },
    { id: "contacts.open-enter", keys: "enter", label: "Open the focused contact", group: "Contacts", hidden: true, run: () => (focus >= 0 ? void openRecord(rows[focus].id) : false) },
    { id: "contacts.select", keys: "x", label: "Select the focused contact", group: "Contacts", run: () => (focus >= 0 ? void toggle(focus, false) : false) },
    { id: "contacts.select-range", keys: "shift+x", label: "Select a range of contacts", group: "Contacts", run: () => (focus >= 0 ? void toggle(focus, true) : false) },
    { id: "contacts.clear", keys: "escape", label: "Clear the selection", group: "Contacts", run: () => (selected.size ? void setSelected(new Set()) : false) },
    { id: "contacts.filter", keys: "f", label: "Add a filter", group: "Contacts", run: () => void setFilterOpen(true) },
  ]);

  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someOnPage = rows.some((r) => selected.has(r.id));
  const filtered = hasFilters(query) || query.view !== "all";
  const empty = rows.length === 0;
  const firstRun = empty && !filtered && p.counts.all === 0;
  const compact = query.density === "compact";
  const cols = query.cols;
  const colSpan = cols.length + 2;

  const sortHeader = (c: ContactColumn) => {
    const s = COLUMN_SORT[c];
    const active = s && query.sort === s;
    const label = COLUMN_LABELS[c];
    if (!s) return label;
    return (
      <button
        type="button"
        onClick={() => navigate({ sort: s, dir: active ? (query.dir === "desc" ? "asc" : "desc") : "desc" })}
        className={cn("-mx-1 inline-flex items-center gap-1 rounded-sm px-1 outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring", active && "text-foreground")}
        aria-label={`Sort by ${label}`}
      >
        {label}
        {active ? query.dir === "desc" ? <ArrowDownIcon aria-hidden className="size-3" /> : <ArrowUpIcon aria-hidden className="size-3" /> : null}
      </button>
    );
  };

  return (
    <div className="@container space-y-3">
      {/* Views + search, filter, display */}
      <div className="flex flex-col gap-2 @3xl:flex-row @3xl:items-center @3xl:justify-between">
        <ViewTabs query={query} views={p.views} counts={p.counts} highValueMinor={p.highValueMinor} currency={currency} onNavigateHref={(h) => go(h)} />
        <div className="flex items-center gap-1">
          <SearchBox value={query.q} onChange={(q) => navigate({ q }, { replace: true })} />
          <FilterMenu
            query={query}
            options={p.options}
            members={members}
            viewerId={p.viewerId}
            currency={currency}
            navigate={navigate}
            open={filterOpen}
            onOpenChange={setFilterOpen}
            field={filterField}
            onFieldChange={setFilterField}
          />
          <DisplayMenu query={query} navigate={navigate} />
        </div>
      </div>

      <FilterChips
        query={query}
        options={p.options}
        members={members}
        currency={currency}
        navigate={navigate}
        onEdit={(f) => {
          setFilterField(f);
          setFilterOpen(true);
        }}
      />

      {firstRun ? (
        <FirstRun canSetup={p.canSetup} />
      ) : (
        <section aria-label="Contacts" aria-busy={pending || undefined} className={cn("overflow-hidden rounded-xl bg-card shadow-sm transition-opacity duration-150", pending && "opacity-60")}>
          <div className="@3xl:max-h-[calc(100dvh-15rem)] @3xl:min-h-72 @3xl:overflow-auto">
            <table className="w-full border-separate border-spacing-0 text-ui">
              <thead className="sticky top-0 z-20 hidden bg-bg-subtle @3xl:table-header-group">
                <tr className="[&>th]:h-9 [&>th]:border-b [&>th]:px-3 [&>th]:text-left [&>th]:text-caption [&>th]:font-medium [&>th]:whitespace-nowrap [&>th]:text-muted-foreground">
                  <th scope="col" className="sticky left-0 z-10 w-10 bg-bg-subtle !pr-0">
                    <Check
                      checked={allOnPage}
                      indeterminate={!allOnPage && someOnPage}
                      label={allOnPage ? "Clear selection" : "Select all on this page"}
                      onChange={() => setSelected(allOnPage ? new Set() : new Set(rows.map((r) => r.id)))}
                      disabled={empty}
                    />
                  </th>
                  <th scope="col" className="sticky left-10 z-10 min-w-56 bg-bg-subtle">
                    <button
                      type="button"
                      onClick={() => navigate({ sort: "name", dir: query.sort === "name" && query.dir === "asc" ? "desc" : "asc" })}
                      className={cn("-mx-1 inline-flex items-center gap-1 rounded-sm px-1 outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring", query.sort === "name" && "text-foreground")}
                      aria-label="Sort by name"
                    >
                      Name
                      {query.sort === "name" ? query.dir === "desc" ? <ArrowDownIcon aria-hidden className="size-3" /> : <ArrowUpIcon aria-hidden className="size-3" /> : null}
                    </button>
                  </th>
                  {cols.map((c) => (
                    <th key={c} scope="col" className={cn(NUMERIC_COLUMNS.has(c) && "text-right", WIDTH[c])}>
                      {sortHeader(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody ref={bodyRef}>
                {empty ? (
                  <tr>
                    <td colSpan={colSpan}>
                      <FilteredEmpty query={query} highValueMinor={p.highValueMinor} onClear={() => go(query.view === "all" ? "/contacts" : `/contacts?view=${query.view}`)} />
                    </td>
                  </tr>
                ) : (
                  rows.map((r, i) => {
                    const groupStart = query.group && (i === 0 || rows[i - 1].lifecycle !== r.lifecycle);
                    const isSel = selected.has(r.id);
                    const isFocus = focus === i || peek === r.id;
                    return (
                      <FragmentRows key={r.id}>
                        {groupStart ? <GroupRow lifecycle={r.lifecycle} totals={p.groups?.[r.lifecycle]} currency={currency} colSpan={colSpan} /> : null}
                        <tr
                          data-row={i}
                          aria-selected={isSel || undefined}
                          onClick={(e) => {
                            if ((e.target as HTMLElement).closest("a, button, input, label")) return;
                            setFocus(i);
                            setPeek(r.id);
                          }}
                          className={cn(
                            "group/row cursor-pointer [content-visibility:auto] [contain-intrinsic-size:auto_40px] [&>td]:border-b [&>td]:px-3 [&>td]:transition-colors [&>td]:duration-100",
                            compact ? "[&>td]:h-9" : "[&>td]:h-11",
                            "[&>td]:bg-card hover:[&>td]:bg-fill",
                            isSel && "[&>td]:bg-[color-mix(in_oklch,var(--brand)_8%,var(--card))] hover:[&>td]:bg-[color-mix(in_oklch,var(--brand)_12%,var(--card))]",
                            isFocus && "[&>td:first-child]:shadow-[inset_2px_0_0_var(--fg-muted)]",
                            isSel && "[&>td:first-child]:shadow-[inset_2px_0_0_var(--brand)]",
                          )}
                        >
                          <td className="sticky left-0 z-[1] hidden w-10 !pr-0 @3xl:table-cell">
                            <Check checked={isSel} label={`Select ${contactName(r)}`} onChange={(shift) => toggle(i, shift)} />
                          </td>
                          <td className="sticky left-10 z-[1] max-w-0 min-w-0 @3xl:max-w-80 @3xl:min-w-56">
                            <NameCell row={r} onOpen={() => { setFocus(i); setPeek(r.id); }} onNavigate={rememberList} currency={currency} showRevenue={!cols.includes("revenue")} />
                          </td>
                          {cols.map((c) => (
                            <td key={c} className={cn(c !== "revenue" && "hidden @3xl:table-cell", NUMERIC_COLUMNS.has(c) && "text-right num", c === "revenue" && "w-24 text-right @3xl:w-auto")}>
                              <Cell column={c} row={r} currency={currency} tz={tz} now={now} owner={r.ownerUserId ? memberById.get(r.ownerUserId) : undefined} />
                            </td>
                          ))}
                        </tr>
                      </FragmentRows>
                    );
                  })
                )}
              </tbody>
              {!empty ? (
                <tfoot className="sticky bottom-0 z-20">
                  <tr className="[&>td]:h-10 [&>td]:border-t [&>td]:bg-bg-subtle [&>td]:px-3 [&>td]:text-caption [&>td]:text-muted-foreground">
                    <td className="sticky left-0 z-10 hidden @3xl:table-cell" />
                    <td className="sticky left-10 z-10">
                      <span className="num">
                        <b className="font-medium text-foreground">{num(totals.count)}</b> {totals.count === 1 ? "contact" : "contacts"}
                        {totals.customers ? <> · {num(totals.customers)} paying</> : null}
                      </span>
                    </td>
                    {cols.map((c) => (
                      <td key={c} className={cn(c !== "revenue" && "hidden @3xl:table-cell", NUMERIC_COLUMNS.has(c) && "text-right num")}>
                        <Footer column={c} totals={totals} currency={currency} />
                      </td>
                    ))}
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        </section>
      )}

      {!empty && (p.prevCursor || p.nextCursor) ? (
        <nav aria-label="Pages" className="flex items-center justify-between gap-3 text-caption text-muted-foreground">
          <span className="num">
            Showing {num(rows.length)} of {num(totals.count)}
          </span>
          <div className="flex gap-1.5">
            <Button variant="outline" size="sm" disabled={!p.prevCursor} onClick={() => p.prevCursor && navigate({ cursor: p.prevCursor })} className="max-sm:h-9">
              <ChevronLeftIcon /> Previous
            </Button>
            <Button variant="outline" size="sm" disabled={!p.nextCursor} onClick={() => p.nextCursor && navigate({ cursor: p.nextCursor })} className="max-sm:h-9">
              Next <ChevronRightIcon />
            </Button>
          </div>
        </nav>
      ) : null}

      <BulkBar
        ids={[...selected]}
        members={members}
        viewerId={p.viewerId}
        tagSuggestions={tagSuggestions}
        abilities={abilities}
        onClear={() => setSelected(new Set())}
        onDeleted={() => setSelected(new Set())}
      />

      <ContactPeek
        contactId={peek}
        position={peekIndex + 1}
        total={rows.length}
        onClose={() => setPeek(null)}
        onMove={movePeek}
        onOpen={openRecord}
        members={members}
        tagSuggestions={tagSuggestions}
        abilities={abilities}
        viewerId={p.viewerId}
        now={now}
      />
    </div>
  );
}

function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

const WIDTH: Partial<Record<ContactColumn, string>> = {
  lifecycle: "w-28",
  tags: "w-44",
  first_touch: "min-w-52",
  last_touch: "min-w-52",
  owner: "w-40",
  last_activity: "w-32",
  first_seen: "w-28",
};

function Check({ checked, indeterminate, label, onChange, disabled }: { checked: boolean; indeterminate?: boolean; label: string; onChange: (shift: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex size-7 cursor-pointer items-center justify-center rounded-md hover:bg-fill-hover">
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        ref={(el) => {
          if (el) el.indeterminate = Boolean(indeterminate);
        }}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onChange(e.shiftKey);
        }}
        onChange={() => undefined}
        className="size-3.5 cursor-pointer accent-[var(--brand)]"
      />
    </label>
  );
}

function NameCell({ row: r, onOpen, onNavigate, currency, showRevenue }: { row: ContactListRow; onOpen: () => void; onNavigate: () => void; currency: string; showRevenue: boolean }) {
  const source = touchSource(r.firstTouch);
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <ContactAvatar id={r.id} name={r.name} email={r.email} size="sm" />
      <div className="min-w-0 flex-1">
        <Link
          href={`/contacts/${r.id}`}
          onClick={(e) => {
            // Plain click previews; Ctrl/⌘/middle click still opens the record in a new tab.
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return onNavigate();
            e.preventDefault();
            onOpen();
          }}
          className="block min-w-0 truncate rounded-sm font-medium outline-none focus-visible:outline-2 focus-visible:outline-ring"
        >
          {r.name?.trim() || r.email || "Anonymous contact"}
          {r.name?.trim() && r.email ? (
            <span className="ml-1.5 hidden font-normal text-muted-foreground @5xl:inline" translate="no">
              {r.email}
            </span>
          ) : null}
        </Link>
        {/* Narrow screens: the hidden columns fold into one line under the name. */}
        <div className="flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground @3xl:hidden">
          <span className={cn("shrink-0", r.lifecycle === "customer" && "text-positive")}>{r.lifecycle === "customer" ? "Customer" : "Lead"}</span>
          {source ? (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{r.firstTouch?.campaign ?? source}</span>
            </>
          ) : null}
          {showRevenue && r.revenueMinor ? <span className="num ml-auto shrink-0 text-foreground">{moneyWhole(r.revenueMinor, currency)}</span> : null}
        </div>
      </div>
    </div>
  );
}

function TouchCell({ touch }: { touch: ContactListRow["firstTouch"] }) {
  if (!touch) return <span className="text-fg-faint">—</span>;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {touch.platform ? (
        <span aria-hidden className="inline-flex shrink-0">
          <BrandGlyph id={touch.platform} className="size-3.5" />
        </span>
      ) : null}
      <span className="shrink-0">{touch.platform ? platformLabel(touch.platform) : channelLabel(touch.channel)}</span>
      {touch.campaign ? <span className="min-w-0 truncate text-muted-foreground" title={touch.campaign}>· {touch.campaign}</span> : null}
    </span>
  );
}

function Cell({ column, row: r, currency, tz, now, owner }: { column: ContactColumn; row: ContactListRow; currency: string; tz: string; now: string; owner: CrmMember | undefined }) {
  const dash = <span className="text-fg-faint">—</span>;
  switch (column) {
    case "lifecycle":
      return <LifecycleBadge lifecycle={r.lifecycle} />;
    case "tags":
      return r.tags.length ? <TagList tags={r.tags} max={2} /> : dash;
    case "first_touch":
      return <TouchCell touch={r.firstTouch} />;
    case "last_touch":
      return <TouchCell touch={r.lastTouch} />;
    case "touches":
      return r.touches ? num(r.touches) : dash;
    case "orders":
      return r.orders ? num(r.orders) : dash;
    case "revenue":
      return r.revenueMinor ? <span className={cn("font-medium", r.revenueMinor < 0 && "text-negative")}>{moneyWhole(r.revenueMinor, currency)}</span> : dash;
    case "engagement":
      return <Engagement score={r.engagement} compact />;
    case "days_to_convert":
      return r.daysToConvert === null ? dash : r.daysToConvert === 0 ? "Same day" : num(r.daysToConvert);
    case "last_activity":
      return <span className="text-muted-foreground">{relative(r.lastActivityAt, tz, now)}</span>;
    case "first_seen":
      return <span className="text-muted-foreground">{shortDay(r.firstSeenAt, tz, now)}</span>;
    case "owner":
      return <OwnerChip member={owner} compact />;
  }
}

function Footer({ column, totals, currency }: { column: ContactColumn; totals: ContactTotals; currency: string }) {
  if (column === "revenue")
    return (
      <span className="inline-flex flex-col items-end leading-tight">
        <b className="font-medium text-foreground">{moneyWhole(totals.revenueMinor, currency)}</b>
        {totals.avgLtvMinor !== null ? <span className="text-micro font-normal">avg {moneyWhole(totals.avgLtvMinor, currency)} LTV</span> : null}
      </span>
    );
  if (column === "days_to_convert") return totals.medianDaysToConvert === null ? null : <span title="Median days from first visit to first payment">median {num(totals.medianDaysToConvert, totals.medianDaysToConvert % 1 ? 1 : 0)}</span>;
  return null;
}

function GroupRow({ lifecycle, totals, currency, colSpan }: { lifecycle: Lifecycle; totals: ContactTotals | undefined; currency: string; colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="h-9 border-b bg-bg-subtle px-3">
        <div className="sticky left-3 flex w-fit items-center gap-2 text-caption">
          <LifecycleBadge lifecycle={lifecycle} />
          <span className="num text-muted-foreground">
            {num(totals?.count ?? 0)} {lifecycle === "customer" ? "customers" : "leads"}
            {totals?.revenueMinor ? <> · {moneyWhole(totals.revenueMinor, currency)}</> : null}
            {totals?.avgLtvMinor ? <> · avg {moneyWhole(totals.avgLtvMinor, currency)}</> : null}
          </span>
        </div>
      </td>
    </tr>
  );
}

function FilteredEmpty({ query, highValueMinor, onClear }: { query: ContactQuery; highValueMinor: number | null; onClear: () => void }) {
  const noHigh = query.view === "high" && !highValueMinor;
  const starterOnly = !hasFilters(query) && query.view !== "all";
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-fill text-muted-foreground">
        <SearchXIcon aria-hidden className="size-5" strokeWidth={1.75} />
      </span>
      <div className="space-y-1">
        <p className="text-body font-medium">{noHigh ? "No high-value customers yet" : starterOnly ? "Nobody in this view yet" : "No contacts match these filters"}</p>
        <p className="mx-auto max-w-sm text-ui text-pretty text-muted-foreground">
          {noHigh
            ? "High value means the top 10% of paying customers by revenue. It fills in once payments arrive."
            : starterOnly
              ? "Contacts show up here as leads and payments come in."
              : query.q
                ? "Search looks at names and email addresses. Try part of the email, or remove a filter."
                : "Try removing a filter, or widen the revenue range or date."}
        </p>
      </div>
      {!starterOnly ? (
        <Button variant="outline" size="sm" onClick={onClear}>
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}

function FirstRun({ canSetup }: { canSetup: boolean }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl bg-card px-6 py-14 text-center shadow-sm">
      <span className="flex size-10 items-center justify-center rounded-full bg-fill text-muted-foreground">
        <UsersIcon aria-hidden className="size-5" strokeWidth={1.75} />
      </span>
      <div className="space-y-1">
        <p className="text-title-sm">No contacts yet</p>
        <p className="mx-auto max-w-md text-ui text-pretty text-muted-foreground">
          Contacts appear when someone submits a form on your site, a form tool calls your lead webhook, or a payment arrives, each with the ads and visits
          that brought them in.
        </p>
      </div>
      {canSetup ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button render={<Link href="/onboarding#leads" />}>Capture your first lead</Button>
          <Button variant="outline" render={<Link href="/onboarding#revenue" />}>
            Connect payments
          </Button>
        </div>
      ) : null}
    </div>
  );
}
