import { ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { nativeSelectField } from "./ui/menu-styles";

/** Styled native <select>: accessible, works in forms without JS. 40px (and 16px text, so iOS doesn't zoom) below md. */
export function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className={cn("relative", className)}>
      <select
        className={cn(nativeSelectField, "h-10 px-3 pr-8 text-base md:h-9 md:text-sm")}
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-fg-faint" />
    </div>
  );
}
