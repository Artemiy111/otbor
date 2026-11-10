import { cva, type VariantProps } from "class-variance-authority"

export const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border text-foreground",
        danger: "border-danger/30 bg-danger-muted text-danger",
        /** Псевдоним danger: старые вызовы с variant="destructive". */
        destructive: "border-danger/30 bg-danger-muted text-danger",
        success: "border-success/30 bg-success-muted text-success",
        info: "border-info/30 bg-info-muted text-info",
        warning: "border-warning/30 bg-warning-muted text-warning",
        neutral: "border-border bg-muted text-muted-foreground"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
)

export type BadgeVariants = VariantProps<typeof badgeVariants>
