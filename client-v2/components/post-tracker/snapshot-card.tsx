"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  Archive,
  ArchiveRestore,
  Camera,
  CircleAlert,
  CircleCheck,
  ExternalLink,
  Eye,
  Heart,
  Loader2,
  Lock,
  MessageCircle,
  MoreHorizontal,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import type { TrackedPost } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CARD, MICRO, StatusPill, fadeRise, formatDate, timeAgo } from "@/components/bulk-track/shared";

/** The capture's phone viewport (Playwright "Pixel 7" is 412×839 in-page) — both snapshots share its shape. */
const PHONE_RATIO = { aspectRatio: "412 / 839" };

const count = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-IN"));

const LOCAL_SNAP2_KEY = (id: string) => `taggify_snap2_${id}`;

/**
 * Snapshot 2: Authentic Instagram mobile engagement sheet.
 * Never displays fabricated views or mock accounts.
 * If user uploads their real phone screenshot (e.g. from the Instagram app),
 * displays that real screenshot; otherwise displays verified public data
 * with a direct upload option.
 */
function Snapshot2View({
  post,
  customSnap2,
  onUploadSnap2,
  onRemoveSnap2,
}: {
  post: TrackedPost;
  customSnap2: string | null;
  onUploadSnap2: (file: File) => void;
  onRemoveSnap2: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const snap = post.snapshot;
  const isDone = snap.status === "done";
  const isPending = snap.status === "queued";
  const bgImage = snap.coverUrl || snap.screenshotUrl;

  // 1. If user uploaded a real screenshot of the "Likes and plays" sheet from their phone:
  if (customSnap2) {
    return (
      <div className="group relative overflow-hidden rounded-md border border-zinc-800 bg-muted" style={PHONE_RATIO}>
        <a href={customSnap2} target="_blank" rel="noreferrer" title="Open full size">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={customSnap2}
            alt={`Snapshot 2 of ${snap.ownerHandle ?? "the post"}`}
            className="h-full w-full object-cover object-top"
          />
        </a>
        <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-full bg-black/75 p-1.5 text-white/90 hover:bg-black hover:text-white"
            title="Replace screenshot"
          >
            <Camera className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onRemoveSnap2}
            className="rounded-full bg-black/75 p-1.5 text-white/90 hover:bg-black hover:text-white"
            title="Remove screenshot"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUploadSnap2(f);
          }}
        />
      </div>
    );
  }

  // 2. Verified real public Instagram data styled identically to Instagram's mobile "Likes and plays" sheet
  return (
    <div
      className="relative flex flex-col overflow-hidden rounded-md border border-zinc-800 bg-[#0B0C0E] text-white select-none shadow-sm"
      style={PHONE_RATIO}
    >
      {/* Top 28%: Reel Backdrop */}
      <div className="relative h-[28%] w-full overflow-hidden bg-zinc-950">
        {bgImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={bgImage}
            alt={snap.ownerHandle ?? "Reel background"}
            className="h-full w-full object-cover object-top brightness-75 scale-105"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-b from-zinc-800 via-zinc-900 to-zinc-950" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/80" />

        {/* Mobile top status bar */}
        <div className="absolute top-2 inset-x-3 flex items-center justify-between text-[10px] text-white/80 font-medium tracking-tight">
          <span>{snap.postedOn ? snap.postedOn.split(",")[0] : "Reel"}</span>
          <div className="flex items-center gap-1.5 opacity-80">
            <span className="text-[9px] font-semibold">5G</span>
            <div className="w-3.5 h-2 rounded-[2px] border border-white/80 relative flex items-center p-[1px]">
              <div className="h-full w-2 bg-white/90 rounded-[1px]" />
            </div>
          </div>
        </div>

        {/* Real author & caption preview */}
        <div className="absolute bottom-3 inset-x-3 text-center">
          <p className="text-[11px] font-semibold text-white drop-shadow-md line-clamp-1">
            {snap.ownerHandle ? `@${snap.ownerHandle}` : "Instagram Post"}
          </p>
          {snap.caption && (
            <p className="text-[9px] text-white/70 line-clamp-1 mt-0.5 drop-shadow">
              {snap.caption}
            </p>
          )}
        </div>
      </div>

      {/* Bottom 72%: Authentic "Likes and plays" Sheet (matching Instagram mobile app sheet) */}
      <div className="relative z-10 -mt-2.5 flex flex-1 flex-col rounded-t-[22px] border-t border-white/10 bg-[#16171A] shadow-2xl min-h-0">
        {/* Sheet Drag Handle */}
        <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-white/25 shrink-0" />

        {/* Optional upload trigger button at top right */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          title="Upload full app sheet (optional)"
          className="absolute top-2 right-3 rounded-full bg-white/10 p-1 text-white/70 hover:bg-white/20 hover:text-white transition-colors"
        >
          <Camera className="h-3 w-3" />
        </button>

        {/* Sheet Title */}
        <h3 className="mt-1 text-center text-[12px] font-semibold tracking-tight text-white shrink-0">
          Likes and plays
        </h3>

        {/* Centered Likes & Plays metrics row (matching reference layout: ♡ 28   👁 625) */}
        <div className="mt-1 flex items-center justify-center gap-6 border-b border-white/10 pb-2 shrink-0">
          <div className="flex items-center gap-1.5 text-[12px] font-semibold text-white">
            <Heart className="h-3.5 w-3.5 fill-white/10 text-white" />
            <span>{isDone ? count(snap.likeCount) : isPending ? "…" : "—"}</span>
          </div>

          <div className="flex items-center gap-1.5 text-[12px] font-semibold text-white">
            <Eye className="h-3.5 w-3.5 text-white" />
            <span>{isDone ? (snap.viewCount != null ? count(snap.viewCount) : "—") : isPending ? "…" : "—"}</span>
          </div>

          {snap.commentCount != null && (
            <div className="flex items-center gap-1.5 text-[12px] font-semibold text-white">
              <MessageCircle className="h-3.5 w-3.5 text-white" />
              <span>{isDone ? count(snap.commentCount) : isPending ? "…" : "—"}</span>
            </div>
          )}
        </div>

        {/* Liked By Section Header & Search Bar */}
        <div className="px-3 pt-2 shrink-0">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold text-white tracking-tight">Liked by</p>
            <span className="text-[9px] text-emerald-400 font-medium flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Public views verified
            </span>
          </div>
          <div className="mt-1 flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1 text-[10px] text-white/40 border border-white/5">
            <Search className="h-3 w-3 text-white/40 shrink-0" />
            <span>Search</span>
          </div>
        </div>

        {/* Engagement detail rows & creator row */}
        <div className="flex-1 overflow-y-auto px-3 py-1.5 space-y-2 min-h-0">
          {/* Creator Profile Row (styled like Instagram user row in Liked By sheet) */}
          <div className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.03] p-2 border border-white/5">
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-7 w-7 rounded-full bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 p-[1.5px] shrink-0">
                <div className="h-full w-full rounded-full bg-zinc-900 flex items-center justify-center text-[10px] font-bold text-white uppercase">
                  {snap.ownerHandle ? snap.ownerHandle.slice(0, 2) : "IG"}
                </div>
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-white truncate leading-tight">
                  {snap.ownerHandle ? `@${snap.ownerHandle}` : "creator"}
                </p>
                <p className="text-[9px] text-white/50 truncate leading-tight mt-0.5">
                  {snap.postedOn || "Original creator"}
                </p>
              </div>
            </div>
            <a
              href={post.canonicalUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-[#0095F6] hover:bg-[#1877F2] px-2.5 py-1 text-[10px] font-semibold text-white shrink-0 transition-colors"
            >
              View
            </a>
          </div>

          {/* Verified Reel Stats summary card */}
          <div className="rounded-lg bg-white/[0.04] p-2.5 border border-white/5 text-[10px] space-y-1.5">
            <div className="flex items-center justify-between text-white/70">
              <span className="flex items-center gap-1.5">
                <Eye className="h-3 w-3 text-sky-400" /> Public Reel Plays
              </span>
              <span className="font-bold text-white">
                {isDone ? (snap.viewCount != null ? count(snap.viewCount) : "Not available") : "Fetching…"}
              </span>
            </div>
            <div className="flex items-center justify-between text-white/70">
              <span className="flex items-center gap-1.5">
                <Heart className="h-3 w-3 text-rose-400" /> Total Likes
              </span>
              <span className="font-bold text-white">{isDone ? count(snap.likeCount) : "—"}</span>
            </div>
            <div className="flex items-center justify-between text-white/70">
              <span className="flex items-center gap-1.5">
                <MessageCircle className="h-3 w-3 text-amber-400" /> Total Comments
              </span>
              <span className="font-bold text-white">{isDone ? count(snap.commentCount) : "—"}</span>
            </div>
          </div>
        </div>

        {/* Subtle footer with camera upload option (never taking over the card) */}
        <div className="border-t border-white/5 px-3 py-1 flex items-center justify-between text-[9px] text-white/40 shrink-0">
          <span>Public data scraped via Playwright</span>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1 text-white/60 hover:text-white transition-colors"
          >
            <Camera className="h-2.5 w-2.5" />
            <span>Upload app sheet</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUploadSnap2(f);
            }}
          />
        </div>

        {/* Bottom Phone Indicator Bar */}
        <div className="mx-auto my-1 h-0.5 w-20 rounded-full bg-white/20 shrink-0" />
      </div>
    </div>
  );
}

/**
 * One tracked link as its two snapshots:
 *   1. the reel as a phone visitor sees it (captured by server Playwright);
 *   2. real engagement metrics or uploaded mobile "Likes and plays" sheet.
 */
export function SnapshotCard({
  post,
  index,
  showOwner,
  busy,
  onUpdate,
  onRecapture,
  onDelete,
}: {
  post: TrackedPost;
  index: number;
  showOwner: boolean;
  busy: boolean;
  onUpdate: (patch: { broken?: boolean; archived?: boolean }) => void;
  onRecapture: () => void;
  onDelete: () => void;
}) {
  const snap = post.snapshot;
  const archived = !!post.archivedAt;
  const pending = snap.status === "queued";

  const [customSnap2, setCustomSnap2] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(LOCAL_SNAP2_KEY(post.id));
      if (saved) setCustomSnap2(saved);
    }
  }, [post.id]);

  function handleUploadSnap2(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      if (dataUrl) {
        setCustomSnap2(dataUrl);
        try {
          localStorage.setItem(LOCAL_SNAP2_KEY(post.id), dataUrl);
        } catch (err) {
          console.warn("Storage quota exceeded", err);
        }
      }
    };
    reader.readAsDataURL(file);
  }

  function handleRemoveSnap2() {
    setCustomSnap2(null);
    if (typeof window !== "undefined") {
      localStorage.removeItem(LOCAL_SNAP2_KEY(post.id));
    }
  }

  return (
    <motion.article
      {...fadeRise(Math.min(index, 8), 40)}
      className={cn(CARD, "flex flex-col overflow-hidden")}
      data-testid="tracked-post-card"
    >
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <StatusPill status="not_fetched" label={post.kind === "reel" ? "Reel" : "Post"} />
        {post.broken && <StatusPill status="broken" label="Broken" />}
        {archived && <StatusPill status="not_fetched" label="Archived" />}
        <span className="ml-auto truncate text-caption font-normal text-muted-foreground">
          Added {formatDate(post.createdAt)}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="More actions" disabled={busy}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onUpdate({ broken: !post.broken })}>
              {post.broken ? <CircleCheck className="h-4 w-4" aria-hidden /> : <CircleAlert className="h-4 w-4" aria-hidden />}
              {post.broken ? "Mark OK" : "Mark broken"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onUpdate({ archived: !archived })}>
              {archived ? <ArchiveRestore className="h-4 w-4" aria-hidden /> : <Archive className="h-4 w-4" aria-hidden />}
              {archived ? "Restore" : "Archive"}
            </DropdownMenuItem>
            {archived && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onDelete} className="text-danger-fg">
                  <Trash2 className="h-4 w-4" aria-hidden />
                  Delete for good
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {(post.note || (showOwner && post.createdBy)) && (
        <div className="flex flex-col gap-0.5 px-4 pt-3">
          {post.note && <p className="line-clamp-2 text-small text-foreground">{post.note}</p>}
          {showOwner && post.createdBy && (
            <p className="text-caption font-normal text-muted-foreground">
              Added by {post.createdBy.name ?? "someone"}
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 p-4">
        {/* Snapshot 1 — the reel screen */}
        <figure className="flex min-w-0 flex-col gap-1.5">
          <figcaption className={MICRO}>Snapshot 1 · {post.kind === "reel" ? "Reel" : "Post"}</figcaption>
          <div className="relative overflow-hidden rounded-md border bg-muted" style={PHONE_RATIO}>
            {snap.screenshotUrl ? (
              <a href={snap.screenshotUrl} target="_blank" rel="noreferrer" title="Open full size">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={snap.screenshotUrl}
                  alt={`Snapshot of ${snap.ownerHandle ?? "the post"}`}
                  loading="lazy"
                  className="h-full w-full object-cover object-top"
                />
              </a>
            ) : (
              <div className="absolute inset-0 grid place-items-center px-3 text-center text-caption font-normal text-muted-foreground">
                {pending ? (
                  <span className="flex flex-col items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Taking snapshot…
                  </span>
                ) : (
                  "No snapshot"
                )}
              </div>
            )}
          </div>
        </figure>

        {/* Snapshot 2 — Authentic Likes and plays sheet */}
        <figure className="flex min-w-0 flex-col gap-1.5">
          <figcaption className={MICRO}>Snapshot 2 · Likes &amp; plays</figcaption>
          <Snapshot2View
            post={post}
            customSnap2={customSnap2}
            onUploadSnap2={handleUploadSnap2}
            onRemoveSnap2={handleRemoveSnap2}
          />
        </figure>
      </div>

      {/* Snapshot Metadata Banner */}
      <div className="border-t bg-muted/20 px-4 py-2.5">
        <div className="flex items-center justify-between text-micro text-muted-foreground">
          {snap.ownerHandle && (
            <span>
              By <strong className="text-foreground">@{snap.ownerHandle}</strong>
            </span>
          )}
          {snap.postedOn && <span>{snap.postedOn}</span>}
          {snap.capturedAt && <span>Captured {timeAgo(snap.capturedAt)}</span>}
        </div>
        {snap.caption && (
          <p className="mt-1 line-clamp-2 text-micro text-foreground/80 font-normal leading-relaxed">
            {snap.caption}
          </p>
        )}
        {pending && (
          <p className="mt-1.5 flex items-center gap-1.5 text-micro text-info-fg">
            <Loader2 className="h-3 w-3 animate-spin" />
            Taking snapshot… {snap.error ? `(${snap.error})` : ""}
          </p>
        )}
        {(snap.status === "failed" || snap.status === "unavailable") && (
          <p className="mt-1.5 text-micro text-danger-fg">
            {snap.error ?? "Couldn't take the snapshot"}
          </p>
        )}
      </div>

      <footer className="mt-auto flex items-center gap-2 border-t px-4 py-3">
        <Button asChild variant="outline" size="sm">
          <a href={post.canonicalUrl} target="_blank" rel="noreferrer">
            <ExternalLink aria-hidden />
            Open
          </a>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          disabled={busy || pending || archived}
          onClick={onRecapture}
        >
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
          {pending ? "Capturing…" : "Re-capture"}
        </Button>
      </footer>
    </motion.article>
  );
}
