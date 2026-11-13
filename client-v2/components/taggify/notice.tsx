import type { HTMLAttributes, ReactNode } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

export type NoticeTone = "warning" | "danger" | "info" | "success";

/** The lit dot: the tone at full strength with a soft ring of the same colour. */
const DOT: Record<NoticeTone, string> = {
  warning: "bg-warning ring-warning/25",
  danger: "bg-danger ring-danger/25",
  info: "bg-info ring-info/25",
  success: "bg-success ring-success/25",
};

const HALO: Record<NoticeTone, string> = { warning: "bg-warning", danger: "bg-danger", info: "bg-info", success: "bg-success" };

/**
 * The app's one notice (13 Nov, approved "capsule" mockup): a slim raised pill
 * with a lit dot in the tone's colour, the message in the normal text colour
 * (bold the part that matters with <strong>), an optional action and an
 * optional dismiss. Replaces the tinted warning / error / info boxes that each
 * screen used to style by hand. One line reads as a pill; longer text wraps
 * into a softly rounded box. It is as wide as its text, never wider than its
 * container.
 *
 * `role` defaults to "alert" for danger and "status" for the rest.
 */
export function Notice({
  tone = "warning",
  action,
  onDismiss,
  className,
  children,
  role,
  ...rest
}: {
  tone?: NoticeTone;
  /** A button or link shown after the message (use size="sm"). */
  action?: ReactNode;
  onDismiss?: () => void;
} & HTMLAttributes<HTMLDivElement>) {
  const trailing = !!action || !!onDismiss;
  return (
    <div
      role={role ?? (tone === "danger" ? "alert" : "status")}
      className={cn("flex w-fit max-w-full items-start gap-3 rounded-2xl border border-input bg-surface-elevated py-1.5 pl-4 text-small text-foreground shadow-2", trailing ? "pr-2" : "pr-4", className)}
      {...rest}
    >
      {/* As tall as one line of the message (and a small button), so the dot sits on the first line. */}
      <span aria-hidden className="flex h-control-sm shrink-0 items-center">
        {/* Twinkle: the dot swells slightly while a halo of the same colour spreads and fades. Still for reduced-motion users. */}
        <span className="relative flex h-2.5 w-2.5">
          <span className={cn("absolute inset-0 rounded-pill opacity-0 motion-safe:animate-notice-halo", HALO[tone])} />
          <span className={cn("relative h-2.5 w-2.5 rounded-pill ring-4 motion-safe:animate-notice-twinkle", DOT[tone])} />
        </span>
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1 py-1.5 [&_strong]:font-semibold">{children}</div>
      {action && <span className="flex shrink-0 items-center gap-2">{action}</span>}
      {onDismiss && (
        <button type="button" aria-label="Dismiss" onClick={onDismiss} className="flex h-control-sm w-8 shrink-0 items-center justify-center rounded-pill text-fg-muted hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-ring-soft">
          <X className="h-4 w-4" aria-hidden />
        </button>
      )}
    </div>
  );
}
