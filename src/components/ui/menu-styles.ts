// One look for every floating list (dropdown menu, select, popover, command palette) and for native selects.
// Plain module so server and client components can both import it. Colours come from tokens only, so
// organization themes (which override --brand) and dark mode carry through.

/** Floating surface: 8px radius, hairline + soft shadow (--shadow-md), grows from its trigger. Scrolls inside the available height. */
export const menuPopup = [
  "z-50 max-h-[min(var(--available-height),24rem)] min-w-32 origin-(--transform-origin) overflow-x-hidden overflow-y-auto overscroll-contain rounded-lg bg-popover p-1 text-ui text-popover-foreground shadow-md outline-none",
  "duration-150 ease-out data-open:animate-in data-open:fade-in-0 data-open:zoom-in-96",
  "data-[side=bottom]:data-open:slide-in-from-top-1 data-[side=top]:data-open:slide-in-from-bottom-1 data-[side=left]:data-open:slide-in-from-right-1 data-[side=right]:data-open:slide-in-from-left-1",
  "data-closed:animate-out data-closed:overflow-hidden data-closed:fade-out-0 data-closed:zoom-out-96 data-closed:duration-100",
].join(" ");

/** Row layout shared by menu items, select options and checkbox / radio rows. */
export const menuItem =
  "relative flex min-h-7.5 w-full cursor-default items-center gap-2 rounded-md px-2 py-1 text-ui outline-hidden select-none transition-colors duration-75 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground";

/** Highlighted (hover / arrow-key) row: a soft brand wash, icons pick up the brand ink. */
export const menuItemActive =
  "focus:bg-brand/10 data-highlighted:bg-brand/10 focus:[&_svg:not([class*='text-'])]:text-brand-fg data-highlighted:[&_svg:not([class*='text-'])]:text-brand-fg";

/** Right-hand slot for the check on the selected option. */
export const menuIndicator = "pointer-events-none absolute right-2 flex size-4 items-center justify-center text-brand";

/** Small group heading inside a menu. */
export const menuLabel = "px-2 pt-1.5 pb-1 text-caption font-medium text-muted-foreground";

/** Native <select> control (the popup itself is drawn by the OS; this styles the closed control). Add height and text size per call site. */
export const nativeSelectField =
  "w-full appearance-none rounded-md border border-input bg-surface text-foreground outline-none transition-[color,background-color,border-color,box-shadow] duration-100 ease-out hover:border-[color-mix(in_oklch,var(--border-strong),var(--fg)_12%)] focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:bg-fill disabled:opacity-60 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/15 dark:bg-fill/50 [&>option]:bg-popover [&>option]:text-popover-foreground";
