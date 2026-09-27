import { InfoIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageBody, PageHeader } from "@/components/page-header";
import { CostBasisSwitch, ModelSwitch } from "@/components/receipts/model-switch";
import { PaymentReceiptView, receiptDate } from "@/components/receipts/receipt";
import { receiptQuery } from "@/components/receipts/query";
import { ReceiptNav } from "@/components/receipts/receipt-nav";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import type { AttributionModel } from "@/lib/db/schema";
import { money } from "@/lib/format";
import { UUID_RE } from "@/lib/request-auth";
import { adjacentPayments, parseCostBasis, paymentReceipt } from "@/lib/reports-profit";

export const metadata = { title: "Receipt" };

const MODELS: AttributionModel[] = ["first_touch", "last_touch", "linear"];

export default async function ReceiptPage({ params, searchParams }: PageProps<"/receipts/[paymentId]">) {
  const [{ paymentId }, sp, user] = await Promise.all([params, searchParams, requireUser("reports.view")]);
  if (!UUID_RE.test(paymentId)) notFound();
  const ws = user.workspace;
  const model = (MODELS.includes(sp.model as AttributionModel) ? sp.model : "linear") as AttributionModel;
  const basis = parseCostBasis(sp.cost);
  const db = await getDb();
  const [r, adjacent] = await Promise.all([
    // Agency clients see masked emails; everyone else sees the address they already see on Contacts.
    paymentReceipt(db, ws, paymentId, model, { revealEmail: user.can("contacts.pii"), basis }),
    adjacentPayments(db, ws, paymentId),
  ]);
  if (!r) notFound();
  const q = receiptQuery(model, basis);
  const c = r.contact;

  return (
    <>
      <PageHeader
        title={money(r.payment.amountMinor, r.payment.currency)}
        description={`${r.payment.type === "refund" ? "Refund" : "Payment"} on ${receiptDate(r.payment.at, ws.timezone)}`}
        breadcrumbs={[{ href: "/receipts", label: "Receipts" }]}
      >
        <ModelSwitch model={model} hrefFor={(m) => `/receipts/${paymentId}${receiptQuery(m, basis)}`} />
        <ReceiptNav newerHref={adjacent.newer ? `/receipts/${adjacent.newer}${q}` : null} olderHref={adjacent.older ? `/receipts/${adjacent.older}${q}` : null} />
      </PageHeader>
      <PageBody>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,40rem)_minmax(0,1fr)] lg:items-start">
          <PaymentReceiptView
            receipt={r}
            timeZone={ws.timezone}
            contactHref={c ? `/contacts/${c.contact.id}` : null}
            costControl={<CostBasisSwitch basis={basis} hrefFor={(b) => `/receipts/${paymentId}${receiptQuery(model, b)}`} />}
          />
          <aside className="space-y-4 text-ui text-pretty text-muted-foreground lg:sticky lg:top-20 lg:pt-1">
            <h2 className="flex items-center gap-1.5 font-medium text-foreground">
              <InfoIcon aria-hidden className="size-4 text-fg-faint" /> How to read a receipt
            </h2>
            <p>
              <span className="font-medium text-foreground">Earned by</span> splits the payment across the ads and channels in this
              customer&rsquo;s journey, using the model you pick above. The parts always add up to the payment.
            </p>
            <p>
              <span className="font-medium text-foreground">What this customer cost</span> shares each ad&rsquo;s spend for the month
              between the customers it brought in, by the same credit. <span className="font-medium text-foreground">Clicks only</span> counts
              just their own clicks at that day&rsquo;s cost per click. Either way, spend that didn&rsquo;t bring a customer stays in an
              &ldquo;unallocated&rdquo; line, so customer costs plus unallocated equal your ad spend exactly.
            </p>
            <p>
              <span className="font-medium text-foreground">Payback</span> is the day this customer&rsquo;s payments, net of refunds, first
              covered what they cost and stayed above it.
            </p>
            {c ? (
              <p>
                <Link href={`/contacts/${c.contact.id}`} className="font-medium text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-foreground">
                  Open the full journey
                </Link>{" "}
                to see every visit and touch behind these numbers.
              </p>
            ) : null}
          </aside>
        </div>
      </PageBody>
    </>
  );
}
