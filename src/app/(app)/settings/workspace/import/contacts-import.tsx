"use client";

import { ArrowRightIcon, CheckIcon, FileUpIcon, Loader2Icon, UsersIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { importContactsCsvAction, previewContactsCsvAction } from "@/app/actions/hygiene";
import { NativeSelect } from "@/components/native-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CONTACT_FIELD_KEYS, CONTACT_FIELDS, type ColumnMapping, type ContactField, type ImportPreview, type ImportResult } from "@/lib/contacts-import-shared";
import { longDate, num } from "@/lib/format";
import { cn } from "@/lib/utils";

// Contacts CSV import in three steps on one card: choose a file → match columns → review the
// counts and import. The file stays in the browser between steps and is re-sent with each
// mapping change, so nothing is stored on the server until "Import".

type Loaded = { file: File; headers: string[]; examples: string[][]; mapping: ColumnMapping; preview: ImportPreview };

const EXAMPLE = "email,first_name,last_name,phone,date_added\njane@example.com,Jane,Doe,+1 415 555 0100,2026-03-14\n,Sam,Lee,+44 7700 900123,2026-04-02\n";

function Step({ n, label, state }: { n: number; label: string; state: "done" | "current" | "todo" }) {
  return (
    <li className={cn("flex items-center gap-2", state === "todo" ? "text-muted-foreground" : "text-foreground")} aria-current={state === "current" ? "step" : undefined}>
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full text-micro tabular-nums",
          state === "done" ? "bg-ink text-ink-foreground" : state === "current" ? "bg-fill-active font-semibold text-foreground" : "bg-fill text-muted-foreground",
        )}
      >
        {state === "done" ? <CheckIcon aria-hidden className="size-3" strokeWidth={2.5} /> : n}
      </span>
      <span className={cn("whitespace-nowrap", state === "current" && "font-medium")}>{label}</span>
    </li>
  );
}

function Stat({ label, value, tone, note }: { label: string; value: number; tone?: "positive" | "negative"; note: string }) {
  return (
    <div className="grid min-w-0 content-start gap-0.5 rounded-lg bg-bg-subtle px-3 py-2.5 shadow-(--elev-card)">
      <dt className="text-caption font-medium text-muted-foreground">{label}</dt>
      <dd className={cn("text-kpi font-semibold tracking-tight tabular-nums", tone === "negative" && value > 0 && "text-negative")}>{num(value)}</dd>
      <dd className="truncate text-caption text-muted-foreground">{note}</dd>
    </div>
  );
}

export function ContactsImport({ canMerge }: { canMerge: boolean }) {
  const uid = useId();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const [recordLeads, setRecordLeads] = useState(false);
  const [previewing, startPreview] = useTransition();
  const [importing, startImport] = useTransition();
  const [pendingColumn, setPendingColumn] = useState<number | null>(null);

  const preview = (file: File, mapping?: ColumnMapping) =>
    startPreview(async () => {
      const f = new FormData();
      f.set("file", file);
      if (mapping) f.set("mapping", JSON.stringify(mapping));
      const r = await previewContactsCsvAction(f);
      setPendingColumn(null);
      if (!r.ok || !r.data) {
        toast.error(r.message ?? "We couldn’t read that file.");
        if (input.current) input.current.value = "";
        return;
      }
      setDone(null);
      setLoaded({ file, ...(r.data as Omit<Loaded, "file">) });
    });

  const fieldOf = (col: number): ContactField | "" => (CONTACT_FIELD_KEYS.find((f) => loaded?.mapping[f] === col) ?? "") as ContactField | "";

  const remap = (col: number, field: ContactField | "") => {
    if (!loaded) return;
    const next: ColumnMapping = {};
    for (const f of CONTACT_FIELD_KEYS) if (loaded.mapping[f] !== undefined && loaded.mapping[f] !== col && f !== field) next[f] = loaded.mapping[f];
    if (field) next[field] = col;
    setPendingColumn(col);
    setLoaded({ ...loaded, mapping: next });
    preview(loaded.file, next);
  };

  const reset = () => {
    setLoaded(null);
    setDone(null);
    if (input.current) input.current.value = "";
  };

  const runImport = (form: FormData) =>
    startImport(async () => {
      if (!loaded) return;
      form.set("file", loaded.file);
      form.set("mapping", JSON.stringify(loaded.mapping));
      const r = await importContactsCsvAction(form);
      if (!r.ok) return void toast.error(r.message ?? "The import failed. Try again.");
      toast.success(r.message ?? "Contacts imported.");
      setDone(r.data as ImportResult);
      setLoaded(null);
      if (input.current) input.current.value = "";
      router.refresh();
    });

  const downloadExample = () => {
    const url = URL.createObjectURL(new Blob([EXAMPLE], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "contacts-example.csv" });
    a.click();
    URL.revokeObjectURL(url);
  };

  const p = loaded?.preview;
  const importable = p ? p.new + p.update : 0;
  const step = done ? 4 : loaded ? 2 : 1;

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="grid gap-0.5">
          <CardTitle className="flex items-center gap-2">
            <UsersIcon aria-hidden className="size-4 text-muted-foreground" /> Contacts CSV
          </CardTitle>
          <CardDescription className="max-w-2xl">
            Bring in a customer list or leads from another CRM, so their payments and ad clicks match up. People are matched by email (or phone), and existing contacts are only filled in, never overwritten.
          </CardDescription>
        </div>
        <ol className="flex flex-wrap items-center gap-x-4 gap-y-2 text-caption" aria-label="Import steps">
          <Step n={1} label="Choose a file" state={step > 1 ? "done" : "current"} />
          <li aria-hidden className="h-px w-4 bg-border max-sm:hidden" />
          <Step n={2} label="Match columns" state={step > 2 ? "done" : step === 2 ? "current" : "todo"} />
          <li aria-hidden className="h-px w-4 bg-border max-sm:hidden" />
          <Step n={3} label="Review and import" state={step > 2 ? "done" : step === 2 ? "current" : "todo"} />
        </ol>
      </CardHeader>

      <CardContent className="grid gap-5">
        {done ? (
          <div role="status" className="grid gap-3 rounded-lg bg-positive-soft px-4 py-3">
            <p className="flex items-center gap-2 text-body font-medium">
              <CheckIcon aria-hidden className="size-4 text-positive" strokeWidth={2.25} />
              {num(done.created)} new {done.created === 1 ? "contact" : "contacts"}, {num(done.updated)} updated
            </p>
            <p className="text-ui text-pretty text-muted-foreground">
              {done.invalid ? `${num(done.invalid)} ${done.invalid === 1 ? "row was" : "rows were"} skipped. ` : ""}
              {done.leads ? `${num(done.leads)} ${done.leads === 1 ? "lead was" : "leads were"} recorded, and attribution is being recalculated. ` : ""}
              People who were already split across an email and a phone number can be merged on the duplicates page.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={reset}>
                Import another file
              </Button>
              {canMerge ? (
                <Button size="sm" variant="ghost" render={<Link href="/settings/workspace/duplicates" />}>
                  Review duplicates <ArrowRightIcon aria-hidden />
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {!loaded ? (
          <div className="grid gap-3">
            <label
              htmlFor={`${uid}-file`}
              className={cn(
                "group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong px-4 py-8 text-center transition-[background-color,border-color] duration-150 hover:border-fg-faint hover:bg-bg-subtle has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring",
                previewing && "pointer-events-none opacity-60",
              )}
            >
              {previewing ? <Loader2Icon aria-hidden className="size-5 animate-spin text-muted-foreground" /> : <FileUpIcon aria-hidden className="size-5 text-muted-foreground" />}
              <span className="text-ui font-medium">{previewing ? "Reading the file…" : "Choose a CSV file"}</span>
              <span className="text-caption text-muted-foreground">Up to 10&nbsp;MB and 100,000 rows. Any column names; you’ll match them next.</span>
              <input
                ref={input}
                id={`${uid}-file`}
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                disabled={previewing}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) preview(file);
                }}
              />
            </label>
            <p className="text-caption text-muted-foreground">
              Exported from Mailchimp, HubSpot, Shopify or a spreadsheet?{" "}
              <button type="button" onClick={downloadExample} className="font-medium text-foreground underline decoration-border-strong underline-offset-3 hover:decoration-foreground">
                Download an example file
              </button>
              .
            </p>
          </div>
        ) : (
          <>
            <section aria-labelledby={`${uid}-map`} className="grid gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <h3 id={`${uid}-map`} className="text-ui font-medium">
                  Match columns <span className="font-normal text-muted-foreground">· {loaded.file.name}</span>
                </h3>
                <Button size="sm" variant="ghost" onClick={reset} disabled={importing}>
                  <XIcon aria-hidden /> Choose another file
                </Button>
              </div>
              <ul className="divide-y rounded-lg shadow-(--elev-card)">
                {loaded.headers.map((h, col) => {
                  const field = fieldOf(col);
                  return (
                    <li key={col} className="grid items-center gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_12rem] sm:gap-4">
                      <label htmlFor={`${uid}-col-${col}`} className="min-w-0 truncate text-ui font-medium" title={h}>
                        {h}
                      </label>
                      <span className="min-w-0 truncate text-caption text-muted-foreground" title={loaded.examples[col]?.join(", ")}>
                        {loaded.examples[col]?.length ? loaded.examples[col].join(" · ") : "Empty column"}
                      </span>
                      <div className="flex items-center gap-2">
                        <NativeSelect id={`${uid}-col-${col}`} value={field} onChange={(e) => remap(col, e.target.value as ContactField | "")} disabled={importing} className="flex-1">
                          <option value="">Don’t import</option>
                          {CONTACT_FIELD_KEYS.map((f) => (
                            <option key={f} value={f}>
                              {CONTACT_FIELDS[f].label}
                            </option>
                          ))}
                        </NativeSelect>
                        <Loader2Icon aria-hidden className={cn("size-4 shrink-0 animate-spin text-muted-foreground", pendingColumn === col && previewing ? "opacity-100" : "opacity-0")} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section aria-labelledby={`${uid}-review`} aria-busy={previewing} className={cn("grid gap-4 transition-opacity duration-150", previewing && "opacity-60")}>
              <h3 id={`${uid}-review`} className="text-ui font-medium">
                Review
              </h3>
              {p?.warning ? (
                <p role="alert" className="rounded-lg bg-warning-soft px-3 py-2 text-ui text-warning-foreground">
                  {p.warning}
                </p>
              ) : null}
              {p ? (
                <dl className="grid grid-cols-2 gap-3 @2xl/settings:grid-cols-4">
                  <Stat label="New" value={p.new} note="become contacts" />
                  <Stat label="Update" value={p.update} note="already here, filled in" />
                  <Stat label="Invalid" value={p.invalid} tone="negative" note={p.invalid ? "skipped, see below" : "nothing to fix"} />
                  <Stat label="Repeated" value={p.repeats} note="same person, merged" />
                </dl>
              ) : null}

              {p?.problems.length ? (
                <div className="grid gap-1.5">
                  <p className="text-caption font-medium text-muted-foreground">Rows that will be skipped{p.invalid > p.problems.length ? ` (first ${p.problems.length} of ${num(p.invalid)})` : ""}</p>
                  <ul className="grid gap-1 text-ui">
                    {p.problems.map((x) => (
                      <li key={x.line} className="flex gap-2">
                        <span className="w-14 shrink-0 text-muted-foreground tabular-nums">Row {num(x.line)}</span>
                        <span className="min-w-0 text-pretty">{x.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {p?.sample.length ? (
                <div className="grid gap-1.5">
                  <p className="text-caption font-medium text-muted-foreground">First rows as they will be imported</p>
                  <div className="overflow-x-auto rounded-lg shadow-(--elev-card)">
                    <table className="w-full text-ui tabular-nums">
                      <thead className="bg-bg-subtle text-left text-caption text-muted-foreground">
                        <tr>
                          <th scope="col" className="px-3 py-2 font-medium">Email</th>
                          <th scope="col" className="px-3 py-2 font-medium">Name</th>
                          <th scope="col" className="px-3 py-2 font-medium max-sm:hidden">Phone</th>
                          <th scope="col" className="px-3 py-2 font-medium max-sm:hidden">Date added</th>
                          <th scope="col" className="px-3 py-2 text-right font-medium">Result</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {p.sample.map((s) => (
                          <tr key={s.line}>
                            <td className="max-w-56 truncate px-3 py-2">{s.email ?? <span className="text-muted-foreground">—</span>}</td>
                            <td className="max-w-40 truncate px-3 py-2">{s.name ?? <span className="text-muted-foreground">—</span>}</td>
                            <td className="px-3 py-2 text-muted-foreground max-sm:hidden">{s.hasPhone ? "Yes" : "—"}</td>
                            <td className="px-3 py-2 whitespace-nowrap text-muted-foreground max-sm:hidden">{s.firstSeen ? longDate(s.firstSeen) : "Today"}</td>
                            <td className="px-3 py-2 text-right">
                              <Badge variant={s.status === "new" ? "brand" : "secondary"}>{s.status === "new" ? "New" : "Update"}</Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              <form action={runImport} className="grid gap-4 border-t pt-4">
                <div className="grid gap-3">
                  <div className="flex items-start gap-3">
                    {recordLeads ? <input type="hidden" name="recordLeads" value="on" /> : null}
                    <Switch id={`${uid}-leads`} checked={recordLeads} onCheckedChange={setRecordLeads} className="mt-0.5" />
                    <div className="grid gap-0.5">
                      <Label htmlFor={`${uid}-leads`}>Count new contacts as leads</Label>
                      <p className="text-caption text-pretty text-muted-foreground">Records a lead on each new person’s date added, so they show in lead counts and cost per lead. Leave off for a plain customer list.</p>
                    </div>
                  </div>
                  {recordLeads ? (
                    <div className="grid gap-1.5 sm:max-w-xs sm:pl-11">
                      <Label htmlFor={`${uid}-form`}>Lead source name</Label>
                      <Input id={`${uid}-form`} name="formName" autoComplete="off" placeholder="Old CRM…" maxLength={200} />
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Button type="submit" disabled={importing || previewing || importable === 0 || Boolean(p?.warning)} className="max-sm:flex-1">
                    {importing ? <Loader2Icon aria-hidden className="animate-spin" /> : null}
                    {importing ? "Importing…" : importable ? `Import ${num(importable)} ${importable === 1 ? "contact" : "contacts"}` : "Nothing to import"}
                  </Button>
                  <p className="text-caption text-muted-foreground">Safe to run again: a second import only fills in blanks.</p>
                </div>
              </form>
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}
