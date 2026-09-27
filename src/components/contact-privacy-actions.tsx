"use client";

import { DownloadIcon, EllipsisIcon, Loader2Icon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteContactAction } from "@/app/actions/privacy";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/**
 * Contact page: subject-access download and "Delete contact" (erasure) with a confirm dialog.
 * From md up these are two header buttons; on phones they collapse into one "…" menu so the header stays on one row.
 */
export function ContactPrivacyActions({ contactId, label, canExport, canDelete }: { contactId: string; label: string; canExport: boolean; canDelete: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  const erase = () =>
    start(async () => {
      const r = await deleteContactAction(contactId);
      if (!r.ok) {
        toast.error(r.message ?? "Something went wrong. Try again.");
        return;
      }
      toast.success(r.message ?? "Contact deleted");
      setOpen(false);
      router.push("/contacts");
      router.refresh();
    });

  if (!canExport && !canDelete) return null;
  const exportHref = `/api/v1/contacts/${contactId}/export`;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" size="icon" className="size-10 md:hidden" aria-label="Contact actions" />}>
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          {canExport ? (
            <DropdownMenuItem className="min-h-10" render={<a href={exportHref} download />}>
              <DownloadIcon /> Export data
            </DropdownMenuItem>
          ) : null}
          {canDelete ? (
            <DropdownMenuItem variant="destructive" className="min-h-10" onClick={() => setOpen(true)}>
              <Trash2Icon /> Delete contact
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {canExport ? (
        <Button variant="outline" size="sm" className="max-md:hidden" render={<a href={exportHref} download />}>
          <DownloadIcon /> Export data
        </Button>
      ) : null}
      {canDelete ? (
        <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
          <DialogTrigger render={<Button variant="outline" size="sm" className="text-destructive hover:text-destructive max-md:hidden" />}>
            <Trash2Icon /> Delete contact
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="break-words text-balance">Delete {label}?</DialogTitle>
              <DialogDescription>
                Use this for erasure requests (GDPR, CCPA). The contact, their email, name and form submissions are permanently deleted, and their
                browsing history is anonymized. Their payments stay in your totals as unattributed revenue. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" disabled={pending} />}>Cancel</DialogClose>
              <Button variant="destructive" onClick={erase} disabled={pending}>
                {pending ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />} {pending ? "Deleting…" : "Delete permanently"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
