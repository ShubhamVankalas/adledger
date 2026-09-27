"use client";

import { DownloadIcon, Loader2Icon, TagIcon, Trash2Icon, UserRoundIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { addTagAction, deleteContactsAction, exportContactsAction, removeTagAction, restoreOwnersAction, setOwnerAction } from "@/app/actions/crm";
import { UserAvatar } from "@/components/avatars";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { CrmAbilities, CrmMember } from "@/lib/crm-query";
import { memberName, TagAdder } from "./properties";
import { runAction } from "./run-action";

const BAR_BUTTON =
  "inline-flex h-8 items-center gap-1.5 rounded-md border border-ink-foreground/20 px-2.5 text-ui font-medium text-ink-foreground transition-[background-color] duration-100 outline-none hover:bg-ink-foreground/12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-expanded:bg-ink-foreground/12 disabled:opacity-50 [&_svg]:size-3.5";

/**
 * Floating bar docked at the bottom centre while rows are selected: tag, assign an owner,
 * export (when permitted) and delete (with confirmation). Tag and owner changes offer Undo.
 */
export function BulkBar({
  ids,
  members,
  viewerId,
  tagSuggestions,
  abilities,
  onClear,
  onDeleted,
}: {
  ids: string[];
  members: CrmMember[];
  viewerId: string;
  tagSuggestions: string[];
  abilities: CrmAbilities;
  onClear: () => void;
  onDeleted: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<null | "export" | "delete">(null);
  if (!ids.length) return null;
  const n = ids.length;
  const noun = n === 1 ? "contact" : "contacts";

  const tag = (t: string) =>
    void runAction(addTagAction(ids, t), {
      undo: (res) => removeTagAction((res.data?.added as string[]) ?? [], String(res.data?.tag ?? t)),
    });
  const assign = (owner: string | null) =>
    void runAction(setOwnerAction(ids, owner), {
      undo: (res) => restoreOwnersAction((res.data?.previous as { id: string; ownerUserId: string | null }[]) ?? []),
    });
  const exportCsv = async () => {
    setBusy("export");
    const res = await runAction(exportContactsAction(ids));
    setBusy(null);
    if (!res.ok || typeof res.data?.csv !== "string") return;
    const url = URL.createObjectURL(new Blob([res.data.csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `contacts-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const erase = async () => {
    setBusy("delete");
    const res = await runAction(deleteContactsAction(ids));
    setBusy(null);
    if (res.ok) {
      setConfirm(false);
      onDeleted();
    }
  };

  return (
    <>
      <div
        role="toolbar"
        aria-label={`Actions for ${n} selected ${noun}`}
        className="fixed inset-x-3 bottom-[calc(88px+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-fit animate-in items-center gap-1.5 overflow-x-auto rounded-[10px] bg-ink py-1.5 pr-1.5 pl-3.5 text-ink-foreground shadow-lg fade-in-0 slide-in-from-bottom-2 duration-200 ease-out md:bottom-6"
      >
        <span className="num shrink-0 pr-1 text-ui font-medium whitespace-nowrap" aria-live="polite">
          {n.toLocaleString("en-US")} selected
        </span>
        {abilities.edit ? (
          <>
            <TagAdder suggestions={tagSuggestions} onAdd={tag} side="top" triggerClassName={`${BAR_BUTTON} h-8 text-ink-foreground hover:text-ink-foreground`}>
              <TagIcon aria-hidden />
              Tag
            </TagAdder>
            <DropdownMenu>
              <DropdownMenuTrigger className={BAR_BUTTON}>
                <UserRoundIcon aria-hidden />
                Owner
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-60">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Assign {n.toLocaleString("en-US")} {noun} to</DropdownMenuLabel>
                  {members
                    .filter((m) => m.canEdit)
                    .map((m) => (
                      <DropdownMenuItem key={m.id} onClick={() => assign(m.id)}>
                        <UserAvatar id={m.id} name={m.name} email={m.email} size="xs" />
                        <span className="min-w-0 flex-1 truncate">
                          {memberName(m)}
                          {m.id === viewerId ? <span className="text-muted-foreground"> (you)</span> : null}
                        </span>
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => assign(null)}>
                  <XIcon className="text-muted-foreground" />
                  Remove owner
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : null}
        {abilities.export ? (
          <button type="button" className={BAR_BUTTON} onClick={exportCsv} disabled={busy !== null}>
            {busy === "export" ? <Loader2Icon aria-hidden className="animate-spin" /> : <DownloadIcon aria-hidden />}
            Export
          </button>
        ) : null}
        {abilities.delete ? (
          <button type="button" className={BAR_BUTTON} onClick={() => setConfirm(true)} disabled={busy !== null} aria-label={`Delete ${n} ${noun}`}>
            <Trash2Icon aria-hidden />
            <span className="max-sm:sr-only">Delete</span>
          </button>
        ) : null}
        <button type="button" onClick={onClear} aria-label="Clear selection" className={`${BAR_BUTTON} w-8 justify-center border-transparent px-0`}>
          <XIcon aria-hidden />
        </button>
      </div>

      <Dialog open={confirm} onOpenChange={(o) => busy === null && setConfirm(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Delete {n.toLocaleString("en-US")} {noun}?
            </DialogTitle>
            <DialogDescription>
              Their email, name, notes, tasks and form submissions are permanently deleted and their browsing history is anonymized. Their payments stay in
              your totals as unattributed revenue. This can’t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={busy !== null} />}>Cancel</DialogClose>
            <Button variant="destructive" onClick={erase} disabled={busy !== null}>
              {busy === "delete" ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />}
              {busy === "delete" ? "Deleting…" : `Delete ${noun}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
