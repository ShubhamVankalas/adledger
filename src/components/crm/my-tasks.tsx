"use client";

import { CircleCheckBigIcon } from "lucide-react";
import { useMemo } from "react";
import type { CrmMember, TaskRow } from "@/lib/crm-query";
import { useHotkeys } from "@/lib/hotkeys";
import { cn } from "@/lib/utils";
import { dayKey } from "./crm-format";
import { TaskComposer, TaskItem, useTaskList } from "./tasks";

const GROUPS = [
  { id: "overdue", label: "Overdue" },
  { id: "today", label: "Today" },
  { id: "upcoming", label: "Upcoming" },
  { id: "someday", label: "No due date" },
  { id: "done", label: "Done in the last 14 days" },
] as const;
type Group = (typeof GROUPS)[number]["id"];

/** My tasks: everything assigned to the viewer, grouped Overdue / Today / Upcoming / No date / Done. */
export function MyTasks({ tasks, members, viewerId, canEdit, tz, now }: { tasks: TaskRow[]; members: CrmMember[]; viewerId: string; canEdit: boolean; tz: string; now: string }) {
  const [list, apply] = useTaskList(tasks);
  useHotkeys(canEdit ? [{ id: "tasks.new", keys: "t", label: "New task", group: "Tasks", run: () => document.getElementById("my-task-input")?.focus() }] : []);
  const grouped = useMemo(() => {
    const today = dayKey(now, tz);
    const out: Record<Group, TaskRow[]> = { overdue: [], today: [], upcoming: [], someday: [], done: [] };
    for (const t of list) {
      if (t.doneAt) out.done.push(t);
      else if (!t.dueAt) out.someday.push(t);
      else if (new Date(t.dueAt).getTime() < new Date(now).getTime()) out.overdue.push(t);
      else if (dayKey(t.dueAt, tz) === today) out.today.push(t);
      else out.upcoming.push(t);
    }
    out.done.sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? ""));
    return out;
  }, [list, now, tz]);
  const open = list.filter((t) => !t.doneAt).length;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {canEdit ? <TaskComposer members={members} viewerId={viewerId} apply={apply} onChanged={noop} inputId="my-task-input" /> : null}
      {open === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl bg-card px-6 py-12 text-center shadow-sm">
          <span className="flex size-10 items-center justify-center rounded-full bg-fill text-muted-foreground">
            <CircleCheckBigIcon aria-hidden className="size-5" strokeWidth={1.75} />
          </span>
          <div className="space-y-1">
            <p className="text-title-sm">{list.length ? "All caught up" : "No tasks yet"}</p>
            <p className="mx-auto max-w-sm text-ui text-pretty text-muted-foreground">
              {list.length
                ? "Nothing open. New follow-ups you or your team assign to you show up here."
                : "Add follow-ups here or from a contact’s record (press T there). Tasks assigned to you land on this page."}
            </p>
          </div>
        </div>
      ) : null}
      {GROUPS.map((g) =>
        grouped[g.id].length ? (
          <section key={g.id} aria-labelledby={`tasks-${g.id}`} className="space-y-1">
            <h2 id={`tasks-${g.id}`} className={cn("flex items-center gap-2 label-caps", g.id === "overdue" && "text-negative")}>
              {g.label}
              <span className="num font-normal tracking-normal text-fg-faint normal-case">{grouped[g.id].length}</span>
            </h2>
            <ul className="divide-y rounded-xl bg-card px-4 shadow-sm">
              {grouped[g.id].map((t) => (
                <TaskItem key={t.id} task={t} members={members} tz={tz} now={now} canEdit={canEdit} showContact apply={apply} onChanged={noop} />
              ))}
            </ul>
          </section>
        ) : null,
      )}
    </div>
  );
}
const noop = () => undefined;
