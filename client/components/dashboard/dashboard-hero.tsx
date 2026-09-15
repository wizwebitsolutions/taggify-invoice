import type { ReactNode } from "react";

/**
 * The page header every dashboard opens with. Premium system: no band, no
 * glow — an eyebrow, a 24px/600 title (callers wrap the word that should
 * carry the Instrument Serif italic accent in `<span className="serif">`),
 * a muted one-line subtitle, and an optional right-aligned headline stat.
 */
export function DashboardHero({
  eyebrow,
  title,
  subtitle,
  stat,
}: {
  eyebrow: string;
  title: ReactNode;
  subtitle: string;
  /** Right-aligned headline stat — omit if the KPI row below already says it. */
  stat?: { value: string; label: string };
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="mb-1 text-[0.68rem] font-medium uppercase tracking-[0.06em] text-text-faint">{eyebrow}</p>
        <h1 className="mb-1 text-[1.5rem] font-semibold leading-tight tracking-[-0.03em] md:text-[1.625rem]">{title}</h1>
        <p className="max-w-[56ch] text-[0.875rem] text-text-muted">{subtitle}</p>
      </div>
      {stat && (
        <div className="hidden shrink-0 text-right sm:block">
          <div className="text-[1.75rem] font-semibold leading-none tracking-[-0.03em] tabular-nums">{stat.value}</div>
          <div className="mt-1.5 text-[0.75rem] text-text-muted">{stat.label}</div>
        </div>
      )}
    </div>
  );
}
