import type { CSSProperties } from "react";

// Hand-picked hues (oklch) that stay calm next to the brand green in both themes.
const HUES = [255, 285, 315, 350, 25, 60, 145, 190, 225];

function hueFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length];
}

/** Initials tint for any seed (contacts, members, orgs): readable in both themes. */
export function tintStyle(seed: string): CSSProperties {
  return { "--tint": hueFor(seed) } as CSSProperties;
}

export const TINT =
  "bg-[oklch(0.93_0.04_var(--tint))] text-[oklch(0.42_0.11_var(--tint))] dark:bg-[oklch(0.34_0.06_var(--tint))] dark:text-[oklch(0.9_0.06_var(--tint))]";
