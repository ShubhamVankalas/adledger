"use client";

import { TINT, tintStyle } from "@/lib/avatar-tint";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

// Profile pictures and organization logos, with tinted initials when there's no image.
// The tint is derived from a stable seed (the id), so a person keeps the same colour everywhere.

type Size = "xs" | "sm" | "md" | "lg" | "xl" | "2xl";

const SIZES: Record<Size, string> = {
  xs: "size-5 text-[9px]",
  sm: "size-6 text-[10px]",
  md: "size-8 text-xs",
  lg: "size-10 text-sm",
  xl: "size-16 text-xl",
  "2xl": "size-20 text-2xl",
};

const SQUARE: Record<Size, string> = {
  xs: "rounded-[5px] after:rounded-[5px]",
  sm: "rounded-md after:rounded-md",
  md: "rounded-lg after:rounded-lg",
  lg: "rounded-lg after:rounded-lg",
  xl: "rounded-2xl after:rounded-2xl",
  "2xl": "rounded-2xl after:rounded-2xl",
};

/** "Demo Admin" → "DA", "acme" → "A", "jane.doe@x.com" → "JD". */
export function initialsOf(nameOrEmail: string) {
  const base =
    nameOrEmail.includes("@") && !nameOrEmail.includes(" ")
      ? nameOrEmail.split("@")[0]
      : nameOrEmail;
  const words = base
    .split(/[\s._-]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.length > 1 ? words[0][0] + words[1][0] : words[0][0];
  return letters.toUpperCase();
}

function Base({
  label,
  seed,
  src,
  size,
  square,
  className,
}: {
  label: string;
  seed: string;
  src?: string | null;
  size: Size;
  square?: boolean;
  className?: string;
}) {
  const shape = square ? SQUARE[size] : "rounded-full";
  return (
    <Avatar
      className={cn(
        SIZES[size],
        shape,
        "after:border-foreground/10 after:mix-blend-normal dark:after:mix-blend-normal",
        className,
      )}
    >
      {src ? <AvatarImage src={src} alt="" className={shape} /> : null}
      <AvatarFallback
        aria-hidden
        style={tintStyle(seed)}
        className={cn(
          TINT,
          shape,
          "font-semibold tracking-tight select-none",
          SIZES[size].split(" ")[1],
        )}
      >
        {initialsOf(label)}
      </AvatarFallback>
    </Avatar>
  );
}

/** A person's profile picture, or their initials. */
export function UserAvatar({
  id,
  name,
  email,
  src,
  size = "md",
  className,
}: {
  id?: string;
  name?: string | null;
  email: string;
  src?: string | null;
  size?: Size;
  className?: string;
}) {
  return (
    <Base
      label={name?.trim() || email}
      seed={id ?? email}
      src={src}
      size={size}
      className={className}
    />
  );
}

/** An organization (or workspace) logo, or its initials on a rounded square. */
export function OrgLogo({
  id,
  name,
  src,
  size = "md",
  className,
}: {
  id?: string;
  name: string;
  src?: string | null;
  size?: Size;
  className?: string;
}) {
  return (
    <Base
      label={name}
      seed={id ?? name}
      src={src}
      size={size}
      square
      className={className}
    />
  );
}
