"use client";

import { motion } from "motion/react";

import { Card } from "@/components/ui/card";
import { staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { CountUp } from "./money";

/**
 * Canvas KPI card (Overview): uppercase label → 28px value → one coloured trend
 * line → divider → up to two context lines. A numeric value counts up on first
 * view. Use inside a `stagger` motion parent to cascade a row of cards.
 */
export type KpiTrendTone = "success" | "warning" | "danger" | "neutral";

const TREND: Record<KpiTrendTone, string> = {
  success: "text-success-fg",
  warning: "text-warning-fg",
  danger: "text-danger-fg",
  neutral: "text-muted-foreground",
};

export function KpiCard({
  label,
  value,
  asMoney,
  trend,
  trendTone = "neutral",
  context = [],
  className,
}: {
  label: string;
  /** A number counts up; any other node renders as-is. */
  value: number | React.ReactNode;
  asMoney?: boolean;
  trend?: string;
  trendTone?: KpiTrendTone;
  context?: string[];
  className?: string;
}) {
  return (
    <motion.div variants={staggerItem} className={className}>
      <Card className="flex h-full flex-col gap-2 p-5">
        <span className="text-label uppercase text-muted-foreground">{label}</span>
        <span className="text-kpi text-foreground">
          {typeof value === "number" ? <CountUp value={value} asMoney={asMoney} /> : value}
        </span>
        {trend && <span className={cn("text-small", TREND[trendTone])}>{trend}</span>}
        {context.length > 0 && (
          <>
            <div className="my-1 h-px bg-divider" />
            {context.map((line) => (
              <span key={line} className="text-small text-muted-foreground">
                {line}
              </span>
            ))}
          </>
        )}
      </Card>
    </motion.div>
  );
}
