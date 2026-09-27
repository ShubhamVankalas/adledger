"use client";

import {
  CalendarIcon,
  CheckIcon,
  MoreHorizontalIcon,
  Trash2Icon,
  UserRoundIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { startTransition, useId, useOptimistic, useState } from "react";
import {
  createTaskAction,
  deleteTaskAction,
  setTaskDoneAction,
  updateTaskAction,
} from "@/app/actions/crm";
import { UserAvatar } from "@/components/avatars";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CrmMember, TaskRow } from "@/lib/crm-query";
import { cn } from "@/lib/utils";
import { contactName, dueLabel } from "./crm-format";
import { memberName } from "./properties";
import { runAction } from "./run-action";

// Tasks: a composer and a list. Used on the contact record (tasks about that contact) and on
// My tasks (everything assigned to the viewer). Ticking a task is instant; deleting offers Undo.

/** 5 pm local time on a calendar day ("YYYY-MM-DD"): a due time that reads as "end of the working day". */
export function dueAtFromDate(date: string): string {
  return new Date(`${date}T17:00:00`).toISOString();
}
const localDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function presetDate(preset: "today" | "tomorrow" | "next_week"): string {
  const d = new Date();
  if (preset === "tomorrow") d.setDate(d.getDate() + 1);
  if (preset === "next_week")
    d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  return localDate(d);
}

type Op =
  | { type: "patch"; id: string; patch: Partial<TaskRow> }
  | { type: "remove"; id: string }
  | { type: "add"; task: TaskRow };

export function useTaskList(tasks: TaskRow[]) {
  return useOptimistic(tasks, (state: TaskRow[], op: Op) => {
    if (op.type === "add") return [...state, op.task];
    if (op.type === "remove") return state.filter((t) => t.id !== op.id);
    return state.map((t) => (t.id === op.id ? { ...t, ...op.patch } : t));
  });
}

export function TaskItem({
  task,
  members,
  tz,
  now,
  canEdit,
  showContact,
  apply,
  onChanged,
}: {
  task: TaskRow;
  members: CrmMember[];
  tz: string;
  now: string;
  canEdit: boolean;
  showContact?: boolean;
  apply: (op: Op) => void;
  onChanged: () => Promise<void> | void;
}) {
  const done = Boolean(task.doneAt);
  const due = task.dueAt ? dueLabel(task.dueAt, tz, now) : null;
  const assignee = members.find((m) => m.id === task.assigneeUserId);
  const pending = task.id.startsWith("tmp-");

  const toggle = () =>
    startTransition(async () => {
      apply({
        type: "patch",
        id: task.id,
        patch: { doneAt: done ? null : new Date().toISOString() },
      });
      await runAction(setTaskDoneAction(task.id, !done), {
        success: done ? false : "Task completed",
        undo: done
          ? undefined
          : async () => {
              const r = await setTaskDoneAction(task.id, false);
              await onChanged();
              return r;
            },
      });
      await onChanged();
    });
  const patch = (p: {
    dueAt?: string | null;
    assigneeUserId?: string | null;
  }) =>
    startTransition(async () => {
      apply({ type: "patch", id: task.id, patch: p });
      await runAction(updateTaskAction(task.id, p), { success: false });
      await onChanged();
    });
  const remove = () =>
    startTransition(async () => {
      apply({ type: "remove", id: task.id });
      await runAction(deleteTaskAction(task.id), {
        undo: async (res) => {
          const r = await createTaskAction({
            title: String(res.data?.title ?? task.title),
            dueAt: (res.data?.dueAt as string | null) ?? null,
            contactId: (res.data?.contactId as string | null) ?? null,
            assigneeUserId: (res.data?.assigneeUserId as string | null) ?? null,
          });
          await onChanged();
          return r;
        },
      });
      await onChanged();
    });

  return (
    <li
      className={cn(
        "group/task flex items-start gap-2.5 py-2",
        pending && "opacity-60",
      )}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={
          done ? `Reopen “${task.title}”` : `Complete “${task.title}”`
        }
        disabled={!canEdit || pending}
        onClick={toggle}
        className={cn(
          "mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full border transition-[background-color,border-color,color] duration-100 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-default",
          done
            ? "border-transparent bg-primary text-primary-foreground"
            : "border-border-strong text-transparent hover:border-fg-muted hover:text-fg-faint",
        )}
      >
        <CheckIcon aria-hidden className="size-3" strokeWidth={2.5} />
      </button>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-ui break-words",
            done && "text-muted-foreground line-through decoration-fg-faint",
          )}
        >
          {task.title}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-muted-foreground">
          {due ? (
            <span
              className={cn(
                "inline-flex items-center gap-1",
                !done && due.overdue && "font-medium text-negative",
                !done && due.today && !due.overdue && "text-foreground",
              )}
            >
              <CalendarIcon aria-hidden className="size-3" />
              {!done && due.overdue && !due.today
                ? `Overdue · ${due.text}`
                : due.text}
            </span>
          ) : null}
          {showContact && task.contact ? (
            <Link
              href={`/contacts/${task.contact.id}`}
              className="min-w-0 truncate rounded-sm hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              {contactName(task.contact)}
            </Link>
          ) : null}
          {!showContact && assignee ? (
            <span className="inline-flex items-center gap-1">
              <UserAvatar
                id={assignee.id}
                name={assignee.name}
                email={assignee.email}
                size="xs"
                className="size-4 text-[8px]"
              />
              {memberName(assignee)}
            </span>
          ) : null}
        </p>
      </div>
      {canEdit && !pending ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground sm:opacity-0 sm:group-hover/task:opacity-100 sm:focus-visible:opacity-100 sm:aria-expanded:opacity-100"
              />
            }
            aria-label={`Actions for “${task.title}”`}
          >
            <MoreHorizontalIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Due</DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() =>
                  patch({ dueAt: dueAtFromDate(presetDate("today")) })
                }
              >
                Today
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  patch({ dueAt: dueAtFromDate(presetDate("tomorrow")) })
                }
              >
                Tomorrow
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  patch({ dueAt: dueAtFromDate(presetDate("next_week")) })
                }
              >
                Next Monday
              </DropdownMenuItem>
              {task.dueAt ? (
                <DropdownMenuItem onClick={() => patch({ dueAt: null })}>
                  <XIcon />
                  No due date
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <UserRoundIcon className="size-4 text-muted-foreground" />
                Assign to
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-56">
                {members
                  .filter((m) => m.canEdit)
                  .map((m) => (
                    <DropdownMenuItem
                      key={m.id}
                      onClick={() =>
                        m.id !== task.assigneeUserId &&
                        patch({ assigneeUserId: m.id })
                      }
                    >
                      <UserAvatar
                        id={m.id}
                        name={m.name}
                        email={m.email}
                        size="xs"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {memberName(m)}
                      </span>
                      {m.id === task.assigneeUserId ? (
                        <CheckIcon className="size-3.5" />
                      ) : null}
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={remove}>
              <Trash2Icon />
              Delete task
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </li>
  );
}

/** One-line task composer: title, optional due date, assignee (defaults to the viewer). */
export function TaskComposer({
  contactId,
  members,
  viewerId,
  apply,
  onChanged,
  inputRef,
  inputId,
}: {
  contactId?: string | null;
  members: CrmMember[];
  viewerId: string;
  apply?: (op: Op) => void;
  onChanged: () => Promise<void> | void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  inputId?: string;
}) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [assignee, setAssignee] = useState(viewerId);
  const generated = useId();
  const id = inputId ?? generated;
  const current = members.find((m) => m.id === assignee);

  const submit = () => {
    const t = title.trim();
    if (!t) return;
    const dueAt = date ? dueAtFromDate(date) : null;
    // Clear the field at once (outside the transition); the task shows optimistically until saved.
    setTitle("");
    setDate("");
    startTransition(async () => {
      apply?.({
        type: "add",
        task: {
          id: `tmp-${Date.now()}`,
          title: t,
          dueAt,
          doneAt: null,
          createdAt: new Date().toISOString(),
          assigneeUserId: assignee,
          contact: null,
        },
      });
      const res = await runAction(
        createTaskAction({
          title: t,
          dueAt,
          contactId: contactId ?? null,
          assigneeUserId: assignee,
        }),
        { success: false },
      );
      if (!res.ok) setTitle(t);
      await onChanged();
    });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="rounded-lg border bg-surface transition-[border-color,box-shadow] duration-100 focus-within:border-border-strong focus-within:shadow-[0_0_0_3px_var(--ring)]"
    >
      <label htmlFor={id} className="sr-only">
        New task
      </label>
      <input
        id={id}
        ref={inputRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={contactId ? "Add a follow-up…" : "Add a task…"}
        maxLength={200}
        autoComplete="off"
        className="h-10 w-full bg-transparent px-3 text-body outline-none placeholder:text-fg-faint max-sm:text-base"
      />
      <div className="flex items-center gap-1 px-1.5 pb-1.5">
        <label className="relative inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-caption text-muted-foreground transition-colors hover:bg-fill-hover focus-within:outline-2 focus-within:outline-ring">
          <CalendarIcon aria-hidden className="size-3.5" />
          <span className="num">
            {date
              ? new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })
              : "Due date"}
          </span>
          <input
            type="date"
            value={date}
            min={localDate(new Date())}
            suppressHydrationWarning
            onChange={(e) => setDate(e.target.value)}
            aria-label="Due date"
            className="absolute inset-0 cursor-pointer opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer"
          />
        </label>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-caption text-muted-foreground outline-none hover:bg-fill-hover focus-visible:outline-2 focus-visible:outline-ring aria-expanded:bg-fill-hover"
            aria-label={`Assignee: ${memberName(current)}`}
          >
            {current ? (
              <UserAvatar
                id={current.id}
                name={current.name}
                email={current.email}
                size="xs"
                className="size-4 text-[8px]"
              />
            ) : (
              <UserRoundIcon aria-hidden className="size-3.5" />
            )}
            <span className="max-w-28 truncate">
              {current?.id === viewerId ? "Me" : memberName(current)}
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Assign to</DropdownMenuLabel>
              {members
                .filter((m) => m.canEdit || m.id === viewerId)
                .map((m) => (
                  <DropdownMenuItem
                    key={m.id}
                    onClick={() => setAssignee(m.id)}
                  >
                    <UserAvatar
                      id={m.id}
                      name={m.name}
                      email={m.email}
                      size="xs"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {memberName(m)}
                      {m.id === viewerId ? (
                        <span className="text-muted-foreground"> (you)</span>
                      ) : null}
                    </span>
                    {m.id === assignee ? (
                      <CheckIcon className="size-3.5" />
                    ) : null}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          type="submit"
          size="sm"
          disabled={!title.trim()}
          className="ml-auto"
        >
          Add task
        </Button>
      </div>
    </form>
  );
}
