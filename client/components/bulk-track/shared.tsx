"use client";

import type { LucideIcon } from "lucide-react";
import { motion } from "framer-motion";

import { cn } from "@/lib/utils";
import { ApiError, type BulkRowStatus } from "@/lib/api-client";

/**
 * Shared bits for the Bulk Tracker screen (12 Oct) — ported from
 * affiliate-creator-tool's Taggify components (StatChip, MetricCell,
 * motion.ts, status pills) with the same structure, re-coloured to this
 * app's tokens: their money-blue → blue, mint (done) → accent, amber
 * (running/queued) → accent-2, red → rose, dim → slate.
 */

export const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** Card/section entrance: fade + 10px rise, staggered by index — the source's fadeRise. */
export function fadeRise(index = 0, staggerMs = 80) {
  return {
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.5, ease: EASE_OUT_EXPO, delay: (index * staggerMs) / 1000 },
  };
}

/** The source's `.tg-micro` label — this app's uppercase table-header style. */
export const MICRO = "text-[0.68rem] font-medium uppercase tracking-[0.06em] text-text-faint";

export const FIELD =
  "w-full rounded-md border border-border bg-surface-2 px-3 py-2.5 text-xs text-text placeholder:text-text-faint focus:border-border-strong focus:outline-none";

export const CARD = "rounded-lg border border-border bg-surface shadow-card";

// Literal class strings (Tailwind's scanner must see each one verbatim).
export const TONES = {
  blue: { soft: "bg-blue-soft", text: "text-blue", line: "border-blue-line" },
  accent: { soft: "bg-accent-soft", text: "text-accent", line: "border-accent-line" },
  amber: { soft: "bg-accent-2-soft", text: "text-accent-2", line: "border-accent-2-line" },
  rose: { soft: "bg-rose-soft", text: "text-rose", line: "border-rose-line" },
  slate: { soft: "bg-slate-soft", text: "text-slate", line: "border-slate-line" },
} as const;
export type Tone = keyof typeof TONES;

const STATUS_TONE: Record<string, string> = {
  queued: `${TONES.amber.text} ${TONES.amber.soft} ${TONES.amber.line}`,
  running: `${TONES.amber.text} ${TONES.amber.soft} ${TONES.amber.line}`,
  done: `${TONES.accent.text} ${TONES.accent.soft} ${TONES.accent.line}`,
  failed: `${TONES.rose.text} ${TONES.rose.soft} ${TONES.rose.line}`,
  broken: `${TONES.rose.text} ${TONES.rose.soft} border-dashed border-rose`,
  not_fetched: "text-text-muted bg-surface-2 border-border",
};

export const STATUS_LABEL: Record<BulkRowStatus, string> = {
  queued: "Queued",
  done: "Done",
  failed: "Failed",
  broken: "Broken link",
  not_fetched: "Not fetched",
};

/** Status pill — batch (running/done) or row (queued/done/failed/broken/not_fetched). */
export function StatusPill({ status, label, size = "sm" }: { status: string; label?: string; size?: "sm" | "md" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border font-semibold capitalize",
        size === "md" ? "px-2.5 py-1 text-[11px]" : "px-2 py-0.5 text-[10px]",
        STATUS_TONE[status] ?? "text-text-muted bg-surface-2 border-border"
      )}
    >
      {label ?? status.replace(/_/g, " ")}
    </span>
  );
}

/** Stat tile — icon badge + label + value (the source's StatChip). */
export function StatChip({ icon: Icon, label, value, index = 0, tone }: { icon: LucideIcon; label: string; value: string; index?: number; tone: Tone }) {
  const t = TONES[tone];
  return (
    <motion.div
      {...fadeRise(index)}
      whileHover={{ y: -2 }}
      className={cn(CARD, "flex items-center gap-3.5 px-5 py-4 transition-colors hover:border-border-strong")}
      data-testid={`bulk-stat-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <motion.div
        initial={{ scale: 0.4, rotate: -8, opacity: 0 }}
        animate={{ scale: 1, rotate: 0, opacity: 1 }}
        transition={{ duration: 0.45, delay: (index * 80) / 1000 + 0.05, ease: [0.34, 1.56, 0.64, 1] }}
        whileHover={{ scale: 1.12, rotate: 4 }}
        className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-md", t.soft)}
      >
        <Icon size={17} className={t.text} strokeWidth={2.1} />
      </motion.div>
      <div className="min-w-0">
        <p className="truncate text-xs text-text-muted">{label}</p>
        <p className="mt-0.5 text-[15px] font-bold tabular-nums text-text">{value}</p>
      </div>
    </motion.div>
  );
}

/** One cell of the 6-cell metric strip on a post card (the source's MetricCell). */
export function MetricCell({ icon: Icon, value, label, tone }: { icon: LucideIcon; value: string; label: string; tone: Tone }) {
  const t = TONES[tone];
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5 rounded-md px-3.5 py-3", t.soft)}>
      <div className="grid h-6 w-6 place-items-center rounded-[7px] bg-surface">
        <Icon size={13} className={t.text} strokeWidth={2.25} />
      </div>
      <p className={cn("truncate text-sm font-bold tabular-nums", t.text)}>{value}</p>
      <p className="truncate text-[9px] uppercase tracking-[0.08em] text-text-faint">{label}</p>
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

/** One link per line, blanks dropped — the source's parseLines. */
export function parseLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}
