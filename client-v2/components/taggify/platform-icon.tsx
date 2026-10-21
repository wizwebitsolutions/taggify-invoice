import { useId } from "react";

import { cn } from "@/lib/utils";

/**
 * Platform marks from the reference: Instagram as a gradient outline glyph,
 * YouTube as the red play badge. Anything else falls back to a neutral dot.
 * `platform` is Asset.platform from the API ("instagram" | "youtube" | …).
 *
 * Instagram renders nothing by default (design-fix #3, 7 Oct): an Instagram
 * page is shown by its real profile photo (PageAvatar), not the logo. Pass
 * `always` where the logo itself is the point (kitchen sink).
 */
export function PlatformIcon({ platform, size = 18, className, always }: { platform: string; size?: number; className?: string; always?: boolean }) {
  const gid = useId();
  const p = platform.toLowerCase();
  if (p === "instagram") {
    if (!always) return null;
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="Instagram" className={cn("shrink-0", className)}>
        <defs>
          <linearGradient id={gid} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#FEC053" />
            <stop offset=".45" stopColor="#F2203E" />
            <stop offset="1" stopColor="#7B2BE2" />
          </linearGradient>
        </defs>
        <rect x="2" y="2" width="20" height="20" rx="6" fill="none" stroke={`url(#${gid})`} strokeWidth="2.2" />
        <circle cx="12" cy="12" r="4.3" fill="none" stroke={`url(#${gid})`} strokeWidth="2.2" />
        <circle cx="17.3" cy="6.7" r="1.4" fill="#C2307D" />
      </svg>
    );
  }
  if (p === "youtube") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="YouTube" className={cn("shrink-0", className)}>
        <rect x="1" y="4" width="22" height="16" rx="5" fill="#FF1E1E" />
        <path d="M10 8.6v6.8l5.8-3.4z" fill="#fff" />
      </svg>
    );
  }
  return <span role="img" aria-label={platform} className={cn("inline-block shrink-0 rounded-full bg-fg-muted", className)} style={{ width: size * 0.5, height: size * 0.5 }} />;
}
