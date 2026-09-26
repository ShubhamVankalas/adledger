"use client";

import { DownloadIcon, Loader2Icon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteContactAction } from "@/app/actions/privacy";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

/** Contact page: subject-access download and "Delete contact" (erasure) with a confirm dialog. */
export function ContactPrivacyActions({ contactId, label, canExport, canDelete }: { contactId: string; label: string; canExport: boolean; canDelete: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  const erase = () =>
    start(async () => {
      const r = await deleteContactAction(contactId);
      if (!r.ok) {
        toast.error(r.message ?? "Something went wrong");
        return;
      }
      toast.success(r.message ?? "Contact deleted");
      setOpen(false);
      router.push("/contacts");
      router.refresh();
    });

  return (
    <>
      {canExport ? (
        <Button variant="outline" size="sm" render={<a href={`/api/v1/contacts/${contactId}/export`} download />}>
          <DownloadIcon /> Export data
        </Button>
      ) : null}
      {canDelete ? (
        <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
          <DialogTrigger render={<Button variant="outline" size="sm" className="text-destructive hover:text-destructive" />}>
            <Trash2Icon /> Delete contact
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete {label}?</DialogTitle>
              <DialogDescription>
                Use this for erasure requests (GDPR, CCPA). The contact, their email, name and form submissions are permanently deleted, and their
                browsing history is anonymized. Their payments stay in your totals as unattributed revenue. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" disabled={pending} />}>Cancel</DialogClose>
              <Button variant="destructive" onClick={erase} disabled={pending}>
                {pending ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />} Delete permanently
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
