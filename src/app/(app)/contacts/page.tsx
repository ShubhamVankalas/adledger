import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon, SearchIcon, UsersIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { PageBody, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { CHANNEL_LABELS, money } from "@/lib/format";
import { listContacts, type ContactRow } from "@/lib/reports";
import { cn } from "@/lib/utils";

export const metadata = { title: "Contacts" };
const PAGE = 50;
const FILTERS = [
  [undefined, "All"],
  ["lead", "Leads"],
  ["customer", "Customers"],
] as const;

export default async function ContactsPage({ searchParams }: PageProps<"/contacts">) {
  const user = await requireUser();
  const ws = user.workspace;
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const lifecycle = sp.lifecycle === "lead" || sp.lifecycle === "customer" ? sp.lifecycle : undefined;
  const page = Math.max(1, Math.floor(Number(sp.page)) || 1);
  const db = await getDb();
  const { rows, total } = await listContacts(db, ws, {
    search: q,
    lifecycle,
    limit: PAGE,
    offset: (page - 1) * PAGE,
  });
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const link = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(
      Object.entries({ q, lifecycle, page: String(page), ...patch }).filter(([k, v]) => v && !(k === "page" && v === "1")) as [string, string][],
    );
    const s = next.toString();
    return s ? `/contacts?${s}` : "/contacts";
  };
  const exportHref = `/api/v1/exports/contacts?${new URLSearchParams(Object.entries({ q, lifecycle }).filter(([, v]) => v) as [string, string][])}`;
  const dateFmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: ws.timezone,
  });
  const noun = lifecycle === "customer" ? "customer" : lifecycle === "lead" ? "lead" : "contact";
  const from = (page - 1) * PAGE + 1;
  const to = Math.min(total, page * PAGE);
  const firstTouch = (c: ContactRow) => ({
    primary: c.firstCampaign ?? (c.firstChannel ? (CHANNEL_LABELS[c.firstChannel] ?? c.firstChannel) : null),
    secondary: c.firstCampaign && c.firstChannel ? (CHANNEL_LABELS[c.firstChannel] ?? c.firstChannel) : null,
  });
  const revenue = (c: ContactRow) => (c.revenueMinor ? money(c.revenueMinor, ws.reportingCurrency) : "—");

  return (
    <>
      <PageHeader title="Contacts" description="Every lead and customer, with the journey that brought them in">
        {user.can("reports.export") && total > 0 ? (
          <Button variant="outline" size="sm" className="h-10 sm:h-7" render={<a href={exportHref} download />}>
            <DownloadIcon /> Export <span className="max-sm:sr-only">CSV</span>
          </Button>
        ) : null}
      </PageHeader>
      <PageBody>
        {/* Toolbar: search + lifecycle filter. Stacks in narrow containers, one row when there is room. */}
        <div className="@container">
          <div className="flex flex-col gap-3 @xl:flex-row @xl:items-center @xl:justify-between">
            <form className="relative w-full @xl:max-w-sm" action="/contacts" role="search">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Search by email or name…"
                aria-label="Search contacts"
                enterKeyHint="search"
                autoComplete="off"
                className="h-10 pr-10 pl-9 @xl:h-9 [&::-webkit-search-cancel-button]:hidden"
              />
              {lifecycle ? <input type="hidden" name="lifecycle" value={lifecycle} /> : null}
              {q ? (
                <Link
                  href={link({ q: undefined, page: undefined })}
                  aria-label="Clear search"
                  className="absolute top-1/2 right-0.5 flex size-9 -translate-y-1/2 items-center @xl:size-8 justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <XIcon className="size-4" />
                </Link>
              ) : null}
            </form>
            <nav aria-label="Filter by status" className="grid grid-cols-3 gap-1 rounded-lg border bg-muted/40 p-1 text-sm @xl:flex @xl:h-9 @xl:shrink-0 @xl:p-0.5">
              {FILTERS.map(([v, label]) => (
                <Link
                  key={label}
                  href={link({ lifecycle: v, page: undefined })}
                  aria-current={lifecycle === v ? "page" : undefined}
                  className={cn(
                    "flex h-10 items-center justify-center rounded-md px-3 font-medium text-muted-foreground transition-colors hover:text-foreground @xl:h-auto",
                    lifecycle === v && "bg-background text-foreground shadow-sm dark:bg-input/40",
                  )}
                >
                  {label}
                </Link>
              ))}
            </nav>
          </div>
        </div>

        {rows.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">{q ? <SearchIcon /> : <UsersIcon />}</EmptyMedia>
              {q ? (
                <>
                  <EmptyTitle>
                    No {noun}s match “{q}”
                  </EmptyTitle>
                  <EmptyDescription>Search looks at names and email addresses. Check the spelling or try part of the email.</EmptyDescription>
                </>
              ) : total > 0 ? (
                <>
                  <EmptyTitle>Nothing on this page</EmptyTitle>
                  <EmptyDescription>
                    There are only {pages} page{pages === 1 ? "" : "s"} of {noun}s.
                  </EmptyDescription>
                </>
              ) : lifecycle ? (
                <>
                  <EmptyTitle>No {noun}s yet</EmptyTitle>
                  <EmptyDescription>
                    {lifecycle === "customer"
                      ? "Contacts become customers when a payment arrives from Stripe or another revenue source."
                      : "Leads appear when someone submits a form on your site or a form tool calls your lead webhook."}
                  </EmptyDescription>
                </>
              ) : (
                <>
                  <EmptyTitle>No contacts yet</EmptyTitle>
                  <EmptyDescription>
                    Contacts appear when someone submits a form on your site (pixel <code>adledger.lead()</code>), a form tool calls your lead webhook, or a Stripe
                    payment arrives.
                  </EmptyDescription>
                </>
              )}
            </EmptyHeader>
            {q ? (
              <Button variant="outline" className="h-10 sm:h-8" render={<Link href={link({ q: undefined, page: undefined })} />}>
                Clear search
              </Button>
            ) : total > 0 ? (
              <Button variant="outline" className="h-10 sm:h-8" render={<Link href={link({ page: undefined })} />}>
                Go to the first page
              </Button>
            ) : (
              <Button variant="outline" className="h-10 sm:h-8" render={<Link href="/settings/workspace/tracking" />}>
                Set up tracking
              </Button>
            )}
          </Empty>
        ) : (
          <section className="@container space-y-3" aria-label={`${noun}s`}>
            <p className="text-sm text-muted-foreground">
              <span className="tabular font-medium text-foreground">{total.toLocaleString()}</span> {noun}
              {total === 1 ? "" : "s"}
              {q ? (
                <>
                  {" "}
                  matching “<span className="text-foreground">{q}</span>”
                </>
              ) : null}
            </p>

            {/* Narrow containers (phones, tablets with the sidebar open): a tappable list. */}
            <ul className="divide-y overflow-hidden rounded-xl border bg-card @2xl:hidden">
              {rows.map((c) => {
                const ft = firstTouch(c);
                return (
                  <li key={c.id}>
                    <Link href={`/contacts/${c.id}`} className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/50 active:bg-muted/60">
                      <Avatar c={c} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="truncate font-medium">{c.name || c.email || "Anonymous"}</span>
                          {c.revenueMinor ? <span className="tabular shrink-0 text-sm font-medium">{revenue(c)}</span> : null}
                        </div>
                        {c.name && c.email ? <div className="truncate text-xs text-muted-foreground">{c.email}</div> : null}
                        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                          <LifecycleBadge lifecycle={c.lifecycle} />
                          <span className="min-w-0 truncate">{ft.primary ?? "No tracked touchpoint"}</span>
                        </div>
                      </div>
                      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/60" aria-hidden />
                    </Link>
                  </li>
                );
              })}
            </ul>

            {/* Wide containers: a table whose columns appear as space allows. The whole row is clickable. */}
            <div className="hidden overflow-hidden rounded-xl border bg-card @2xl:block">
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="w-auto pl-4">Contact</TableHead>
                    <TableHead className="w-28">Status</TableHead>
                    <TableHead className="hidden w-[32%] @4xl:table-cell">First touch</TableHead>
                    <TableHead className="hidden w-36 @6xl:table-cell">Became a lead</TableHead>
                    <TableHead className="w-28 text-right">Touchpoints</TableHead>
                    <TableHead className="w-32 pr-4 text-right">Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((c) => {
                    const ft = firstTouch(c);
                    return (
                      <TableRow key={c.id} className="relative">
                        <TableCell className="py-2.5 pl-4">
                          <Link
                            href={`/contacts/${c.id}`}
                            className="flex items-center gap-3 rounded-md outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring/50 focus-visible:after:ring-inset"
                          >
                            <Avatar c={c} />
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{c.name || c.email || "Anonymous"}</span>
                              {c.name && c.email ? <span className="block truncate text-xs text-muted-foreground">{c.email}</span> : null}
                            </span>
                          </Link>
                        </TableCell>
                        <TableCell>
                          <LifecycleBadge lifecycle={c.lifecycle} />
                        </TableCell>
                        <TableCell className="hidden @4xl:table-cell">
                          <div className="truncate text-sm" title={ft.primary ?? undefined}>
                            {ft.primary ?? <span className="text-muted-foreground">—</span>}
                          </div>
                          {ft.secondary ? <div className="truncate text-xs text-muted-foreground">{ft.secondary}</div> : null}
                        </TableCell>
                        <TableCell className="hidden text-sm text-muted-foreground @6xl:table-cell">
                          {c.firstLeadAt ? dateFmt.format(new Date(c.firstLeadAt)) : "—"}
                        </TableCell>
                        <TableCell className="tabular text-right">{c.touchpoints}</TableCell>
                        <TableCell className={cn("tabular pr-4 text-right font-medium", !c.revenueMinor && "font-normal text-muted-foreground")}>{revenue(c)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </section>
        )}

        {pages > 1 && rows.length > 0 ? (
          <nav aria-label="Pagination" className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
            <span className="tabular">
              <span className="hidden sm:inline">Showing </span>
              {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
              <span className="hidden sm:inline">
                {" "}
                · page {page} of {pages}
              </span>
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="h-10 min-w-10 sm:h-8"
                disabled={page <= 1}
                aria-label="Previous page"
                render={page > 1 ? <Link href={link({ page: String(page - 1) })} /> : undefined}
              >
                <ChevronLeftIcon />
                <span className="hidden sm:inline">Previous</span>
              </Button>
              <Button
                variant="outline"
                className="h-10 min-w-10 sm:h-8"
                disabled={page >= pages}
                aria-label="Next page"
                render={page < pages ? <Link href={link({ page: String(page + 1) })} /> : undefined}
              >
                <span className="hidden sm:inline">Next</span>
                <ChevronRightIcon />
              </Button>
            </div>
          </nav>
        ) : null}
      </PageBody>
    </>
  );
}

function Avatar({ c }: { c: ContactRow }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
        c.lifecycle === "customer" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
      )}
    >
      {(c.name || c.email || "?").slice(0, 1).toUpperCase()}
    </span>
  );
}

function LifecycleBadge({ lifecycle }: { lifecycle: string }) {
  return (
    <Badge variant={lifecycle === "customer" ? "default" : "secondary"} className="capitalize">
      {lifecycle}
    </Badge>
  );
}
