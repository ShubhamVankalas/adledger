/**
 * Control sizing for settings containers (the settings content column and settings dialogs).
 * - Below md: every button, input and select gets a 40px touch height.
 * - From md: inputs match the 36px native selects, so labelled fields line up in a row.
 */
export const TOUCH_TARGETS =
  "max-md:[&_[data-slot=button]]:min-h-10 max-md:[&_[data-slot=button]]:min-w-10 max-md:[&_[data-slot=input]]:h-10 max-md:[&_select]:h-10 md:[&_[data-slot=input]]:h-9";
