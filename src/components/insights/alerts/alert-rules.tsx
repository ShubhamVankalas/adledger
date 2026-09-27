"use client";

import { BellPlusIcon, EllipsisIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteAlertRuleAction, setAlertRuleEnabledAction } from "@/app/actions/alerts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AlertRuleDialog } from "./alert-rule-dialog";
import type { CampaignOption, ChannelOption, PlatformOption, RuleDraft, RuleView } from "./types";

/** One-click starting points for a workspace without alerts. Thresholds are filled in by the user. */
const SUGGESTIONS: { title: string; body: string; draft: RuleDraft }[] = [
  { title: "CAC too high", body: "Customers start costing more than you can afford.", draft: { metric: "cac", comparator: "gt", windowDays: 2 } },
  { title: "ROAS below break-even", body: "Ads return less than they cost for three days.", draft: { metric: "roas", comparator: "lt", threshold: "1", windowDays: 3 } },
  { title: "Spend spike", body: "A day’s ad spend runs past your budget.", draft: { metric: "spend", comparator: "gt", windowDays: 1 } },
  { title: "Leads dry up", body: "Fewer leads than usual over two days.", draft: { metric: "leads", comparator: "lt", windowDays: 2 } },
];

export function AlertRules({
  rules,
  channels,
  platforms,
  campaigns,
  currencySymbol,
}: {
  rules: RuleView[];
  channels: ChannelOption[];
  platforms: PlatformOption[];
  campaigns: CampaignOption[];
  currencySymbol: string;
}) {
  const [editing, setEditing] = useState<{ rule: RuleView | null; draft: RuleDraft | null; key: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<RuleView | null>(null);
  const [deleting, startDelete] = useTransition();
  const [, startToggle] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(rules, (state, { id, enabled }: { id: string; enabled: boolean }) =>
    state.map((r) => (r.id === id ? { ...r, enabled } : r)),
  );
  const router = useRouter();
  const channelName = (p: string) => channels.find((c) => c.provider === p)?.name ?? p.replace(/^notify_/, "");

  const open = (rule: RuleView | null, draft: RuleDraft | null = null) => setEditing({ rule, draft, key: Date.now() });

  const toggle = (rule: RuleView, enabled: boolean) =>
    startToggle(async () => {
      setOptimistic({ id: rule.id, enabled });
      const r = await setAlertRuleEnabledAction(rule.id, enabled);
      if (!r.ok) toast.error(r.message ?? "Couldn’t update the alert.");
      router.refresh();
    });

  const remove = (rule: RuleView) =>
    startDelete(async () => {
      const r = await deleteAlertRuleAction(rule.id);
      if (r.ok) toast.success(r.message ?? "Deleted");
      else toast.error(r.message ?? "Couldn’t delete the alert.");
      setConfirmDelete(null);
      router.refresh();
    });

  return (
    <section aria-labelledby="rules-title" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 id="rules-title" className="text-title-sm">
            Your alerts
          </h3>
          <p className="text-ui text-muted-foreground">A rule per number you care about, checked every hour.</p>
        </div>
        {optimistic.length ? (
          <Button onClick={() => open(null)} className="max-sm:h-10">
            <PlusIcon aria-hidden /> New alert
          </Button>
        ) : null}
      </div>

      {optimistic.length ? (
        <ul className="divide-y overflow-hidden rounded-xl bg-card shadow-(--elev-card)">
          {optimistic.map((r) => (
            <li key={r.id} className={cn("grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 px-4 py-3.5 transition-opacity duration-150 md:px-5", !r.enabled && "opacity-60")}>
              <Switch
                checked={r.enabled}
                onCheckedChange={(v) => toggle(r, v)}
                aria-label={r.enabled ? `Pause ${r.name}` : `Turn on ${r.name}`}
                className="mt-0.5"
              />
              <div className="min-w-0 space-y-1">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <button
                    type="button"
                    onClick={() => open(r)}
                    className="min-w-0 truncate rounded-sm text-left text-ui font-medium outline-none hover:underline hover:underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {r.name}
                  </button>
                  <StatusBadge rule={r} />
                </div>
                <p className="text-caption text-pretty text-muted-foreground">
                  {r.summary}
                  <span aria-hidden> · </span>
                  {r.scopeLabel}
                </p>
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground">
                  {r.lastValue !== null ? (
                    <span>
                      Last check <span className="num font-medium text-foreground">{r.lastValue}</span>
                      {r.lastEvaluatedAt ? <span suppressHydrationWarning> {timeAgo(r.lastEvaluatedAt)}</span> : null}
                    </span>
                  ) : (
                    <span>Not checked yet</span>
                  )}
                  <span>{r.channels.length ? `To ${r.channels.map(channelName).join(", ")}` : "Insights only"}</span>
                </p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${r.name}`} className="pointer-coarse:size-10" />}>
                  <EllipsisIcon aria-hidden />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem onClick={() => open(r)}>
                    <PencilIcon aria-hidden /> Edit
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete(r)}>
                    <Trash2Icon aria-hidden /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-xl bg-card p-4 shadow-(--elev-card) md:p-5">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-fill text-muted-foreground">
              <BellPlusIcon aria-hidden className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="text-ui font-medium">No alerts yet</p>
              <p className="text-ui text-pretty text-muted-foreground">Start from a common one, or build your own. You choose the number.</p>
            </div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s.title}
                type="button"
                onClick={() => open(null, s.draft)}
                className="group rounded-lg border bg-surface px-3.5 py-3 text-left transition-[border-color,background-color] duration-100 outline-none hover:border-border-strong hover:bg-fill/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <span className="block text-ui font-medium">{s.title}</span>
                <span className="block text-caption text-pretty text-muted-foreground">{s.body}</span>
              </button>
            ))}
          </div>
          <Button variant="outline" onClick={() => open(null)} className="mt-3 max-sm:h-10">
            <PlusIcon aria-hidden /> Build your own
          </Button>
        </div>
      )}

      {editing ? (
        <AlertRuleDialog
          key={editing.key}
          open
          onOpenChange={(o) => !o && setEditing(null)}
          rule={editing.rule}
          draft={editing.draft}
          currencySymbol={currencySymbol}
          channels={channels}
          platforms={platforms}
          campaigns={campaigns}
        />
      ) : null}

      <Dialog open={confirmDelete !== null} onOpenChange={(o) => !o && !deleting && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this alert?</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">{confirmDelete?.name}</span> stops checking. Alerts it already sent stay in the history.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" className="max-sm:h-10" disabled={deleting} />}>Cancel</DialogClose>
            <Button variant="destructive" className="max-sm:h-10" disabled={deleting} onClick={() => confirmDelete && remove(confirmDelete)}>
              {deleting ? "Deleting…" : "Delete alert"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function StatusBadge({ rule }: { rule: RuleView }) {
  if (!rule.enabled) return <Badge variant="secondary">Paused</Badge>;
  if (rule.state === "breached") return <Badge variant="warning">Triggered</Badge>;
  return <Badge variant="outline">Watching</Badge>;
}
