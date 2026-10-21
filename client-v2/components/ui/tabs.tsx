"use client"

import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"

// shadcn Tabs, restyled to the reference: text tabs on a hairline, the active
// tab turns orange with a 3px orange underline ("Dues (5)  Paid (1) …").
// Radix handles arrows/Home/End and ARIA.
const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn("flex max-w-full items-end gap-8 overflow-x-auto border-b border-input text-fg-strong [scrollbar-width:none]", className)}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "-mb-px inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-3 border-transparent px-2 pb-3 pt-2 text-body font-medium transition-colors duration-micro ease-out hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring-soft disabled:pointer-events-none disabled:opacity-50 data-[state=active]:border-brand data-[state=active]:font-semibold data-[state=active]:text-brand-ink",
      className
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-4 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring-soft data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:duration-page",
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
