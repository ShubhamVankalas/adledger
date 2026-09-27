"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      // On phones, sit above the bottom tab bar (4rem) and the home indicator.
      mobileOffset={{ bottom: "calc(4.75rem + env(safe-area-inset-bottom))", left: "1rem", right: "1rem" }}
      icons={{
        success: (
          <CircleCheckIcon aria-hidden="true" className="size-4" />
        ),
        info: (
          <InfoIcon aria-hidden="true" className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon aria-hidden="true" className="size-4" />
        ),
        error: (
          <OctagonXIcon aria-hidden="true" className="size-4" />
        ),
        loading: (
          <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius-lg)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
