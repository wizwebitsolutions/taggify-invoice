"use client";

import type { LucideIcon } from "lucide-react";
import { motion } from "motion/react";

import { cn } from "@/lib/utils";
import { ApiError, type BulkRowStatus, type BulkSheetSource } from "@/lib/api-client";
import { EASE_OUT } from "@/lib/motion";
import { inputClass } from "@/components/ui/input";

/**
 * Shared bits for the Bulk Tracker screen, ported one-for-one from v1
 * (client/components/bulk-track/shared.tsx): the same StatChip, MetricCell,
 * status pills and entrance motion, painted with the Taggify tokens. v1's
 * blue → info, accent (done) → success, amber (running/queued) → warning,
 * rose → danger, slate → status-neutral.
 */

/** Card/section entrance: fade + 10px rise, staggered by index (v1 fadeRise). */
export function fadeRise(index = 0, staggerMs = 80) {
  return {
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.5, ease: EASE_OUT, delay: (index * staggerMs) / 1000 },
  };
}

/** v1's uppercase micro label (table headers, field labels). */
export const MICRO = "text-th uppercase text-muted-foreground";

/** v1's FIELD: the textarea / input look on the screen's cards. */
export const FIELD = cn(inputClass, "h-auto bg-muted py-2 text-small");

export const CARD = "rounded-card border bg-card shadow-1";

// Literal class strings (Tailwind's scanner must see each one verbatim).
export const TONES = {
  blue: { soft: "bg-info-soft", text: "text-info-fg", line: "border-info" },
  accent: { soft: "bg-success-soft", text: "text-success-fg", line: "border-success" },
  amber: { soft: "bg-warning-soft", text: "text-warning-fg", line: "border-warning" },
  rose: { soft: "bg-danger-soft", text: "text-danger-fg", line: "border-danger" },
  slate: { soft: "bg-status-neutral-soft", text: "text-status-neutral-fg", line: "border-status-neutral" },
} as const;
export type Tone = keyof typeof TONES;

const STATUS_TONE: Record<string, string> = {
  queued: `${TONES.amber.text} ${TONES.amber.soft} ${TONES.amber.line}`,
  running: `${TONES.amber.text} ${TONES.amber.soft} ${TONES.amber.line}`,
  done: `${TONES.accent.text} ${TONES.accent.soft} ${TONES.accent.line}`,
  failed: `${TONES.rose.text} ${TONES.rose.soft} ${TONES.rose.line}`,
  broken: `${TONES.rose.text} ${TONES.rose.soft} border-dashed border-danger`,
  not_fetched: "text-muted-foreground bg-muted border-border",
};

export const STATUS_LABEL: Record<BulkRowStatus, string> = {
  queued: "Queued",
  done: "Done",
  failed: "Failed",
  broken: "Broken link",
  not_fetched: "Not fetched",
};

/** Status pill: batch (running/done) or row (queued/done/failed/broken/not_fetched). */
export function StatusPill({ status, label, size = "sm" }: { status: string; label?: string; size?: "sm" | "md" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-pill border font-semibold capitalize",
        size === "md" ? "px-2.5 py-1 text-micro" : "px-2 py-0.5 text-micro",
        STATUS_TONE[status] ?? "border-border bg-muted text-muted-foreground"
      )}
    >
      {label ?? status.replace(/_/g, " ")}
    </span>
  );
}

/** Stat tile: icon badge + label + value (v1 StatChip). */
export function StatChip({ icon: Icon, label, value, index = 0, tone }: { icon: LucideIcon; label: string; value: string; index?: number; tone: Tone }) {
  const t = TONES[tone];
  return (
    <motion.div
      {...fadeRise(index)}
      whileHover={{ y: -2 }}
      className={cn(CARD, "flex items-center gap-3.5 px-5 py-4 transition-colors hover:border-input")}
      data-testid={`bulk-stat-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <motion.div
        initial={{ scale: 0.4, rotate: -8, opacity: 0 }}
        animate={{ scale: 1, rotate: 0, opacity: 1 }}
        transition={{ duration: 0.45, delay: (index * 80) / 1000 + 0.05, ease: [0.34, 1.56, 0.64, 1] }}
        whileHover={{ scale: 1.12, rotate: 4 }}
        className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-md", t.soft)}
      >
        <Icon className={cn("h-4 w-4", t.text)} strokeWidth={2.1} />
      </motion.div>
      <div className="min-w-0">
        <p className="truncate text-caption text-muted-foreground">{label}</p>
        <p className="num mt-0.5 text-card-title font-bold text-foreground">{value}</p>
      </div>
    </motion.div>
  );
}

/** One cell of the 6-cell metric strip on a post card (v1 MetricCell). */
export function MetricCell({ icon: Icon, value, label, tone }: { icon: LucideIcon; value: string; label: string; tone: Tone }) {
  const t = TONES[tone];
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5 rounded-md px-3.5 py-3", t.soft)}>
      <div className="grid h-6 w-6 place-items-center rounded-sm bg-card">
        <Icon className={cn("h-3.5 w-3.5", t.text)} strokeWidth={2.25} />
      </div>
      <p className={cn("num truncate text-body-strong font-bold", t.text)}>{value}</p>
      <p className="truncate text-micro uppercase text-muted-foreground">{label}</p>
    </div>
  );
}

export function errorMessage(err: unknown, fallback: string) {
  return err instanceof ApiError && err.message ? err.message : fallback;
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function timeAgo(iso: string) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

/** One link per line, blanks dropped (v1 parseLines). */
export function parseLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

export function sheetSourceLabel(s: Pick<BulkSheetSource, "name" | "sheetUrl">): string {
  return s.name?.trim() || s.sheetUrl;
}
