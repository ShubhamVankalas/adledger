import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

// Quiet Ledger buttons: 28 (toolbar, table) · 32 (default) · 36 (forms, dialogs); 6px radius; ink primary.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-ui font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,opacity,scale] duration-100 ease-out outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:not-aria-[haspopup]:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/88 aria-expanded:bg-primary/88",
        outline:
          "border-border bg-surface text-foreground hover:border-border-strong hover:bg-fill aria-expanded:border-border-strong aria-expanded:bg-fill",
        secondary:
          "bg-fill text-foreground hover:bg-fill-hover aria-expanded:bg-fill-hover",
        ghost:
          "text-foreground hover:bg-fill-hover aria-expanded:bg-fill-hover",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/16 focus-visible:outline-destructive/50 dark:bg-destructive/16 dark:hover:bg-destructive/24",
        link: "text-brand-foreground underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-6 gap-1 rounded-sm px-2 text-caption has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-2 px-3.5 text-body has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-sm [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm":
          "size-7 [&_svg:not([class*='size-'])]:size-4",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      // Links rendered as buttons (render={<Link />}) aren't native <button>s.
      nativeButton={props.render ? false : undefined}
      {...props}
    />
  )
}

export { Button, buttonVariants }
