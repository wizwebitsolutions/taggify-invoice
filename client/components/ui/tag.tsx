import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type TagTone = "ok" | "wait" | "bad" | "info" | "neutral";

const TONE: Record<TagTone, string> = {
  ok: "border-accent-line bg-accent-soft text-accent",
  wait: "border-accent-2-line bg-accent-2-soft text-accent-2",
  bad: "border-rose-line bg-rose-soft text-rose",
  info: "border-blue-line bg-blue-soft text-blue",
  neutral: "border-border bg-surface-2 text-text-2",
};

/** Generic status tag (mockup `.tag`): 22px, 6px radius, dot + label. For
 * Prisma-enum statuses use StatusPill; this is for ad-hoc labels
 * ("Live", "Waiting 3d", "Will be created"). */
export function Tag({ tone = "neutral", dot = true, children, className, testId }: { tone?: TagTone; dot?: boolean; children: ReactNode; className?: string; testId?: string }) {
  return (
    <span data-testid={testId} className={cn("inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-[6px] border px-2 text-[0.7rem] font-medium leading-none", TONE[tone], className)}>
      {dot && <i className="inline-block h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
