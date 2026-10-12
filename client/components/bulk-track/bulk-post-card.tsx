"use client";

import { motion } from "framer-motion";
import { Bookmark, ExternalLink, Eye, Film, Heart, Instagram, MessageCircle, Repeat2, Share2 } from "lucide-react";

import { CARD, MetricCell, STATUS_LABEL, StatusPill, fadeRise, timeAgo } from "@/components/bulk-track/shared";
import { compactNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BulkPostRow } from "@/lib/api-client";

/**
 * A bulk-tracked post on the Posts tab (the source's BulkPostCard) — icon
 * tile in place of a thumbnail (no image is stored for research posts), a
 * status + permalink chip, and the 6-cell metric strip once scraped. No
 * earnings cell: bulk-tracked posts aren't tied to payouts.
 */
export function BulkPostCard({ post, index }: { post: BulkPostRow; index: number }) {
  const isDone = post.status === "done";
  return (
    <motion.div {...fadeRise(index)} className={cn(CARD, "flex flex-col gap-4 p-5 sm:flex-row sm:p-6")} data-testid="bulk-post-card">
      <div className="relative grid min-h-[110px] w-full shrink-0 place-items-center overflow-hidden rounded-md bg-surface-2 sm:min-h-0 sm:w-28">
        <Instagram size={22} className="text-text-faint" />
        {post.postType && (
          <span className="absolute left-1.5 top-1.5 rounded-[6px] bg-ink px-1.5 py-0.5 text-[9px] font-semibold uppercase text-ink-fg">{post.postType}</span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusPill status={post.status} label={STATUS_LABEL[post.status] ?? post.status} />
            <a
              href={post.permalink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex max-w-[240px] items-center gap-1 truncate rounded-full bg-blue-soft px-2 py-0.5 text-[10px] font-medium text-blue hover:brightness-110"
            >
              <ExternalLink size={9} className="shrink-0" /> {post.permalink.replace(/^https?:\/\/(www\.)?instagram\.com\//, "")}
            </a>
          </div>
          {post.failureReason && <p className="mt-1.5 text-[11px] text-rose">{post.failureReason}</p>}
        </div>

        {isDone ? (
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-6">
            <MetricCell icon={Eye} value={compactNumber(post.views ?? 0)} label="Views" tone="blue" />
            <MetricCell icon={Heart} value={compactNumber(post.likes ?? 0)} label="Likes" tone="rose" />
            <MetricCell icon={MessageCircle} value={compactNumber(post.comments ?? 0)} label="Comments" tone="amber" />
            <MetricCell icon={Share2} value={compactNumber(post.shares ?? 0)} label="Shares" tone="accent" />
            <MetricCell icon={Repeat2} value={compactNumber(post.reposts ?? 0)} label="Reposts" tone="accent" />
            <MetricCell icon={Bookmark} value={compactNumber(post.saves ?? 0)} label="Saves" tone="slate" />
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-[11px] text-text-faint">
            <Film size={11} /> Metrics not scraped yet
          </div>
        )}

        <div className="flex items-center justify-end text-[11px] text-text-faint">
          <span>{timeAgo(post.createdAt)}</span>
        </div>
      </div>
    </motion.div>
  );
}
