import type { ReactNode } from "react";

import { AlertIcon, CheckCircleIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

/** Inline callout from the mockup (`.note` / `.note.info`). */
export function Note({ tone = "warn", children, className, action }: { tone?: "warn" | "info" | "ok"; children: ReactNode; className?: string; action?: ReactNode }) {
  const Icon = tone === "ok" ? CheckCircleIcon : AlertIcon;
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-[10px] border px-3.5 py-[11px] text-[0.8125rem]",
        tone === "warn" && "border-accent-2-line bg-accent-2-soft text-[#78350f] dark:text-accent-2",
        tone === "info" && "border-blue-line bg-blue-soft text-[#1e3a8a] dark:text-blue",
        tone === "ok" && "border-accent-line bg-accent-soft text-[#14532d] dark:text-accent",
        className
      )}
    >
      <Icon className="mt-px h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}
