"use client";

import { toast } from "sonner";
import type { ActionResult } from "@/lib/actions";

/**
 * Await a server action and report it: an error toast on failure; on success an optional toast
 * with an Undo button. Returns the result so callers can roll back optimistic state.
 */
export async function runAction(
  promise: Promise<ActionResult>,
  opts: { success?: string | false; undo?: (res: ActionResult) => Promise<ActionResult | void> | void; onUndone?: () => void } = {},
): Promise<ActionResult> {
  let res: ActionResult;
  try {
    res = await promise;
  } catch {
    res = { ok: false, message: "Couldn't reach the server. Check your connection and try again." };
  }
  if (!res.ok) {
    toast.error(res.message ?? "Something went wrong. Try again.");
    return res;
  }
  const message = opts.success === false ? null : (opts.success ?? res.message);
  if (message) {
    toast(message, {
      action: opts.undo
        ? {
            label: "Undo",
            onClick: () => {
              void Promise.resolve(opts.undo!(res)).then((u) => {
                if (u && !u.ok) toast.error(u.message ?? "Couldn't undo that.");
                else opts.onUndone?.();
              });
            },
          }
        : undefined,
    });
  }
  return res;
}
