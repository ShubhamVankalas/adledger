import { ChevronLeftIcon, ChevronRightIcon, ReceiptTextIcon } from "lucide-react";
import Link from "next/link";
import { PageBody, PageHeader } from "@/components/page-header";
import { LedgerEquation } from "@/components/receipts/ledger-equation";
import { CostBasisSwitch } from "@/components/receipts/model-switch";
import { receiptQuery } from "@/components/receipts/query";
import { ReceiptList } from "@/components/receipts/receipt-list";
import { ReportControls } from "@/components/report-controls";
import { ReportEmpty } from "@/components/reports/report-ui";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { dateRange, num } from "@/lib/format";
import { resolvePeriodParams } from "@/lib/period";
import { acquisitionLedger, parseCostBasis, receiptList } from "@/lib/reports-profit";
import { gatePage } from "@/components/access-denied";

export const metadata = { title: "Receipts" };

const PAGE_SIZE = 50;

export default async function ReceiptsPage({ searchParams }: PageProps<"/receipts">) {
  const denied = await gatePage("page.profit");
  if (denied) return denied;
  const { workspace: ws, can } = await requireUser("reports.view");
  const db = await getDb();
  const sp = await searchParams;
  const p = await resolvePeriodParams(db, ws, sp);
  const basis = parseCostBasis(sp.cost);
  const page = Math.max(1, Math.min(10_000, Number.parseInt(String(sp.page ?? "1"), 10) || 1));
  const [ledger, list] = await Promise.all([
    acquisitionLedger(db, ws, p, basis),
    receiptList(db, ws, p, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, basis }),
  ]);
  const pages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));
  const keep = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" && k !== "page" ? [[k, v]] : [])));
  const pageHref = (n: number) => {
    const q = new URLSearchParams(keep);
    if (n > 1) q.set("page", String(n));
    const s = q.toString();
    return s ? `/receipts?${s}` : "/receipts";
  };
  const modelQuery = receiptQuery(p.model, basis);
  const basisHref = (b: string) => {
    const q = new URLSearchParams(keep);
    if (b === "share") q.delete("cost");
    else q.set("cost", b);
    const s = q.toString();
    return s ? `/receipts?${s}` : "/receipts";
  };
  const first = (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(list.total, page * PAGE_SIZE);

  return (
    <>
      <PageHeader title="Receipts" description="Every payment, the ads that earned it and what the customer cost">
        <ReportControls start={p.start} end={p.end} range={p.range} model={p.model} showPlatform={false} showCompare={false} />
      </PageHeader>
      <PageBody>
        {ledger.spendMinor > 0 ? <LedgerEquation ledger={ledger} control={<CostBasisSwitch basis={basis} hrefFor={basisHref} />} /> : null}

        <section aria-labelledby="payments-h" className="overflow-hidden rounded-xl bg-card shadow-(--elev-card)">
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4 pb-3">
            <h2 id="payments-h" className="text-body font-semibold">
              Payments
            </h2>
            <p className="num text-caption text-muted-foreground">
              {list.total > 0 ? `${num(list.total)} in ${dateRange(p.start, p.end, { year: true })}` : dateRange(p.start, p.end, { year: true })}
            </p>
          </div>
          {list.rows.length === 0 ? (
            <ReportEmpty icon={ReceiptTextIcon} title={page > 1 ? "No more payments on this page" : "No payments in this period"} className="border-t">
              {page > 1 ? (
                <Link href={pageHref(1)} className="font-medium text-foreground underline underline-offset-4">
                  Back to the first page
                </Link>
              ) : (
                <>
                  Each payment from Stripe, Razorpay or the API gets a receipt here. Try a longer date range
                  {can("workspace.settings") ? (
                    <>
                      {" "}or{" "}
                      <Link href="/settings/workspace/integrations" className="font-medium text-foreground underline underline-offset-4">
                        connect a payment source
                      </Link>
                    </>
                  ) : null}
                  .
                </>
              )}
            </ReportEmpty>
          ) : (
            <ReceiptList rows={list.rows} currency={ws.reportingCurrency} timeZone={ws.timezone} query={modelQuery} />
          )}
          {pages > 1 ? (
            <nav aria-label="Pages" className="flex items-center justify-between gap-3 border-t px-4 py-2.5">
              <p className="num text-caption text-muted-foreground">
                {num(first)}–{num(last)} of {num(list.total)}
              </p>
              <div className="flex items-center gap-1">
                {page > 1 ? (
                  <Button variant="outline" size="sm" render={<Link href={pageHref(page - 1)} />}>
                    <ChevronLeftIcon aria-hidden /> Newer
                  </Button>
                ) : null}
                {page < pages ? (
                  <Button variant="outline" size="sm" render={<Link href={pageHref(page + 1)} />}>
                    Older <ChevronRightIcon aria-hidden />
                  </Button>
                ) : null}
              </div>
            </nav>
          ) : null}
        </section>
      </PageBody>
    </>
  );
}
