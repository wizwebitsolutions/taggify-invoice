"use client"

import { Toaster as Sonner } from "sonner"

import { useTheme } from "@/lib/theme"

type ToasterProps = React.ComponentProps<typeof Sonner>

// shadcn's Sonner wrapper, using our ThemeProvider instead of next-themes.
const Toaster = ({ ...props }: ToasterProps) => {
  const { resolved } = useTheme()

  return (
    <Sonner
      theme={resolved}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:rounded-card group-[.toaster]:border-border group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground group-[.toaster]:shadow-3 group-[.toaster]:font-sans",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
