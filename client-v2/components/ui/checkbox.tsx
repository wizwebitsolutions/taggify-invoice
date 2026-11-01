"use client"

import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { Check, Minus } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Taggify checkbox (21 Oct, "make it modern"): a 1px edge on a soft shadow,
 * an orange tint on hover, a small press, and a tick that pops in. Checked
 * and indeterminate fill with the brand colour. Tokens only (radius-xs is the
 * checkbox radius; control-line the idle edge).
 */
const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "peer grid h-5 w-5 shrink-0 place-content-center rounded-xs border border-control-line bg-card shadow-1 transition-[background-color,border-color,box-shadow,transform] duration-hover ease-out",
      "hover:border-brand hover:bg-brand-50 active:scale-90",
      "focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-ring-soft",
      "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-control-line disabled:hover:bg-card disabled:active:scale-100",
      "data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=checked]:text-brand-foreground data-[state=checked]:shadow-2 data-[state=checked]:hover:bg-brand-hover",
      "data-[state=indeterminate]:border-brand data-[state=indeterminate]:bg-brand data-[state=indeterminate]:text-brand-foreground data-[state=indeterminate]:shadow-2 data-[state=indeterminate]:hover:bg-brand-hover",
      className
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="grid place-content-center text-current animate-in fade-in-0 zoom-in-50 duration-micro">
      {props.checked === "indeterminate" ? <Minus className="h-3.5 w-3.5" strokeWidth={2.5} /> : <Check className="h-3.5 w-3.5" strokeWidth={2.5} />}
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
))
Checkbox.displayName = CheckboxPrimitive.Root.displayName

export { Checkbox }
