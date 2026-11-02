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
  if (p === "whatsapp") return <WhatsAppIcon size={size} className={className} />;
  return <span role="img" aria-label={platform} className={cn("inline-block shrink-0 rounded-full bg-fg-muted", className)} style={{ width: size * 0.5, height: size * 0.5 }} />;
}

/** WhatsApp's mark (green bubble, white handset), for page group links. Decorative: the link text says "WhatsApp". */
export function WhatsAppIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={cn("shrink-0", className)}>
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2z" fill="#25D366" />
      <path
        transform="translate(6.6 6.6) scale(0.45)"
        d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"
        fill="#fff"
      />
    </svg>
  );
}
