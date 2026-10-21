import * as React from "react"

import { cn } from "@/lib/utils"

// shadcn Input, restyled to the reference: 42px, radius 10, warm border,
// orange focus border + halo, red border when aria-invalid.
export const inputClass =
  "flex h-control w-full rounded-md border border-input bg-card px-3 text-body text-foreground transition-[border-color,box-shadow] duration-hover ease-out file:border-0 file:bg-transparent file:text-body file:font-medium placeholder:text-fg-placeholder focus-visible:outline-none focus-visible:border-ring focus-visible:shadow-focus disabled:cursor-not-allowed disabled:bg-muted disabled:text-fg-muted aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:shadow-[0_0_0_3px_rgb(var(--danger-soft))]"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return <input type={type} className={cn(inputClass, className)} ref={ref} {...props} />
  }
)
Input.displayName = "Input"

export { Input }
