import { ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Styled native <select>: accessible, works in forms without JS. 40px (and 16px text, so iOS doesn't zoom) below md. */
export function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className={cn("relative", className)}>
      <select
        className="h-10 w-full appearance-none rounded-lg border border-input bg-background px-3 pr-8 text-base text-foreground shadow-xs md:h-9 md:text-sm outline-none transition-[color,border-color,box-shadow] hover:border-ring/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30 [&>option]:bg-popover [&>option]:text-popover-foreground"
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}
