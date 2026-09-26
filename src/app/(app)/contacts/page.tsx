import { DownloadIcon, SearchIcon, UsersIcon } from "lucide-react";
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
import { listContacts } from "@/lib/reports";
import { cn } from "@/lib/utils";

export const metadata = { title: "Contacts" };
const PAGE = 50;

export default async function ContactsPage({ searchParams }: PageProps<"/contacts">) {
  const user = await requireUser();
  const ws = user.workspace;
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const lifecycle = sp.lifecycle === "lead" || sp.lifecycle === "customer" ? sp.lifecycle : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const db = await getDb();
  const { rows, total } = await listContacts(db, ws, { search: q, lifecycle, limit: PAGE, offset: (page - 1) * PAGE });
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const link = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(Object.entries({ q, lifecycle, page: String(page), ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/contacts?${next}`;
  };
  const exportHref = `/api/v1/exports/contacts?${new URLSearchParams(Object.entries({ q, lifecycle }).filter(([, v]) => v) as [string, string][])}`;
  const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: ws.timezone });

  return (
    <>
      <PageHeader title="Contacts" description="Every lead and customer, with the journey that brought them in">
        {user.can("reports.export") && total > 0 ? (
          <Button variant="outline" size="sm" render={<a href={exportHref} download />}>
            <DownloadIcon /> Export CSV
          </Button>
        ) : null}
      </PageHeader>
      <PageBody>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <form role="search" className="relative w-full sm:max-w-sm" action="/contacts">
            <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input name="q" type="search" defaultValue={q} placeholder="Search by email or name…" aria-label="Search contacts" className="pl-8" />
            {lifecycle ? <input type="hidden" name="lifecycle" value={lifecycle} /> : null}
          </form>
          <nav aria-label="Filter by status" className="flex items-center gap-1 rounded-lg border bg-muted/40 p-0.5 text-sm">
            {[
              [undefined, "All"],
              ["lead", "Leads"],
              ["customer", "Customers"],
            ].map(([v, label]) => (
              <Link
                key={label}
                href={link({ lifecycle: v, page: undefined })}
                aria-current={lifecycle === v ? "page" : undefined}
                className={cn("rounded-md px-3 py-2 font-medium text-muted-foreground hover:text-foreground md:py-1", lifecycle === v && "bg-background text-foreground shadow-sm")}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>

        {rows.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <UsersIcon />
              </EmptyMedia>
              <EmptyTitle>No contacts {q ? "match your search" : "yet"}</EmptyTitle>
              <EmptyDescription>
                Contacts appear when someone submits a form on your site (pixel <code>adledger.lead()</code>), a form tool calls your lead webhook, or a Stripe payment arrives.
              </EmptyDescription>
            </EmptyHeader>
            <Button variant="outline" size="sm" render={<Link href="/settings/workspace/tracking" />}>
              Set up tracking
            </Button>
          </Empty>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead>Contact</TableHead>
                  <TableHead className="hidden sm:table-cell">Status</TableHead>
                  <TableHead className="hidden md:table-cell">First touch</TableHead>
                  <TableHead className="hidden lg:table-cell">Became a lead</TableHead>
                  <TableHead className="hidden sm:table-cell text-right">Touchpoints</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => (
                  <TableRow key={c.id} className="cursor-pointer">
                    <TableCell className="max-w-[14rem] sm:max-w-none">
                      <Link href={`/contacts/${c.id}`} className="flex min-h-9 items-center gap-3">
                        <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                          {(c.name || c.email || "?").slice(0, 1).toUpperCase()}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{c.name || c.email || "Anonymous"}</span>
                          <span className="block truncate text-xs text-muted-foreground">{c.name ? c.email : ""}</span>
                          {c.lifecycle === "customer" ? (
                            <Badge className="mt-1 sm:hidden" variant="default">
                              customer
                            </Badge>
                          ) : null}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge variant={c.lifecycle === "customer" ? "default" : "secondary"}>{c.lifecycle}</Badge>
                    </TableCell>
                    <TableCell className="hidden max-w-64 md:table-cell">
                      <div className="truncate text-sm">{c.firstCampaign ?? (c.firstChannel ? CHANNEL_LABELS[c.firstChannel] : "—")}</div>
                      {c.firstCampaign && c.firstChannel ? <div className="text-xs text-muted-foreground">{CHANNEL_LABELS[c.firstChannel]}</div> : null}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">{c.firstLeadAt ? dateFmt.format(new Date(c.firstLeadAt)) : "—"}</TableCell>
                    <TableCell className="tabular hidden text-right sm:table-cell">{c.touchpoints}</TableCell>
                    <TableCell className="tabular text-right font-medium">{c.revenueMinor ? money(c.revenueMinor, ws.reportingCurrency) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {pages > 1 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            <span className="tabular">
              {total.toLocaleString()} contacts · page {page} of {pages}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} render={page > 1 ? <Link href={link({ page: String(page - 1) })} /> : undefined}>
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={page >= pages} render={page < pages ? <Link href={link({ page: String(page + 1) })} /> : undefined}>
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </PageBody>
    </>
  );
}
