import type { Tone } from "@/components/ui/status-pill";

/**
 * Same 5 tones StatusPill paints with, as CSS color values a chart mark can
 * use directly (StatusPill only needs Tailwind classes, which a `style=`
 * fill can't consume) — so a status bar/segment always matches the color
 * its StatusPill uses elsewhere in the app.
 */
export const TONE_COLOR: Record<NonNullable<Tone>, string> = {
  slate: "var(--slate)",
  indigo: "var(--accent-2)",
  rose: "var(--rose)",
  blue: "var(--blue)",
  emerald: "var(--accent)",
};
