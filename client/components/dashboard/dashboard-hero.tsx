import type { ReactNode } from "react";

/**
 * The ambient hero band both dashboards open with, replacing a plain
 * eyebrow+h1+subtitle stack. The dual-glow background reuses the exact
 * accent/accent-2 radial-gradient recipe components/layout/ambient-glow.tsx
 * already paints behind every page — same colors, same opacities — so this
 * reads as "the same product, a bigger moment" rather than a new palette.
 * Static (no pause-on-hidden-tab handling like AmbientGlow's blobs) since
 * these glows don't animate.
 */
export function DashboardHero({
  eyebrow,
  title,
  subtitle,
  stat,
}: {
  eyebrow: string;
  /** The heading content — callers wrap the word(s) that should pick up the
   * accent color in a <span className="text-accent"> themselves, since which
   * word (if any) makes sense to accent depends on the real copy. */
  title: ReactNode;
  subtitle: string;
  /** Right-aligned headline stat — omit if there's no single number that
   * summarizes this page as well as the KPI row below it already will. */
  stat?: { value: string; label: string };
}) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-border p-8 [background:linear-gradient(180deg,var(--surface-2),var(--bg)_130%)]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-16 -top-28 h-[300px] w-[300px] rounded-full opacity-30 blur-[60px] [background:radial-gradient(circle,var(--accent)_0%,transparent_72%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-32 -right-10 h-[260px] w-[260px] rounded-full opacity-25 blur-[60px] [background:radial-gradient(circle,var(--accent-2)_0%,transparent_72%)]"
      />
      <div className="relative flex items-end justify-between gap-6">
        <div>
          <p className="mb-2 text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-text-faint">{eyebrow}</p>
          <h1 className="mb-2 text-[1.75rem] font-extrabold leading-[1.1] tracking-tight md:text-[2rem]">{title}</h1>
          <p className="max-w-[52ch] text-[0.9375rem] text-text-muted">{subtitle}</p>
        </div>
        {stat && (
          <div className="hidden shrink-0 text-right sm:block">
            <div className="text-[2.25rem] font-extrabold leading-none tabular-nums">{stat.value}</div>
            <div className="mt-1.5 text-[0.6875rem] font-bold uppercase tracking-[0.06em] text-text-faint">{stat.label}</div>
          </div>
        )}
      </div>
    </div>
  );
}
