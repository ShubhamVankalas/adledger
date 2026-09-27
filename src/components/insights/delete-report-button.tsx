"use client";

import { Loader2Icon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteReportAction } from "@/app/actions/settings";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

/** Delete an AI report behind a confirmation dialog (replaces window.confirm, which is jarring on phones). */
export function DeleteReportButton({ id, period, withLabel }: { id: string; period: string; withLabel?: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size={withLabel ? "sm" : "icon"}
            className={withLabel ? "h-10 text-muted-foreground hover:text-destructive sm:h-7" : "size-10 text-muted-foreground hover:text-destructive sm:size-8"}
            aria-label={`Delete report for ${period}`}
          />
        }
      >
        <Trash2Icon aria-hidden />
        {withLabel ? "Delete report" : null}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this report?</DialogTitle>
          <DialogDescription>
            The report for <span className="font-medium text-foreground">{period}</span> will be removed. Your underlying data is not affected, and you can generate a new
            report at any time.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" className="h-10 sm:h-8" disabled={pending} />}>Cancel</DialogClose>
          <Button
            variant="destructive"
            className="h-10 sm:h-8"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await deleteReportAction(id);
                if (r.ok) toast.success(r.message ?? "Report deleted.");
                else toast.error(r.message ?? "Couldn’t delete the report. Try again in a moment.");
                setOpen(false);
                router.refresh();
              })
            }
          >
            {pending ? <Loader2Icon className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Trash2Icon aria-hidden />}
            {pending ? "Deleting…" : "Delete report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
