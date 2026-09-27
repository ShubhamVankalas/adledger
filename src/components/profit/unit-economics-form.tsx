"use client";

import { useState } from "react";
import { clearUnitEconomicsAction, saveUnitEconomicsAction } from "@/app/actions/profit";
import { ActionButton, useFormAction } from "@/components/action-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Values = { cogsPct: string; feePct: string; feeFixed: string; shipping: string };

const pctNum = (s: string) => {
  const v = Number(s.replace(",", ".").replace("%", ""));
  return Number.isFinite(v) && v >= 0 && v <= 100 ? v : null;
};
const amt = (s: string) => {
  const v = s === "" ? 0 : Number(s.replace(",", "."));
  return Number.isFinite(v) && v >= 0 ? v : null;
};

function Field({
  id,
  label,
  help,
  suffix,
  prefix,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  id: keyof Values;
  label: string;
  help: string;
  suffix?: string;
  prefix?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  disabled: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`ue-${id}`} className="text-ui font-medium">
        {label}
      </Label>
      <div className="relative max-w-44">
        {prefix ? <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-ui text-muted-foreground">{prefix}</span> : null}
        <Input
          id={`ue-${id}`}
          name={id}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={`ue-${id}-help`}
          className={`num ${prefix ? "pl-7" : ""} ${suffix ? "pr-8" : ""}`}
        />
        {suffix ? <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-ui text-muted-foreground">{suffix}</span> : null}
      </div>
      <p id={`ue-${id}-help`} className="text-caption text-pretty text-muted-foreground">
        {help}
      </p>
    </div>
  );
}

/**
 * Cost of goods %, payment fee (% + fixed) and shipping per order, with a worked example of one
 * order so the owner can sanity-check the numbers before saving.
 */
export function UnitEconomicsForm({ initial, configured, currency, canEdit }: { initial: Values; configured: boolean; currency: string; canEdit: boolean }) {
  const [v, setV] = useState<Values>(initial);
  const save = useFormAction(saveUnitEconomicsAction);
  const set = (k: keyof Values) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  const symbol = new Intl.NumberFormat("en-US", { style: "currency", currency }).formatToParts(0).find((p) => p.type === "currency")?.value ?? currency;
  const fmt = (x: number) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(x);

  // Worked example: one 100-unit order. Illustration only; reports compute everything in SQL.
  const cogs = pctNum(v.cogsPct || "0");
  const fee = pctNum(v.feePct || "0");
  const fixed = amt(v.feeFixed);
  const ship = amt(v.shipping);
  const valid = cogs !== null && fee !== null && fixed !== null && ship !== null;
  const order = 100;
  const keep = valid ? order - (order * cogs) / 100 - (order * fee) / 100 - fixed - ship : null;
  const margin = cogs !== null ? 1 - cogs / 100 : null;

  return (
    <form action={save.submit} className="grid gap-6 @3xl/settings:grid-cols-[minmax(0,1fr)_18rem]">
      <fieldset disabled={!canEdit || save.pending} className="grid gap-5 @xl/settings:grid-cols-2">
        <legend className="sr-only">Unit economics</legend>
        <Field
          id="cogsPct"
          label="Cost of goods"
          suffix="%"
          placeholder="35…"
          value={v.cogsPct}
          onChange={set("cogsPct")}
          disabled={!canEdit}
          help="What the product costs you, as a share of the price. For services, the cost of delivering them."
        />
        <Field
          id="feePct"
          label="Payment fee"
          suffix="%"
          placeholder="2.9…"
          value={v.feePct}
          onChange={set("feePct")}
          disabled={!canEdit}
          help="Your processor's percentage fee. Stripe's standard rate is 2.9%."
        />
        <Field
          id="feeFixed"
          label="Fixed fee per payment"
          prefix={symbol}
          placeholder="0.30…"
          value={v.feeFixed}
          onChange={set("feeFixed")}
          disabled={!canEdit}
          help="The flat part of the fee, charged on every payment."
        />
        <Field
          id="shipping"
          label="Shipping per order"
          prefix={symbol}
          placeholder="0…"
          value={v.shipping}
          onChange={set("shipping")}
          disabled={!canEdit}
          help="Shipping and fulfilment you pay per order. Leave at 0 for digital products."
        />
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2 @xl/settings:col-span-2">
            <Button type="submit" disabled={save.pending}>
              {save.pending ? "Saving…" : "Save unit economics"}
            </Button>
            {configured ? (
              <ActionButton type="button" variant="ghost" action={clearUnitEconomicsAction} confirm="Clear unit economics? Profit reports go back to treating all revenue as contribution.">
                Clear
              </ActionButton>
            ) : null}
          </div>
        ) : null}
      </fieldset>

      <aside aria-live="polite" className="h-fit rounded-lg bg-bg-subtle px-4 py-3.5 ring-1 ring-border">
        <h3 className="text-ui font-medium">On a {fmt(order)} order</h3>
        {valid && keep !== null ? (
          <dl className="mt-2 space-y-1 text-ui">
            {[
              ["Cost of goods", -(order * cogs) / 100],
              ["Payment fee", -((order * fee) / 100 + fixed)],
              ["Shipping", -ship],
            ].map(([label, value]) => (
              <div key={label as string} className="flex justify-between gap-3 text-muted-foreground">
                <dt>{label}</dt>
                <dd className="num">{value === 0 ? fmt(0) : `−${fmt(Math.abs(value as number))}`}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-3 border-t pt-1.5 font-medium">
              <dt>You keep before ads</dt>
              <dd className={`num ${keep < 0 ? "text-negative" : ""}`}>{keep < 0 ? `−${fmt(Math.abs(keep))}` : fmt(keep)}</dd>
            </div>
          </dl>
        ) : (
          <p className="mt-2 text-caption text-muted-foreground">Enter percentages between 0 and 100 and amounts of 0 or more.</p>
        )}
        {margin !== null && margin > 0 ? (
          <p className="mt-3 text-caption text-pretty text-muted-foreground">
            Break-even ROAS on cost of goods: <span className="num font-medium text-foreground">{(1 / margin).toFixed(2)}x</span>. Below that, ads lose money
            before fees and shipping.
          </p>
        ) : null}
      </aside>
    </form>
  );
}
