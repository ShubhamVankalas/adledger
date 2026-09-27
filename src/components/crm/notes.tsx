"use client";

import { MoreHorizontalIcon, PencilIcon, PinIcon, PinOffIcon, StickyNoteIcon, Trash2Icon } from "lucide-react";
import { startTransition, useId, useOptimistic, useRef, useState } from "react";
import { addNoteAction, deleteNoteAction, pinNoteAction, updateNoteAction } from "@/app/actions/crm";
import { UserAvatar } from "@/components/avatars";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Keycaps } from "@/components/keycaps";
import type { CrmAbilities, CrmMember, NoteRow } from "@/lib/crm-query";
import { cn } from "@/lib/utils";
import { relative } from "./crm-format";
import { runAction } from "./run-action";

type Op = { type: "add"; note: NoteRow } | { type: "remove"; id: string } | { type: "patch"; id: string; patch: Partial<NoteRow> };

function sortNotes(list: NoteRow[]) {
  return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt));
}

/**
 * Private notes on a contact: a composer plus the list (pinned first). Notes are part of the
 * contact record: deleted with it, never exported and never sent to AI or MCP.
 */
export function NotesSection({
  contactId,
  notes,
  members,
  viewerId,
  abilities,
  tz,
  now,
  onChanged,
  composerRef,
}: {
  contactId: string;
  notes: NoteRow[];
  members: CrmMember[];
  viewerId: string;
  abilities: CrmAbilities;
  tz: string;
  now: string;
  onChanged: () => Promise<void> | void;
  composerRef?: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const [list, apply] = useOptimistic(notes, (state: NoteRow[], op: Op) => {
    if (op.type === "add") return sortNotes([op.note, ...state]);
    if (op.type === "remove") return state.filter((n) => n.id !== op.id);
    return sortNotes(state.map((n) => (n.id === op.id ? { ...n, ...op.patch } : n)));
  });
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();
  const me = members.find((m) => m.id === viewerId);

  const submit = () => {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    startTransition(async () => {
      apply({
        type: "add",
        note: { id: `tmp-${Date.now()}`, body, pinned: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), authorUserId: viewerId, authorName: me?.name ?? me?.email ?? null },
      });
      setDraft("");
      const res = await runAction(addNoteAction(contactId, body), { success: false });
      if (!res.ok) setDraft(body);
      await onChanged();
      setBusy(false);
    });
  };

  const remove = (note: NoteRow) =>
    startTransition(async () => {
      apply({ type: "remove", id: note.id });
      await runAction(deleteNoteAction(note.id), {
        undo: async (res) => {
          const restored = await addNoteAction(contactId, String(res.data?.body ?? note.body));
          if (restored.ok && note.pinned && restored.data?.id) await pinNoteAction(String(restored.data.id), true);
          await onChanged();
          return restored;
        },
      });
      await onChanged();
    });

  const pin = (note: NoteRow) =>
    startTransition(async () => {
      apply({ type: "patch", id: note.id, patch: { pinned: !note.pinned } });
      await runAction(pinNoteAction(note.id, !note.pinned), { success: false });
      await onChanged();
    });

  const save = (note: NoteRow, body: string) =>
    startTransition(async () => {
      setEditing(null);
      apply({ type: "patch", id: note.id, patch: { body, updatedAt: new Date().toISOString() } });
      await runAction(updateNoteAction(note.id, body), { success: false });
      await onChanged();
    });

  return (
    <div className="space-y-3">
      {abilities.edit ? (
        <form
          className="rounded-lg border bg-surface transition-[border-color,box-shadow] duration-100 focus-within:border-border-strong focus-within:shadow-[0_0_0_3px_var(--ring)]"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label htmlFor={id} className="sr-only">
            New note
          </label>
          <textarea
            id={id}
            ref={composerRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
            rows={2}
            maxLength={5000}
            placeholder="Add a note for your team…"
            className="block max-h-60 min-h-16 w-full resize-y bg-transparent px-3 pt-2.5 text-body outline-none field-sizing-content placeholder:text-fg-faint max-sm:text-base"
          />
          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <span className="hidden items-center gap-1.5 pl-1 text-caption text-fg-faint sm:inline-flex">
              <Keycaps keys="mod+enter" /> to save
            </span>
            <Button type="submit" size="sm" disabled={!draft.trim() || busy} className="ml-auto">
              {busy ? "Saving…" : "Add note"}
            </Button>
          </div>
        </form>
      ) : null}

      {list.length === 0 ? (
        <div className="flex items-start gap-3 rounded-lg bg-fill/60 px-3 py-3 text-ui text-muted-foreground">
          <StickyNoteIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-faint" />
          <p className="text-pretty">No notes yet. Notes stay inside AdLedger: they are never exported or shared with AI.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {list.map((note) => {
            const author = members.find((m) => m.id === note.authorUserId);
            const mine = note.authorUserId === viewerId;
            const canChange = abilities.edit && (mine || abilities.moderate) && !note.id.startsWith("tmp-");
            const edited = new Date(note.updatedAt).getTime() - new Date(note.createdAt).getTime() > 60_000;
            return (
              <li key={note.id} className={cn("group/note rounded-lg border bg-surface px-3 py-2.5", note.pinned && "border-warning/40 bg-warning-soft/40", note.id.startsWith("tmp-") && "opacity-70")}>
                <div className="flex items-center gap-2">
                  {author ? <UserAvatar id={author.id} name={author.name} email={author.email} size="xs" /> : <span className="size-5 rounded-full bg-fill" aria-hidden />}
                  <span className="min-w-0 truncate text-ui font-medium">{note.authorName ?? (author ? author.name || author.email : "Former teammate")}</span>
                  <span className="shrink-0 text-caption text-fg-faint" title={new Date(note.createdAt).toLocaleString()}>
                    {relative(note.createdAt, tz, now)}
                    {edited ? " · edited" : ""}
                  </span>
                  {note.pinned ? <PinIcon aria-label="Pinned" className="size-3.5 shrink-0 text-warning-foreground" /> : null}
                  {canChange ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={<Button variant="ghost" size="icon-xs" className="ml-auto text-muted-foreground opacity-100 sm:opacity-0 sm:group-hover/note:opacity-100 sm:focus-visible:opacity-100 sm:aria-expanded:opacity-100" />}
                        aria-label="Note actions"
                      >
                        <MoreHorizontalIcon />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem onClick={() => pin(note)}>
                          {note.pinned ? <PinOffIcon /> : <PinIcon />}
                          {note.pinned ? "Unpin" : "Pin to top"}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setEditing(note.id)}>
                          <PencilIcon />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onClick={() => remove(note)}>
                          <Trash2Icon />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
                {editing === note.id ? (
                  <NoteEditor initial={note.body} onCancel={() => setEditing(null)} onSave={(body) => save(note, body)} />
                ) : (
                  <p className="mt-1.5 text-body break-words whitespace-pre-wrap text-foreground/90">{note.body}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function NoteEditor({ initial, onSave, onCancel }: { initial: string; onSave: (body: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <form
      className="mt-2 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) onSave(text.trim());
      }}
    >
      <textarea
        ref={ref}
        autoFocus
        aria-label="Edit note"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) onSave(text.trim());
        }}
        maxLength={5000}
        className="block min-h-20 w-full resize-y rounded-md border border-border-strong bg-transparent px-2.5 py-2 text-body outline-none field-sizing-content focus-visible:outline-2 focus-visible:outline-ring max-sm:text-base"
      />
      <div className="flex justify-end gap-1.5">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!text.trim() || text.trim() === initial}>
          Save
        </Button>
      </div>
    </form>
  );
}
