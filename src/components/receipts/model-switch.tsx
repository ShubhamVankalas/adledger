import Link from "next/link";
import type { AttributionModel } from "@/lib/db/schema";
import type { CostBasis } from "@/lib/reports-profit";
import { cn } from "@/lib/utils";

/** A segmented control whose options are plain links (the state lives in the URL). */
export function LinkSegments<T extends string>({
  label,
  value,
  options,
  className,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; href: string; title?: string }[];
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cn("inline-flex h-7 shrink-0 items-center rounded-[7px] bg-fill p-0.5", className)}>
      {options.map((o) => (
        <Link
          key={o.value}
          href={o.href}
          scroll={false}
          replace
          title={o.title}
          aria-current={o.value === value ? "true" : undefined}
          className={cn(
            "inline-flex h-6 items-center rounded-[5px] px-2.5 text-ui whitespace-nowrap text-muted-foreground transition-[color,background-color,box-shadow] duration-100 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
            o.value === value && "bg-surface font-medium text-foreground shadow-sm",
          )}
        >
          {o.label}
        </Link>
      ))}
    </nav>
  );
}

const MODELS: [AttributionModel, string, string][] = [
  ["last_touch", "Last", "All credit to the last ad before they bought"],
  ["first_touch", "First", "All credit to the ad that first brought them in"],
  ["linear", "Linear", "Credit split evenly across every tracked touch"],
];

/** Last / First / Linear, for pages that have no date range (a single receipt). */
export function ModelSwitch({ model, hrefFor, className }: { model: AttributionModel; hrefFor: (m: AttributionModel) => string; className?: string }) {
  return (
    <LinkSegments
      label="Attribution model"
      value={model}
      className={className}
      options={MODELS.map(([value, label, title]) => ({ value, label, title, href: hrefFor(value) }))}
    />
  );
}

/** Share of spend (fully loaded) vs clicks only (marginal): how a customer's cost is priced. */
export function CostBasisSwitch({ basis, hrefFor, className }: { basis: CostBasis; hrefFor: (b: CostBasis) => string; className?: string }) {
  return (
    <LinkSegments
      label="How customer cost is counted"
      value={basis}
      className={className}
      options={[
        { value: "share", label: "Share of spend", title: "Each ad's monthly spend shared by the customers it brought", href: hrefFor("share") },
        { value: "clicks", label: "Clicks only", title: "Only what the customer's own clicks cost", href: hrefFor("clicks") },
      ]}
    />
  );
}
