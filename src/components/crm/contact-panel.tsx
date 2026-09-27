"use client";

import { CheckIcon, CopyIcon, PieChartIcon, StickyNoteIcon, SquareCheckBigIcon } from "lucide-react";
import { startTransition, useEffect, useOptimistic, useRef, useState } from "react";
import {
  addTagAction,
  removeTagAction,
  renameContactAction,
  restoreOwnersAction,
  setLifecycleAction,
  setOwnerAction,
} from "@/app/actions/crm";
import { BrandGlyph } from "@/components/brand-icon";
import { useCopy } from "@/components/copy-field";
import { Keycaps } from "@/components/keycaps";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ActionResult } from "@/lib/actions";
import type { ContactRecord, CrmAbilities, CrmMember, Lifecycle } from "@/lib/crm-query";
import { useHotkeys } from "@/lib/hotkeys";
import { channelLabel, MODEL_LABELS, money, moneyWhole, num, pct, platformLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ContactAvatar } from "./contact-avatar";
import { fullDate, relative } from "./crm-format";
import { NotesSection } from "./notes";
import { LifecyclePicker, memberName, OwnerPicker, TagEditor } from "./properties";
import { runAction } from "./run-action";
import { TaskComposer, TaskItem, useTaskList } from "./tasks";
import { Timeline } from "./timeline";

type Props = {
  record: ContactRecord;
  members: CrmMember[];
  tagSuggestions: string[];
  abilities: CrmAbilities;
  viewerId: string;
  now: string;
  variant: "page" | "peek";
  /** Re-read the record after a change (the page refreshes; the peek re-fetches). */
  onChanged: () => Promise<void> | void;
  commandsRef?: React.RefObject<PanelCommands | null>;
};

export type PanelCommands = { note: () => void; task: () => void };

type Props0 = { name: string | null; lifecycle: Lifecycle; ownerUserId: string | null; tags: string[] };

/**
 * One contact: header with inline-editable properties, highlight tiles, and tabs for the unified
 * timeline, notes and tasks, and attribution credit. The same component renders in the preview
 * sheet on /contacts and as the full record page.
 */
export function ContactPanel({ record, members, tagSuggestions, abilities, viewerId, now, variant, onChanged, commandsRef }: Props) {
  const c = record.contact;
  const tz = record.timezone;
  const peek = variant === "peek";
  const [props, apply] = useOptimistic<Props0, Partial<Props0>>(
    { name: c.name, lifecycle: c.lifecycle, ownerUserId: c.ownerUserId, tags: record.tags },
    (s, patch) => ({ ...s, ...patch }),
  );
  const [tab, setTab] = useState<string>("activity");
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const taskRef = useRef<HTMLInputElement>(null);
  const memberLabel = (id: string | null) => memberName(members.find((m) => m.id === id));

  // Optimistic: the new value shows at once, the server action runs, then the record is re-read.
  const change = (patch: Partial<Props0>, action: () => Promise<ActionResult>, undo?: (res: ActionResult) => Promise<ActionResult>) =>
    startTransition(async () => {
      apply(patch);
      await runAction(action(), {
        undo: undo
          ? async (res) => {
              const r = await undo(res);
              await onChanged();
              return r;
            }
          : undefined,
      });
      await onChanged();
    });

  const setLifecycle = (v: Lifecycle) => {
    const prev = props.lifecycle;
    change({ lifecycle: v }, () => setLifecycleAction(c.id, v), () => setLifecycleAction(c.id, prev));
  };
  const setOwner = (v: string | null) =>
    change({ ownerUserId: v }, () => setOwnerAction([c.id], v), (res) => restoreOwnersAction((res.data?.previous as { id: string; ownerUserId: string | null }[]) ?? []));
  const addTag = (t: string) =>
    change({ tags: [...new Set([...props.tags, t])].sort() }, () => addTagAction([c.id], t), (res) => removeTagAction([c.id], String(res.data?.tag ?? t)));
  const removeTag = (t: string) => change({ tags: props.tags.filter((x) => x !== t) }, () => removeTagAction([c.id], t), () => addTagAction([c.id], t));
  const rename = (name: string) => {
    const prev = props.name;
    change({ name: name || null }, () => renameContactAction(c.id, name), () => renameContactAction(c.id, prev ?? ""));
  };

  const focusNote = () => {
    setTab("notes");
    requestAnimationFrame(() => noteRef.current?.focus());
  };
  const focusTask = () => {
    setTab("notes");
    requestAnimationFrame(() => taskRef.current?.focus());
  };
  const canNotes = abilities.notes && record.notes !== null;
  // The preview sheet is a dialog (global shortcuts are off inside it): it calls N and T through this handle.
  useEffect(() => {
    if (!commandsRef) return;
    commandsRef.current = canNotes && abilities.edit ? { note: focusNote, task: focusTask } : null;
    return () => {
      commandsRef.current = null;
    };
  });
  useHotkeys(
    !peek && canNotes && abilities.edit
      ? [
          { id: "crm.note", keys: "n", label: "New note on this contact", group: "Contacts", run: focusNote },
          { id: "crm.task", keys: "t", label: "New task on this contact", group: "Contacts", run: focusTask },
        ]
      : [],
  );

  const h = record.highlights;
  const cur = record.currency;
  const openTasks = (record.tasks ?? []).filter((t) => !t.doneAt).length;

  return (
    <div
      className={cn("min-w-0", peek ? "space-y-5" : "space-y-5 md:space-y-6")}
      data-contact-panel
    >
      {/* Header */}
      <header className={cn("flex gap-3", peek ? "items-start pr-8" : "items-center gap-4")}>
        <ContactAvatar id={c.id} name={props.name} email={c.email} size={peek ? "lg" : "xl"} />
        <div className="min-w-0 flex-1 space-y-1">
          <NameField name={props.name} fallback={c.email ?? "Anonymous contact"} editable={abilities.edit} onSave={rename} large={!peek} />
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ui text-muted-foreground">
            {c.email ? <EmailLine email={c.email} /> : null}
            <span className="text-caption">
              {h.convertedAt
                ? `Customer since ${fullDate(h.convertedAt, tz)}`
                : h.firstLeadAt
                  ? `Lead since ${fullDate(h.firstLeadAt, tz)}`
                  : `First seen ${fullDate(c.firstSeenAt, tz)}`}
            </span>
          </div>
        </div>
        {!peek && canNotes && abilities.edit ? (
          <div className="hidden shrink-0 items-center gap-1.5 md:flex">
            <Button variant="outline" size="sm" onClick={focusNote}>
              <StickyNoteIcon /> Add note <Keycaps keys="n" className="ml-0.5" />
            </Button>
            <Button variant="outline" size="sm" onClick={focusTask}>
              <SquareCheckBigIcon /> Task <Keycaps keys="t" className="ml-0.5" />
            </Button>
          </div>
        ) : null}
      </header>

      {/* Highlights */}
      <dl className={cn("grid gap-px overflow-hidden rounded-lg bg-border shadow-hairline", peek ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3 xl:grid-cols-6")}>
        <Tile label="Net revenue" value={h.revenueMinor ? moneyWhole(h.revenueMinor, cur) : "—"} sub={h.orders ? `${num(h.orders)} ${h.orders === 1 ? "order" : "orders"}${h.refundsMinor ? ` · ${money(h.refundsMinor, cur)} refunded` : ""}` : "No payments yet"} />
        <Tile
          label="First touch"
          value={
            h.firstTouch ? (
              <span className="flex min-w-0 items-center gap-1.5">
                {h.firstTouch.platform ? (
                  <span aria-hidden className="inline-flex">
                    <BrandGlyph id={h.firstTouch.platform} className="size-4" />
                  </span>
                ) : null}
                <span className="truncate">{h.firstTouch.platform ? platformLabel(h.firstTouch.platform) : channelLabel(h.firstTouch.channel)}</span>
              </span>
            ) : (
              "Untracked"
            )
          }
          sub={h.firstTouch?.campaign ?? (h.firstTouch ? channelLabel(h.firstTouch.channel) : "No ad click or visit recorded")}
        />
        <Tile label="Days to convert" value={h.daysToConvert === null ? "—" : h.daysToConvert === 0 ? "Same day" : `${num(h.daysToConvert)} ${h.daysToConvert === 1 ? "day" : "days"}`} sub={h.daysToConvert === null ? "Not a customer yet" : "First visit to first payment"} />
        <Tile label="Last seen" value={relative(h.lastSeenAt, tz, now)} sub={h.lastSeenAt ? fullDate(h.lastSeenAt, tz) : "No activity yet"} />
        {!peek ? (
          <>
            <Tile label="Touches" value={num(h.touches)} sub={c.devices > 1 ? `Across ${c.devices} devices` : "Ad clicks and visits"} />
            <Tile label="Engagement" value={h.engagement === null ? "—" : <Engagement score={h.engagement} />} sub={engagementWord(h.engagement)} />
          </>
        ) : null}
      </dl>

      <div className={cn(!peek && "grid items-start gap-5 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)] xl:gap-8")}>
        {/* Properties */}
        <section aria-label="Properties" className={cn(!peek && "lg:sticky lg:top-[68px]")}>
          <h2 className={cn("label-caps mb-2", peek && "sr-only")}>Properties</h2>
          <dl className="grid grid-cols-[104px_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 text-ui">
            <Prop label="Status">
              <LifecyclePicker value={props.lifecycle} onChange={setLifecycle} disabled={!abilities.edit} />
            </Prop>
            <Prop label="Owner">
              <OwnerPicker value={props.ownerUserId} members={members} viewerId={viewerId} onChange={setOwner} disabled={!abilities.edit} />
            </Prop>
            <Prop label="Tags" top>
              <TagEditor tags={props.tags} suggestions={tagSuggestions} onAdd={addTag} onRemove={removeTag} disabled={!abilities.edit} />
            </Prop>
            <Prop label="Source">
              {h.firstTouch ? (
                <span className="truncate">{h.firstTouch.platform ? `${platformLabel(h.firstTouch.platform)} · ${channelLabel(h.firstTouch.channel)}` : channelLabel(h.firstTouch.channel)}</span>
              ) : (
                <span className="text-muted-foreground">Untracked</span>
              )}
            </Prop>
            {h.firstTouch?.landingPath ? (
              <Prop label="Landing page">
                <span className="truncate font-mono text-mono" translate="no" title={h.firstTouch.landingPath}>
                  {h.firstTouch.landingPath}
                </span>
              </Prop>
            ) : null}
            <Prop label="Became a lead">{h.firstLeadAt ? fullDate(h.firstLeadAt, tz) : <span className="text-muted-foreground">Not yet</span>}</Prop>
            <Prop label="First payment">{h.convertedAt ? fullDate(h.convertedAt, tz) : <span className="text-muted-foreground">Not yet</span>}</Prop>
            <Prop label="First seen">{fullDate(c.firstSeenAt, tz)}</Prop>
          </dl>
        </section>

        {/* Activity, notes and tasks, attribution */}
        <Tabs value={tab} onValueChange={(v) => setTab(String(v))} className={cn("min-w-0", peek && "mt-5")}>
          <TabsList className="-mx-1 max-w-[calc(100%+0.5rem)] overflow-x-auto px-1">
            <TabsTrigger value="activity">Activity</TabsTrigger>
            {canNotes ? (
              <TabsTrigger value="notes">
                Notes &amp; tasks
                {(record.notes?.length ?? 0) + openTasks > 0 ? <span className="num text-fg-faint">{(record.notes?.length ?? 0) + openTasks}</span> : null}
              </TabsTrigger>
            ) : null}
            <TabsTrigger value="credit">Attribution</TabsTrigger>
          </TabsList>
          <TabsContent value="activity" className="pt-1">
            <Timeline entries={record.timeline} tz={tz} now={now} capped={record.pageViewsCapped} memberName={memberLabel} compact={peek} />
          </TabsContent>
          {canNotes ? (
            <TabsContent value="notes" className="space-y-6 pt-1">
              <TasksBlock record={record} members={members} viewerId={viewerId} abilities={abilities} now={now} onChanged={onChanged} taskRef={taskRef} />
              <section aria-label="Notes" className="space-y-2">
                <h3 className="label-caps">Notes</h3>
                <NotesSection
                  contactId={c.id}
                  notes={record.notes ?? []}
                  members={members}
                  viewerId={viewerId}
                  abilities={abilities}
                  tz={tz}
                  now={now}
                  onChanged={onChanged}
                  composerRef={noteRef}
                />
              </section>
            </TabsContent>
          ) : null}
          <TabsContent value="credit" className="pt-1">
            <Credit record={record} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function TasksBlock({
  record,
  members,
  viewerId,
  abilities,
  now,
  onChanged,
  taskRef,
}: {
  record: ContactRecord;
  members: CrmMember[];
  viewerId: string;
  abilities: CrmAbilities;
  now: string;
  onChanged: () => Promise<void> | void;
  taskRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [tasks, apply] = useTaskList(record.tasks ?? []);
  return (
    <section aria-label="Tasks" className="space-y-2">
      <h3 className="label-caps">Tasks</h3>
      {abilities.edit ? <TaskComposer contactId={record.contact.id} members={members} viewerId={viewerId} apply={apply} onChanged={onChanged} inputRef={taskRef} /> : null}
      {tasks.length ? (
        <ul className="divide-y">
          {tasks.map((t) => (
            <TaskItem key={t.id} task={t} members={members} tz={record.timezone} now={now} canEdit={abilities.edit} apply={apply} onChanged={onChanged} />
          ))}
        </ul>
      ) : !abilities.edit ? (
        <p className="text-ui text-muted-foreground">No tasks for this contact.</p>
      ) : null}
    </section>
  );
}

function Tile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0 bg-card px-3.5 py-3">
      <dt className="text-caption font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-title-sm num">{value}</dd>
      {sub ? <dd className="mt-0.5 truncate text-caption text-muted-foreground">{sub}</dd> : null}
    </div>
  );
}

function Prop({ label, children, top }: { label: string; children: React.ReactNode; top?: boolean }) {
  return (
    <>
      <dt className={cn("text-muted-foreground", top ? "self-start pt-1" : "")}>{label}</dt>
      <dd className="flex min-h-7 min-w-0 items-center">{children}</dd>
    </>
  );
}

function engagementWord(score: number | null) {
  if (score === null) return "Not scored yet";
  if (score >= 70) return "Hot: active this week";
  if (score >= 40) return "Warm";
  if (score >= 15) return "Cooling off";
  return "Quiet lately";
}

export function Engagement({ score, compact }: { score: number; compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2" title={`Engagement ${score} of 100`}>
      <span className="num">{score}</span>
      <span aria-hidden className={cn("relative h-1 overflow-hidden rounded-full bg-fill-active", compact ? "w-8" : "w-12")}>
        <span className={cn("absolute inset-y-0 left-0 rounded-full", score >= 70 ? "bg-brand" : "bg-fg-faint")} style={{ width: `${Math.max(4, score)}%` }} />
      </span>
    </span>
  );
}

function EmailLine({ email }: { email: string }) {
  const { copied, copy } = useCopy();
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <span className="truncate" translate="no">
        {email}
      </span>
      <button
        type="button"
        onClick={() => void copy(email)}
        aria-label={copied ? "Email copied" : "Copy email"}
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-fill-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        {copied ? <CheckIcon aria-hidden className="size-3.5" /> : <CopyIcon aria-hidden className="size-3.5" />}
      </button>
    </span>
  );
}

function NameField({ name, fallback, editable, onSave, large }: { name: string | null; fallback: string; editable: boolean; onSave: (name: string) => void; large: boolean }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(name ?? "");
  const cls = cn("min-w-0 text-balance break-words", large ? "text-title" : "text-title-sm");
  if (!editable) return <h2 className={cls}>{name || fallback}</h2>;
  if (editing) {
    const commit = () => {
      setEditing(false);
      if (text.trim() !== (name ?? "")) onSave(text.trim());
    };
    return (
      <input
        autoFocus
        aria-label="Name"
        value={text}
        maxLength={120}
        autoComplete="off"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setText(name ?? "");
            setEditing(false);
          }
        }}
        className={cn(cls, "-mx-1.5 w-full rounded-md bg-fill px-1.5 outline-2 outline-ring max-sm:text-base")}
      />
    );
  }
  return (
    <h2 className={cls}>
      <button
        type="button"
        onClick={() => {
          setText(name ?? "");
          setEditing(true);
        }}
        title="Rename"
        className="-mx-1.5 max-w-full rounded-md px-1.5 text-left transition-colors duration-100 hover:bg-fill-hover focus-visible:outline-2 focus-visible:outline-ring"
      >
        {name || <span className="text-muted-foreground">{fallback}</span>}
      </button>
    </h2>
  );
}

function Credit({ record }: { record: ContactRecord }) {
  const byModel = Object.entries(
    record.credits.reduce<Record<string, { label: string; revenueMinor: number }[]>>((acc, x) => {
      (acc[x.model] ??= []).push(x);
      return acc;
    }, {}),
  );
  if (!byModel.length) {
    return (
      <div className="flex items-start gap-3 rounded-lg bg-fill/60 p-3 text-ui">
        <PieChartIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-faint" />
        <div className="space-y-1">
          <p className="font-medium">No revenue to split yet</p>
          <p className="text-pretty text-muted-foreground">When a payment is matched to this contact, each attribution model shows which campaigns earn the credit.</p>
        </div>
      </div>
    );
  }
  const sig = (items: { label: string; revenueMinor: number }[]) => items.map((x) => `${x.label}:${x.revenueMinor}`).join("|");
  const agree = byModel.length > 1 && byModel.every(([, items]) => sig(items) === sig(byModel[0][1]));
  const groups: [string, { label: string; revenueMinor: number }[]][] = agree ? [["all", byModel[0][1]]] : byModel;
  return (
    <div className="space-y-5">
      <p className="text-ui text-pretty text-muted-foreground">How each attribution model splits this contact’s revenue between the campaigns that touched them.</p>
      {groups.map(([model, items]) => {
        const total = items.reduce((s, x) => s + Math.abs(x.revenueMinor), 0) || 1;
        return (
          <div key={model} className="space-y-2.5">
            <h3 className="text-caption font-medium text-muted-foreground">{model === "all" ? "Every model agrees" : (MODEL_LABELS[model] ?? model)}</h3>
            {items.map((x) => {
              const share = Math.abs(x.revenueMinor) / total;
              return (
                <div key={x.label} className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-3 text-ui">
                    <span className="min-w-0 truncate" title={x.label}>
                      {x.label}
                    </span>
                    <span className="num shrink-0 font-medium">
                      {money(x.revenueMinor, record.currency)}
                      <span className="ml-1.5 inline-block w-9 text-right text-caption font-normal text-muted-foreground">{pct(share, 0)}</span>
                    </span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-fill-active">
                    <div className={cn("h-full rounded-full", x.revenueMinor < 0 ? "bg-negative" : "bg-chart-revenue")} style={{ width: `${Math.round(share * 100)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
