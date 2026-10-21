"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

/**
 * The Taggify illustration kit (ux/assets/Taggify Illustration Kit Asset
 * Sheet.png, cut into client-v2/public/illustrations/). Decorative: always
 * alt="" and aria-hidden. Where each one goes is listed in
 * public/illustrations/README.md — use the matching name, don't improvise.
 * Each has a `-dark.png` twin (slate backdrop, mint accents) swapped in by CSS
 * on `data-theme`, like the wordmark, so it never flashes.
 * If a file ever fails to load, nothing renders (no broken image).
 */
export type IllustrationName =
  // People / roles
  | "creator-01"
  | "planner-01"
  | "admin-01"
  | "finance-01"
  | "team-01"
  | "analytics-01"
  | "partnership-01"
  | "onboarding-01"
  // Creator pages
  | "page-food"
  | "page-travel"
  | "page-lifestyle"
  // States
  | "empty-plans"
  | "empty-campaigns"
  | "empty-content"
  | "empty-dues"
  | "empty-search"
  | "payout-success"
  | "payout-processing"
  | "error-state"
  // Brand moments
  | "sidebar-illustration"
  | "header-ribbon";

export function Illustration({ name, className }: { name: IllustrationName; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  const cls = cn("select-none object-contain", className);
  // The theme swap lives on display:contents wrappers so callers' own display classes (`hidden sm:block`) still apply.
  return (
    <>
      <span className="contents dark:hidden">
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand art; next/image adds nothing for a decorative PNG */}
        <img src={`/illustrations/${name}.png`} alt="" aria-hidden className={cls} onError={() => setFailed(true)} draggable={false} />
      </span>
      <span className="hidden dark:contents">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/illustrations/${name}-dark.png`} alt="" aria-hidden className={cls} onError={() => setFailed(true)} draggable={false} />
      </span>
    </>
  );
}

/** Illustration + one line of copy (+ optional action) for empty, error and "nothing matches" states. */
export function EmptyState({ name, title, children, className }: { name: IllustrationName; title: string; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-2 px-5 py-10 text-center", className)}>
      <Illustration name={name} className="h-28 w-auto" />
      <p className="text-body-strong text-foreground">{title}</p>
      {children && <div className="max-w-md text-small text-muted-foreground">{children}</div>}
    </div>
  );
}
