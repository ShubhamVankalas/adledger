"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { NativeSelect } from "@/components/native-select";
import { cn } from "@/lib/utils";

type Option = { value: string; label: string };

/** Filter bar for the audit log. The filters live in the URL, so any view can be shared or bookmarked. */
export function AuditFilters({
  values,
  categories,
  members,
  workspaces,
  periods,
}: {
  values: { category: string; member: string; workspace: string; period: string };
  categories: Option[];
  members: Option[];
  workspaces: Option[];
  periods: Option[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const onChange = (e: React.FormEvent<HTMLFormElement>) => {
    const data = new FormData(e.currentTarget);
    const params = new URLSearchParams();
    for (const [k, v] of data) if (typeof v === "string" && v && !(k === "period" && v === "90d")) params.set(k, v);
    const qs = params.toString();
    start(() => router.push(qs ? `?${qs}` : "?", { scroll: false }));
  };
  const active = Boolean(values.category || values.member || values.workspace || values.period !== "90d");
  return (
    <form method="get" onChange={onChange} onSubmit={(e) => { e.preventDefault(); onChange(e); }} aria-label="Filter the audit log" className={cn("flex flex-wrap items-end gap-2 transition-opacity", pending && "opacity-60")} aria-busy={pending}>
      <Select name="category" label="Activity" value={values.category} options={[{ value: "", label: "All activity" }, ...categories]} />
      <Select name="member" label="Member" value={values.member} options={[{ value: "", label: "Everyone" }, ...members]} />
      {workspaces.length > 1 ? <Select name="workspace" label="Workspace" value={values.workspace} options={[{ value: "", label: "All workspaces" }, ...workspaces]} /> : null}
      <Select name="period" label="Period" value={values.period} options={periods} />
      <noscript>
        <button type="submit" className="h-9 rounded-lg border px-3 text-sm">
          Filter
        </button>
      </noscript>
      {active ? (
        <Link href="?" scroll={false} className="flex h-10 items-center rounded-md px-2 text-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 md:h-9">
          Clear filters
        </Link>
      ) : null}
    </form>
  );
}

function Select({ name, label, value, options }: { name: string; label: string; value: string; options: Option[] }) {
  const id = `audit-${name}`;
  return (
    <div className="grid min-w-0 gap-1">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </label>
      <NativeSelect id={id} name={name} defaultValue={value} key={value} className="w-[min(100%,11.5rem)] min-w-36">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
