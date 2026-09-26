"use client";

import { Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/actions";

/** A button that runs a server action and toasts the result. */
export function ActionButton({
  action,
  children,
  confirm,
  onDone,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "onClick" | "action"> & {
  action: () => Promise<ActionResult>;
  confirm?: string;
  onDone?: (r: ActionResult) => void;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      {...props}
      disabled={pending || props.disabled}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        start(async () => {
          const r = await action();
          if (r.ok) toast.success(r.message ?? "Done");
          else toast.error(r.message ?? "Something went wrong");
          onDone?.(r);
          router.refresh();
        });
      }}
    >
      {pending ? <Loader2Icon className="animate-spin" /> : null}
      {children}
    </Button>
  );
}

export function useFormAction(action: (f: FormData) => Promise<ActionResult>, onDone?: (r: ActionResult) => void) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const submit = (form: FormData) =>
    start(async () => {
      const r = await action(form);
      if (r.ok) toast.success(r.message ?? "Saved");
      else toast.error(r.message ?? "Something went wrong");
      onDone?.(r);
      router.refresh();
    });
  return { pending, submit };
}
