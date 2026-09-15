import { cn } from "@/lib/utils";

/**
 * The Taggify wordmark, exactly as the StreamVerse creator portal renders
 * it: the transparent PNG pair lifted from that app (`public/taggify-logo-
 * light.png` — black letters, `public/taggify-logo-dark.png` — white
 * letters; both keep the orange "A" accent). One is shown per theme via the
 * `[data-theme="dark"]` selector Tailwind's `dark:` variant maps to, so the
 * swap is pure CSS and survives the blocking theme script without a flash.
 *
 * Plain <img> rather than next/image: the client is a static export and
 * the PNGs are already flat assets, so there is nothing to optimise.
 *
 * Size it with a height class on `className` (default 22px); width follows
 * the 3650×707 aspect ratio.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex h-[22px] shrink-0 items-center", className)}>
      <img src="/taggify-logo-light.png" alt="Taggify" draggable={false} className="block h-full w-auto select-none dark:hidden" />
      <img src="/taggify-logo-dark.png" alt="" aria-hidden="true" draggable={false} className="hidden h-full w-auto select-none dark:block" />
    </span>
  );
}
