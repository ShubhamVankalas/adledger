"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { ActionResult } from "@/lib/actions";

/** "Revoke this key? Apps using it will stop working." → title "Revoke this key?" + the rest as the description. */
function splitConfirm(text: string) {
  const i = text.indexOf("?");
  if (i === -1 || i === text.length - 1) return { title: i === -1 ? "Are you sure?" : text, description: i === -1 ? text : null };
  return { title: text.slice(0, i + 1), description: text.slice(i + 1).trim() };
}

/**
 * A button that runs a server action and toasts the result. With `confirm`, it opens a confirmation
 * dialog first (instead of window.confirm, which is jarring on phones and can't be styled).
 */
export function ActionButton({
  action,
  children,
  confirm,
  confirmLabel,
  onDone,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "onClick" | "action"> & {
  action: () => Promise<ActionResult>;
  confirm?: string;
  /** Label for the dialog's confirm button. Defaults to the button text, or "Confirm" for icon-only buttons. */
  confirmLabel?: string;
  onDone?: (r: ActionResult) => void;
}) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const run = () =>
    start(async () => {
      const r = await action();
      if (r.ok) toast.success(r.message ?? "Done");
      else toast.error(r.message ?? "Something went wrong. Try again.");
      setOpen(false);
      onDone?.(r);
      router.refresh();
    });
  const content = (
    <>
      {pending ? <Spinner tone="current" className="size-4" /> : null}
      {children}
    </>
  );

  if (!confirm) {
    return (
      <Button {...props} disabled={pending || props.disabled} onClick={run}>
        {content}
      </Button>
    );
  }

  const { title, description } = splitConfirm(confirm);
  const label = confirmLabel ?? (typeof children === "string" ? children : "Confirm");
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
      <DialogTrigger render={<Button {...props} disabled={pending || props.disabled} />}>{content}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-balance">{title}</DialogTitle>
          {description ? <DialogDescription className="text-pretty">{description}</DialogDescription> : null}
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" className="h-10 sm:h-8" disabled={pending} />}>Cancel</DialogClose>
          <Button variant="destructive" className="h-10 sm:h-8" disabled={pending} onClick={run}>
            {pending ? <Spinner tone="current" className="size-4" /> : null}
            {pending ? "Working…" : label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function useFormAction(action: (f: FormData) => Promise<ActionResult>, onDone?: (r: ActionResult) => void) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const submit = (form: FormData) =>
    start(async () => {
      const r = await action(form);
      if (r.ok) toast.success(r.message ?? "Saved");
      else toast.error(r.message ?? "Something went wrong. Try again.");
      onDone?.(r);
      router.refresh();
    });
  return { pending, submit };
}
