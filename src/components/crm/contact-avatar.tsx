import { TINT, tintStyle } from "@/lib/avatar-tint";
import { cn } from "@/lib/utils";

const SIZES = {
  xs: "size-5 text-[9px]",
  sm: "size-6 text-[10px]",
  md: "size-8 text-[11px]",
  lg: "size-10 text-[13px]",
  xl: "size-12 text-base",
} as const;

export function contactInitials(name: string | null, email: string | null): string {
  const n = name?.trim();
  if (n) {
    const words = n.split(/\s+/).filter(Boolean);
    return ((words[0]?.[0] ?? "") + (words.length > 1 ? (words.at(-1)?.[0] ?? "") : "")).toUpperCase() || "?";
  }
  const local = email?.split("@")[0]?.replace(/[^a-z0-9]/gi, "") ?? "";
  return local.slice(0, 2).toUpperCase() || "?";
}

/** Tinted initials for a contact; the tint follows the contact id, so it matches everywhere. */
export function ContactAvatar({
  id,
  name,
  email,
  size = "md",
  className,
}: {
  id: string;
  name: string | null;
  email: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      style={tintStyle(id)}
      className={cn("flex shrink-0 items-center justify-center rounded-full font-semibold tracking-tight select-none", TINT, SIZES[size], className)}
    >
      {contactInitials(name, email)}
    </span>
  );
}
