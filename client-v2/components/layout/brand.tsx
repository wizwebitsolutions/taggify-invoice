import { cn } from "@/lib/utils";

/**
 * The real Taggify wordmark, the same transparent PNG pair the v1 app uses
 * (client/components/ui/logo.tsx): black letters for light mode, white for
 * dark, both with the orange accent. The swap is pure CSS on `data-theme`, so
 * it doesn't flash. `compact` scales the same wordmark down to fit the 72px
 * icon rail; width follows the 3650×707 aspect ratio.
 */
export function Brand({ className, compact }: { className?: string; compact?: boolean }) {
  const size = compact ? "w-12 h-auto" : "h-5 w-auto";
  return (
    <span className={cn("inline-flex shrink-0 items-center", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- flat PNG asset, nothing for next/image to optimise */}
      <img src="/taggify-logo-light.png" alt="Taggify" draggable={false} className={cn("block select-none dark:hidden", size)} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/taggify-logo-dark.png" alt="" aria-hidden="true" draggable={false} className={cn("hidden select-none dark:block", size)} />
    </span>
  );
}
