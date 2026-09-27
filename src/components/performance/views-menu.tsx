"use client";

import { BookmarkIcon, CheckIcon, ChevronDownIcon, PencilIcon, PinIcon, PinOffIcon, PlusIcon, RefreshCwIcon, Trash2Icon, UsersIcon } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteViewAction, renameViewAction, saveViewAction, setViewPinnedAction, updateViewParamsAction } from "@/app/actions/views";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { SavedViewPage } from "@/lib/db/schema";
import { cn } from "@/lib/utils";
import { sameViewParams, VIEW_NAME_MAX, type SavedView } from "@/lib/view-params";
import { writeParams } from "./use-table-url";

// "Views ▾": reopen, save, update, rename, pin and delete saved views of this page's URL state.
// Personal views need only reports.view; shared ones need views.share (the server checks both).

type DialogState = { kind: "save" } | { kind: "rename"; view: SavedView } | { kind: "delete"; view: SavedView } | null;

export function ViewsMenu({
  page,
  initialViews,
  canShare,
  params,
  className,
}: {
  page: SavedViewPage;
  initialViews: SavedView[];
  canShare: boolean;
  /** The page's current URL state. */
  params: URLSearchParams;
  className?: string;
}) {
  const [views, setViews] = useState(initialViews);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busy, startTransition] = useTransition();
  const activeId = params.get("view");
  const active = views.find((v) => v.id === activeId) ?? null;
  const modified = active ? !sameViewParams(page, params, active.params) : false;
  const editable = (v: SavedView) => (v.shared ? canShare : v.mine);
  const shared = views.filter((v) => v.shared);
  const mine = views.filter((v) => !v.shared);

  const act = (fn: () => Promise<{ ok: boolean; message?: string; views?: SavedView[] }>, after?: (r: { views?: SavedView[] }) => void) =>
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) {
        toast.error(r.message ?? "Something went wrong.");
        return;
      }
      if (r.views) setViews(r.views);
      if (r.message) toast.success(r.message);
      after?.(r);
      setDialog(null);
    });

  const current = () => Object.fromEntries(params.entries());

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              aria-label={active ? `Views: ${active.name}${modified ? ", modified" : ""}` : "Views"}
              className={cn("h-10 w-10 max-w-52 px-0 font-normal @md:w-auto @md:px-3 @3xl:h-7 @3xl:px-2.5", className)}
            />
          }
        >
          <BookmarkIcon aria-hidden className={cn("text-muted-foreground", active && "fill-current text-foreground")} />
          <span className="hidden truncate @md:inline">{active ? active.name : "Views"}</span>
          {modified ? <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-warning" title="Changed since it was saved" /> : null}
          <ChevronDownIcon aria-hidden className="hidden size-3.5 text-fg-faint @md:block" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {views.length === 0 ? (
            <p className="px-2 py-2 text-caption text-pretty text-muted-foreground">Save the columns, filters and sort you use most, then reopen them in one click or pin them to the sidebar.</p>
          ) : null}
          {shared.length ? (
            <DropdownMenuGroup>
              <DropdownMenuLabel>Shared with the workspace</DropdownMenuLabel>
              {shared.map((v) => (
                <ViewItem key={v.id} view={v} active={v.id === activeId} />
              ))}
            </DropdownMenuGroup>
          ) : null}
          {mine.length ? (
            <DropdownMenuGroup>
              <DropdownMenuLabel>Your views</DropdownMenuLabel>
              {mine.map((v) => (
                <ViewItem key={v.id} view={v} active={v.id === activeId} />
              ))}
            </DropdownMenuGroup>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setDialog({ kind: "save" })}>
            <PlusIcon aria-hidden />
            Save current view…
          </DropdownMenuItem>
          {active && editable(active) ? (
            <>
              {modified ? (
                <DropdownMenuItem disabled={busy} onClick={() => act(() => updateViewParamsAction(active.id, current()))}>
                  <RefreshCwIcon aria-hidden />
                  <span className="truncate">Update “{active.name}”</span>
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onClick={() => setDialog({ kind: "rename", view: active })}>
                <PencilIcon aria-hidden />
                Rename…
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={busy}
                onClick={() => act(() => setViewPinnedAction(active.id, !active.pinned))}
              >
                {active.pinned ? <PinOffIcon aria-hidden /> : <PinIcon aria-hidden />}
                {active.pinned ? "Unpin from sidebar" : "Pin to sidebar"}
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => setDialog({ kind: "delete", view: active })}>
                <Trash2Icon aria-hidden />
                Delete…
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialog?.kind === "save" || dialog?.kind === "rename"} onOpenChange={(o) => (o ? null : setDialog(null))}>
        <DialogContent>
          {dialog?.kind === "save" || dialog?.kind === "rename" ? (
            <NameForm
              key={dialog.kind === "rename" ? dialog.view.id : "save"}
              mode={dialog.kind}
              initialName={dialog.kind === "rename" ? dialog.view.name : ""}
              canShare={canShare && dialog.kind === "save"}
              busy={busy}
              onCancel={() => setDialog(null)}
              onSubmit={(name, share) => {
                if (dialog.kind === "rename") return act(() => renameViewAction(dialog.view.id, name));
                act(
                  () => saveViewAction({ page, name, params: current(), shared: share }),
                  (r) => {
                    const created = (r as { view?: SavedView }).view;
                    if (created) writeParams({ view: created.id });
                  },
                );
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={dialog?.kind === "delete"} onOpenChange={(o) => (o ? null : setDialog(null))}>
        <DialogContent>
          {dialog?.kind === "delete" ? (
            <>
              <DialogHeader>
                <DialogTitle>Delete “{dialog.view.name}”?</DialogTitle>
                <DialogDescription>
                  {dialog.view.shared ? "It disappears for everyone in this workspace." : "Only you can see this view."} The report itself isn&rsquo;t affected.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialog(null)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  disabled={busy}
                  onClick={() =>
                    act(
                      () => deleteViewAction(dialog.view.id),
                      () => {
                        if (activeId === dialog.view.id) writeParams({ view: null });
                      },
                    )
                  }
                >
                  {busy ? "Deleting…" : "Delete view"}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ViewItem({ view, active }: { view: SavedView; active: boolean }) {
  return (
    <DropdownMenuItem render={<Link href={view.href} />} aria-current={active || undefined}>
      <span className="flex size-4 items-center justify-center">{active ? <CheckIcon aria-hidden className="size-3.5 text-foreground" /> : null}</span>
      <span className="min-w-0 flex-1 truncate">{view.name}</span>
      {view.pinned ? <PinIcon aria-label="Pinned" className="size-3 text-fg-faint" /> : null}
      {view.shared ? <UsersIcon aria-label="Shared" className="size-3 text-fg-faint" /> : null}
    </DropdownMenuItem>
  );
}

function NameForm({
  mode,
  initialName,
  canShare,
  busy,
  onCancel,
  onSubmit,
}: {
  mode: "save" | "rename";
  initialName: string;
  canShare: boolean;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (name: string, share: boolean) => void;
}) {
  const [name, setName] = useState(initialName);
  const [share, setShare] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) {
          setError("Give the view a name.");
          return;
        }
        onSubmit(name.trim(), share);
      }}
    >
      <DialogHeader>
        <DialogTitle>{mode === "save" ? "Save view" : "Rename view"}</DialogTitle>
        {mode === "save" ? <DialogDescription>Keeps the date range, filters, level, columns and sort you have now.</DialogDescription> : null}
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="view-name">Name</Label>
        <Input
          id="view-name"
          name="view-name"
          autoComplete="off"
          maxLength={VIEW_NAME_MAX}
          placeholder="Meta lead gen, last 30 days…"
          value={name}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "view-name-error" : undefined}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          autoFocus
        />
        {error ? (
          <p id="view-name-error" className="text-caption text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      {canShare ? (
        <label className="flex cursor-pointer items-start justify-between gap-4">
          <span>
            <span className="block text-ui font-medium">Share with the workspace</span>
            <span className="block text-caption text-muted-foreground">Everyone here can open it. Only admins and analysts can change it.</span>
          </span>
          <Switch checked={share} onCheckedChange={setShare} aria-label="Share with the workspace" />
        </label>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : mode === "save" ? "Save view" : "Rename"}
        </Button>
      </DialogFooter>
    </form>
  );
}
