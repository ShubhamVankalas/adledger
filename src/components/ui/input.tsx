import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      // Emails, URLs and secrets are never prose: no red squiggles or auto-capitalised first letters.
      // Call sites can still override both.
      spellCheck={type === "email" || type === "url" || type === "password" ? false : undefined}
      autoCapitalize={type === "email" || type === "url" || type === "password" ? "none" : undefined}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-md border border-input bg-surface px-2.5 py-1 text-base transition-[color,border-color,box-shadow] duration-100 ease-out outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-ui file:font-medium file:text-foreground placeholder:text-fg-faint hover:border-[color-mix(in_oklch,var(--border-strong),var(--fg)_12%)] focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-fill disabled:opacity-60 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/15 md:text-ui dark:bg-fill/50 dark:aria-invalid:border-destructive/60 dark:aria-invalid:ring-destructive/30",
        className
      )}
      {...props}
    />
  )
}

export { Input }
