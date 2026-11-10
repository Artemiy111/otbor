import { cva, type VariantProps } from "class-variance-authority"

export const alertVariants = cva(
  "relative w-full rounded-lg border px-4 py-3 text-sm [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:size-4 [&>svg~*]:pl-7",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        destructive: "border-danger/30 bg-danger-muted text-foreground [&>svg]:text-danger",
        warning: "border-warning/30 bg-warning-muted text-foreground [&>svg]:text-warning",
        info: "border-info/30 bg-info-muted text-foreground [&>svg]:text-info"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
)

export type AlertVariants = VariantProps<typeof alertVariants>
