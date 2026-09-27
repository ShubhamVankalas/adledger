"use client";

import { CheckIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Password input with show/hide and, for new passwords, a quiet live length check. The full
 * policy (common passwords, repeats, your own email) is enforced on the server.
 */
export function PasswordField({
  id,
  name,
  label,
  autoComplete,
  minLength,
  hint,
  strength,
  className,
}: {
  id: string;
  name: string;
  label: string;
  autoComplete: "current-password" | "new-password";
  minLength?: number;
  hint?: string;
  strength?: { minLength: number; email?: string; name?: string };
  className?: string;
}) {
  const [show, setShow] = useState(false);
  const [value, setValue] = useState("");
  const length = [...value.normalize("NFKC")].length;
  const short = strength ? Math.max(0, strength.minLength - length) : 0;
  const describedBy = strength && value ? `${id}-meter` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          name={name}
          type={show ? "text" : "password"}
          autoComplete={autoComplete}
          required
          minLength={minLength}
          maxLength={200}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-describedby={describedBy}
          className="pr-11"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? "Hide password" : "Show password"}
          aria-pressed={show}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {show ? <EyeOffIcon aria-hidden className="size-4" /> : <EyeIcon aria-hidden className="size-4" />}
        </button>
      </div>
      {strength && value ? (
        <div id={`${id}-meter`} className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
          <span aria-hidden className="h-1 w-24 overflow-hidden rounded-full bg-muted">
            <span
              className={cn("block h-full rounded-full transition-[width] duration-200", short ? "bg-muted-foreground/60" : "bg-foreground")}
              style={{ width: `${Math.min(100, (length / strength.minLength) * 100)}%` }}
            />
          </span>
          {short ? (
            <span className="tabular-nums">
              {short} more character{short === 1 ? "" : "s"}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-foreground">
              <CheckIcon aria-hidden className="size-3.5" /> Long enough
            </span>
          )}
        </div>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-pretty text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
