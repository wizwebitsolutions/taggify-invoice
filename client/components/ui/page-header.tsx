import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Page header from the premium mockup (`.ph`): a 22–24px/600 title (wrap
 * the accent word in `<span className="serif">`), a muted one-liner, and a
 * right-aligned action group. No eyebrow band, no glow.
 */
export function PageHeader({ title, subtitle, actions, tags, className }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; tags?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-start gap-4", className)}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-[1.375rem] font-semibold leading-tight tracking-[-0.03em] md:text-[1.5rem]">{title}</h1>
          {tags}
        </div>
        {subtitle && <p className="mt-1 max-w-[64ch] text-[0.8375rem] text-text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
