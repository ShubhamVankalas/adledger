"use client";

import { CircleAlertIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// Shared bits for the sign-in, setup and invite forms: roomy controls (44px on phones, 40px+ everywhere).
export const authInput = "h-11 sm:h-10 lg:h-11";
export const authButton = "h-11 w-full text-[0.95rem] sm:text-sm";

/** aria-describedby for a field rendered in AuthField: its error when there is one, else its hint. */
export const describedBy = (id: string, error?: string, hint?: boolean) => (error ? `${id}-error` : hint ? `${id}-hint` : undefined);

/** After a failed submit, move focus to the first invalid field so keyboard and screen-reader users land on the problem. */
export function useFocusFirstError(form: React.RefObject<HTMLFormElement | null>, state: unknown) {
  useEffect(() => {
    if (state) form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [form, state]);
}

export function AuthField({ label, error, hint, htmlFor, children }: { label: string; error?: string; hint?: React.ReactNode; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor} className="text-ui font-medium">
        {label}
      </Label>
      {children}
      {error ? (
        <p id={htmlFor ? `${htmlFor}-error` : undefined} className="flex items-start gap-1.5 text-caption text-destructive">
          <CircleAlertIcon aria-hidden className="mt-px size-3.5 shrink-0" />
          {error}
        </p>
      ) : hint ? (
        <p id={htmlFor ? `${htmlFor}-hint` : undefined} className="text-caption text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function PasswordInput({ className, ...props }: Omit<React.ComponentProps<typeof Input>, "type">) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={show ? "text" : "password"} className={cn(authInput, "pr-11", className)} />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        aria-pressed={show}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-fg-faint transition-colors outline-none hover:text-foreground focus-visible:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 sm:w-10 lg:w-11"
      >
        {show ? <EyeOffIcon aria-hidden className="size-4" /> : <EyeIcon aria-hidden className="size-4" />}
      </button>
    </div>
  );
}

export function FormError({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-ui text-destructive">
      <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
