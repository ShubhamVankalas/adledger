"use client";

import { CheckIcon, LayoutDashboardIcon, Loader2Icon, RotateCcwIcon, TrendingUpIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { setOrganizationThemeAction } from "@/app/actions/theme";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DEFAULT_THEME, GRADIENT_THEMES, SOLID_THEMES, findTheme, isDefaultTheme, themeCss, type OrgTheme, type ThemeOption } from "@/lib/themes";
import { cn } from "@/lib/utils";

const key = (t: OrgTheme) => `${t.kind}:${t.id}`;
const same = (a: OrgTheme, b: OrgTheme) => key(a) === key(b);

/** Swatch colours for the current mode, as CSS variables the classes below read. */
const swatchVars = (o: ThemeOption) =>
  ({ "--sw": o.light.brand, "--sw-2": o.light.brand2, "--sw-d": o.dark.brand, "--sw-d2": o.dark.brand2 }) as React.CSSProperties;

export function ThemePicker({ saved, organizationName }: { saved: OrgTheme; organizationName: string }) {
  const router = useRouter();
  const [choice, setChoice] = useState<OrgTheme>(saved);
  const [saving, start] = useTransition();
  const dirty = !same(choice, saved);
  const current = findTheme(choice) ?? findTheme(DEFAULT_THEME)!;

  const save = (next: OrgTheme) =>
    start(async () => {
      const r = await setOrganizationThemeAction(next);
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      toast.success(r.message);
      router.refresh();
    });

  const reset = () => {
    setChoice(DEFAULT_THEME);
    if (!isDefaultTheme(saved)) save(DEFAULT_THEME);
  };

  return (
    <div className="space-y-5 md:space-y-6">
      {/* Live preview: the whole app takes the chosen colours until it is saved or discarded. */}
      {dirty ? <style>{themeCss(choice, { includeDefault: true })}</style> : null}

      <div className="grid gap-5 md:gap-6 @4xl/settings:grid-cols-[minmax(0,1fr)_20rem] @4xl/settings:items-start">
        <div className="order-2 min-w-0 space-y-5 md:space-y-6 @4xl/settings:order-1">
          <Card>
            <CardHeader>
              <CardTitle>Solid colours</CardTitle>
              <CardDescription>One accent for focus rings, links, highlights and the revenue line.</CardDescription>
            </CardHeader>
            <CardContent>
              <fieldset>
                <legend className="sr-only">Solid colours</legend>
                <div className="grid grid-cols-2 gap-2 @md/settings:grid-cols-3 @2xl/settings:grid-cols-4 @5xl/settings:grid-cols-5">
                  {SOLID_THEMES.map((o) => (
                    <Swatch key={o.id} option={o} checked={same(choice, o)} onSelect={() => setChoice({ kind: "solid", id: o.id })} isDefault={isDefaultTheme(o)} />
                  ))}
                </div>
              </fieldset>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Gradients</CardTitle>
              <CardDescription>Two colours blended on accent surfaces: the active menu item, progress lines and highlighted tiles.</CardDescription>
            </CardHeader>
            <CardContent>
              <fieldset>
                <legend className="sr-only">Gradients</legend>
                <div className="grid grid-cols-2 gap-2 @2xl/settings:grid-cols-3 @5xl/settings:grid-cols-5">
                  {GRADIENT_THEMES.map((o) => (
                    <Swatch key={o.id} option={o} checked={same(choice, o)} onSelect={() => setChoice({ kind: "gradient", id: o.id })} wide />
                  ))}
                </div>
              </fieldset>
            </CardContent>
          </Card>
        </div>

        <div className="order-1 @4xl/settings:sticky @4xl/settings:top-24 @4xl/settings:order-2">
          <Preview name={current.name} organizationName={organizationName} />
          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-caption text-muted-foreground">
              {dirty ? "Previewing, not saved yet" : isDefaultTheme(saved) ? "Using the default theme" : `Saved for everyone in ${organizationName}`}
            </p>
            <Button variant="ghost" size="sm" onClick={reset} disabled={saving || (isDefaultTheme(saved) && isDefaultTheme(choice))}>
              <RotateCcwIcon />
              Reset to default
            </Button>
          </div>
        </div>
      </div>

      <div
        className={cn(
          "sticky bottom-[calc(1rem+env(safe-area-inset-bottom))] z-20 flex items-center justify-between gap-3 rounded-xl bg-ink py-2 pr-2 pl-4 text-ui text-ink-foreground shadow-lg transition-[opacity,translate] duration-200 ease-out max-md:bottom-[calc(5.5rem+env(safe-area-inset-bottom))]",
          dirty ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0",
        )}
        aria-hidden={!dirty}
      >
        <span className="min-w-0 truncate">
          <span className="max-sm:hidden">Apply </span>
          {current.name}
          <span className="max-sm:hidden"> for everyone in {organizationName}?</span>
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button size="sm" variant="ghost" className="text-ink-foreground hover:bg-ink-foreground/12" onClick={() => setChoice(saved)} disabled={saving} tabIndex={dirty ? 0 : -1}>
            Discard
          </Button>
          <Button size="sm" className="bg-ink-foreground text-ink hover:bg-ink-foreground/90" onClick={() => save(choice)} disabled={saving} tabIndex={dirty ? 0 : -1}>
            {saving ? <Loader2Icon className="animate-spin" /> : null}
            {saving ? "Saving…" : "Save theme"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Swatch({ option, checked, onSelect, wide, isDefault }: { option: ThemeOption; checked: boolean; onSelect: () => void; wide?: boolean; isDefault?: boolean }) {
  return (
    <label
      style={swatchVars(option)}
      className={cn(
        "group/sw relative flex min-w-0 cursor-pointer items-center gap-2.5 rounded-lg border bg-surface p-2 text-ui transition-[border-color,box-shadow,background-color] duration-100 select-none hover:border-border-strong",
        "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring",
        wide && "flex-col items-stretch gap-2",
        checked && "border-transparent shadow-[0_0_0_2px_var(--sw)] dark:shadow-[0_0_0_2px_var(--sw-d)] hover:border-transparent",
      )}
    >
      <input type="radio" name="org-theme" className="sr-only" checked={checked} onChange={onSelect} />
      <span
        aria-hidden
        className={cn(
          "flex shrink-0 items-center justify-center text-white dark:text-ink-foreground",
          wide
            ? "h-10 w-full rounded-md bg-[linear-gradient(135deg,var(--sw),var(--sw-2))] dark:bg-[linear-gradient(135deg,var(--sw-d),var(--sw-d2))]"
            : "size-8 rounded-md bg-(--sw) dark:bg-(--sw-d)",
        )}
      >
        {checked ? <CheckIcon className="size-4" strokeWidth={2.5} /> : null}
      </span>
      <span className={cn("flex min-w-0 items-center gap-1.5", wide && "px-0.5")}>
        <span className={cn("truncate", checked && "font-medium")}>{option.name}</span>
        {isDefault ? <span className="shrink-0 text-caption text-muted-foreground">Default</span> : null}
      </span>
    </label>
  );
}

/** A slice of the app in the chosen theme: sidebar item, highlighted KPI, button, badge and revenue line. */
function Preview({ name, organizationName }: { name: string; organizationName: string }) {
  const gid = useId();
  return (
    <Card aria-label={`Preview of the ${name} theme`} className="gap-0 overflow-hidden p-0">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <span className="label-caps">Preview</span>
        <span className="truncate text-caption text-muted-foreground">{name}</span>
      </div>
      <div className="space-y-3 bg-bg-subtle p-4">
        <div className="space-y-0.5 rounded-lg bg-sidebar p-1.5">
          <div className="relative flex h-8 items-center gap-2 rounded-md bg-fill-active px-2 text-ui font-medium text-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-brand-gradient">
            <LayoutDashboardIcon className="size-4 text-brand-foreground" />
            Overview
          </div>
          <div className="flex h-8 items-center gap-2 rounded-md px-2 text-ui text-sidebar-foreground">
            <TrendingUpIcon className="size-4 text-fg-faint" />
            Performance
          </div>
        </div>

        <div className="relative overflow-hidden rounded-lg bg-surface p-3 shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--brand)_35%,transparent)]">
          <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-brand-gradient" />
          <div className="flex items-center justify-between gap-2">
            <span className="label-caps">Revenue</span>
            <Badge variant="brand">Top ad</Badge>
          </div>
          <div className="mt-1 text-kpi num">$48,210</div>
          <svg viewBox="0 0 200 48" className="mt-2 h-12 w-full" aria-hidden preserveAspectRatio="none">
            <defs>
              <linearGradient id={`${gid}-area`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" style={{ stopColor: "var(--chart-revenue)", stopOpacity: 0.25 }} />
                <stop offset="100%" style={{ stopColor: "var(--chart-revenue)", stopOpacity: 0 }} />
              </linearGradient>
            </defs>
            <path d="M0 40 L25 34 L50 36 L75 26 L100 28 L125 18 L150 20 L175 10 L200 6 L200 48 L0 48 Z" fill={`url(#${gid}-area)`} />
            <path d="M0 40 L25 34 L50 36 L75 26 L100 28 L125 18 L150 20 L175 10 L200 6" fill="none" stroke="var(--chart-revenue)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          </svg>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className={buttonVariants({ size: "sm" })}>Save report</span>
          <span className={cn(buttonVariants({ size: "sm", variant: "outline" }), "border-ring ring-3 ring-ring/50")}>Focused</span>
          <span className="text-ui font-medium text-brand-foreground underline decoration-brand-foreground/40 underline-offset-4">View report</span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-fill">
          <div className="h-full w-2/3 rounded-full bg-brand-gradient" />
        </div>
        <p className="text-caption text-muted-foreground">Money stays green and red in {organizationName}, whatever the theme.</p>
      </div>
    </Card>
  );
}
