import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

// 20px high, 4px radius, 11px medium. Colour only when it carries meaning (money, loss, warning).
const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-sm border border-transparent px-1.5 text-micro font-medium whitespace-nowrap tabular-nums transition-[color,background-color,border-color,box-shadow] duration-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-invalid:border-destructive [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-fill-active text-foreground [a]:hover:bg-fill-hover",
        secondary: "bg-fill text-muted-foreground [a]:hover:bg-fill-hover",
        destructive: "bg-negative-soft text-negative [a]:hover:bg-negative/15",
        outline: "border-border text-muted-foreground [a]:hover:bg-fill [a]:hover:text-foreground",
        ghost: "text-muted-foreground hover:bg-fill hover:text-foreground",
        link: "text-brand-foreground underline-offset-4 hover:underline",
        positive: "bg-positive-soft text-positive",
        warning: "bg-warning-soft text-warning-foreground",
        brand: "bg-brand-soft text-brand-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
