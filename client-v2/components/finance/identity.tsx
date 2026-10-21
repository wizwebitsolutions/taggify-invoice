"use client";

import { useState } from "react";
import { FileText, Images, Play } from "lucide-react";

import { assets as assetsApi } from "@/lib/api-client";
import { isReelLike } from "@/lib/formats";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { UserAvatar } from "@/components/taggify/user-avatar";

/**
 * Page / content identity pieces used across Finance: the page's real profile
 * photo (served by GET /assets/:id/profile-pic, initials until one exists) and
 * the post thumbnail from its latest insights snapshot (a dark format tile
 * until a scrape has produced one — never stock imagery).
 */
export function PageAvatar({ assetId, handle, size = "sm", className }: { assetId?: string | null; handle: string; size?: "xs" | "sm" | "md" | "lg" | "xl"; className?: string }) {
  // A page with no photo yet would otherwise be re-requested on every mount (lists, filters, sheets).
  const usable = !!assetId && !recentlyMissing(assetId);
  return (
    <UserAvatar
      name={handle}
      src={usable ? assetsApi.profilePicUrl(assetId) : null}
      size={size}
      className={className}
      onImageStatus={(s) => {
        if (s === "error" && assetId) missingPics.set(assetId, Date.now());
      }}
    />
  );
}

/**
 * Asset ids whose profile photo just failed to load; they show initials without
 * another request. Forgotten after 10 minutes (the server caches "no picture
 * yet" as long), so a page scraped since then gets its photo without a reload.
 */
const missingPics = new Map<string, number>();
const MISSING_PIC_TTL_MS = 10 * 60 * 1000;
function recentlyMissing(assetId: string) {
  const at = missingPics.get(assetId);
  if (at == null) return false;
  if (Date.now() - at < MISSING_PIC_TTL_MS) return true;
  missingPics.delete(assetId);
  return false;
}

/**
 * Up to `max` small overlapping page photos, then a "+N" for the rest
 * (design-fix #1; kept small with no count line under it, 2nd check #2).
 * With `onOpen`, each photo is a button that opens that page.
 */
export function PageAvatarStack<P extends { id: string; handle: string; platform?: string | null }>({ pages, max = 3, onOpen, className }: { pages: P[]; max?: number; onOpen?: (page: P) => void; className?: string }) {
  const shown = pages.slice(0, max);
  const rest = pages.length - shown.length;
  return (
    <TooltipProvider delayDuration={200}>
      <span className={cn("flex items-center -space-x-1.5", className)}>
        {shown.map((p) => {
          const label = displayHandle(p.handle, p.platform);
          const avatar = <PageAvatar assetId={p.id} handle={p.handle} size="xs" className="ring-2 ring-card" />;
          return (
            <Tooltip key={p.id}>
              <TooltipTrigger asChild>
                {onOpen ? (
                  <button type="button" aria-label={`Open ${label}`} onClick={() => onOpen(p)} className="rounded-full transition-transform hover:z-10 hover:-translate-y-0.5">
                    {avatar}
                  </button>
                ) : (
                  <span className="rounded-full">{avatar}</span>
                )}
              </TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          );
        })}
        {rest > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="z-0 grid h-6 w-6 place-items-center rounded-full bg-chip text-micro font-semibold text-foreground ring-2 ring-card">+{rest}</span>
            </TooltipTrigger>
            <TooltipContent>{pages.slice(max).map((p) => displayHandle(p.handle, p.platform)).join(", ")}</TooltipContent>
          </Tooltip>
        )}
      </span>
    </TooltipProvider>
  );
}

/** A page's handle as plain text: no "@" prefix (design-fix #3), even if one was typed in. */
export function displayHandle(handle: string, _platform?: string | null) {
  if (!handle) return "—";
  return handle.replace(/^@+/, "");
}

export function audienceLabel(followers: number | null | undefined, platform?: string | null, short = false) {
  if (followers == null) return null;
  // Audience reads the way creators quote it (482K, 1.2M), unlike money which stays in lakh.
  const n = followers >= 1_000_000 ? `${(followers / 1_000_000).toFixed(1).replace(/\.0$/, "")}M` : followers >= 1000 ? `${Math.round(followers / 1000)}K` : String(followers);
  if (short) return n;
  return `${n} ${platform?.toLowerCase() === "youtube" ? "subscribers" : "followers"}`;
}

export function ContentThumb({ src, format, size = 42, className }: { src?: string | null; format: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  // Reel and Political reel play; Static / Carousel (and legacy "carousel") is images; a story is a page.
  const Icon = format === "story" ? FileText : format === "post" || format === "carousel" ? Images : Play;
  return (
    <span className={cn("relative grid shrink-0 place-items-center overflow-hidden rounded-sm bg-media text-white", className)} style={{ width: size, height: size }}>
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote Instagram/Cloudinary thumbnails
        <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <Icon className="h-4 w-4" fill={isReelLike(format) || format === "video" ? "currentColor" : "none"} aria-hidden />
      )}
    </span>
  );
}
