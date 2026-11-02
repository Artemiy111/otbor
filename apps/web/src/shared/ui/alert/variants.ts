import { cva, type VariantProps } from "class-variance-authority"

export const alertVariants = cva(
  "relative w-full rounded-lg border px-4 py-3 text-sm [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:size-4 [&>svg~*]:pl-7",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        destructive: "border-red-500/30 bg-red-500/10 text-red-200 [&>svg]:text-red-300",
        warning: "border-amber-500/30 bg-amber-500/10 text-amber-100 [&>svg]:text-amber-300",
        info: "border-sky-500/30 bg-sky-500/10 text-sky-100 [&>svg]:text-sky-300"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
)

export type AlertVariants = VariantProps<typeof alertVariants>
