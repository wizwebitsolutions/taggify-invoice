"use client";

import { motion } from "motion/react";

import { pipelineFill } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** Canvas campaign stages (Overview "Campaign pulse" columns). */
export const CAMPAIGN_STAGES = ["Booked", "Posted", "Verified", "Invoiced", "Paid"] as const;
/** Canvas login panel stages. */
export const PLAN_STAGES = ["Plan", "Approved", "Published", "Verified", "Invoiced", "Paid"] as const;

/**
 * The campaign pulse (§32): 16px nodes on a thin line. Nodes before `reached`
 * are filled violet and their connecting line is lavender; the rest are rings
 * on a grey line. Nodes fill in left to right on first render.
 *
 * - `counts`: optional number under each node (the Overview matrix).
 * - `orientation="vertical"`: the login panel style, uppercase labels beside nodes.
 */
export function Pipeline({
  stages = CAMPAIGN_STAGES,
  reached,
  counts,
  orientation = "horizontal",
  showLabels = true,
  className,
}: {
  stages?: readonly string[];
  /** How many stages are reached (0 = none, stages.length = all). */
  reached: number;
  counts?: number[];
  orientation?: "horizontal" | "vertical";
  showLabels?: boolean;
  className?: string;
}) {
  const vertical = orientation === "vertical";

  return (
    <motion.ol initial="hidden" animate="show" aria-label="Progress" className={cn("flex", vertical ? "flex-col" : "w-full", className)}>
      {stages.map((label, i) => {
        const done = i < reached;
        const status = done ? "reached" : i === reached ? "next" : "upcoming";
        return (
          <li
            key={label}
            aria-current={i === reached - 1 ? "step" : undefined}
            className={cn("relative flex", vertical ? "flex-col" : "flex-1 flex-col items-center gap-2")}
          >
            {vertical ? (
              <>
                <span className={cn("flex items-center gap-4 text-small font-semibold uppercase tracking-[0.08em]", done ? "text-sidebar-fg-active" : "text-fg-muted")}>
                  <motion.span
                    custom={i}
                    variants={pipelineFill}
                    className={cn("block h-3 w-3 rounded-pill border-2", done ? "border-primary bg-primary" : "border-fg-strong bg-sidebar")}
                  />
                  {label}
                </span>
                {i < stages.length - 1 && (
                  <span aria-hidden className={cn("ml-[5px] h-9 w-0.5", i < reached - 1 ? "bg-primary" : "bg-neutral-800")} />
                )}
              </>
            ) : (
              <>
                {/* connector into this node from the previous one */}
                {i > 0 && (
                  <span aria-hidden className={cn("absolute right-1/2 top-[7px] h-0.5 w-full", done ? "bg-brand-300" : "bg-border")} />
                )}
                <motion.span
                  custom={i}
                  variants={pipelineFill}
                  className={cn("relative block h-4 w-4 rounded-pill border-2", done ? "border-primary bg-primary" : "border-input bg-card")}
                />
                {counts && (
                  <span className={cn("num text-small font-semibold", done ? "text-foreground" : "text-fg-muted")}>{counts[i] ?? 0}</span>
                )}
                {showLabels && <span className={cn("text-caption", done ? "text-foreground" : "text-fg-muted")}>{label}</span>}
              </>
            )}
            <span className="sr-only">{` (${status})`}</span>
          </li>
        );
      })}
    </motion.ol>
  );
}
