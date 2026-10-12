"use client";

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Link2, Loader2, RefreshCw, Sheet as SheetIcon, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { CARD, errorMessage, fadeRise, timeAgo } from "@/components/bulk-track/shared";
import { bulkTrack as bulkTrackApi, type BulkSheetSource } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

// What this sheet sends to Apify — the rest is read from the sheet only.
function fetchModeLabel(s: BulkSheetSource): string {
  const followers = s.fetchFollowers !== false;
  const engagement = s.fetchEngagement !== false;
  if (followers && engagement) return "fetching followers + engagement";
  return followers ? "fetching followers only" : "fetching engagement only";
}

export function sheetSourceLabel(s: Pick<BulkSheetSource, "name" | "sheetUrl">): string {
  return s.name?.trim() || s.sheetUrl;
}

function ConfirmDeleteModal({ source, onClose, onDeleted }: { source: BulkSheetSource; onClose: () => void; onDeleted: () => void }) {
  const { accessToken } = useAuth();
  const del = useMutation({
    mutationFn: () => bulkTrackApi.deleteSheet(accessToken!, source.id),
    onSuccess: () => {
      onDeleted();
      onClose();
    },
  });

  return (
    <Sheet onClose={onClose} panelClassName="md:max-w-sm">
      <div className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle size={16} className="text-rose" />
          <h3 className="text-sm font-bold text-text">Remove sheet</h3>
        </div>
        <p className="mb-1 truncate font-mono text-xs text-text-faint">{source.sheetUrl}</p>
        <p className="mb-4 text-xs text-text-muted">
          This deletes every profile, post, and scraped snapshot imported through this sheet, and every batch tied to it. This can&apos;t be undone.
        </p>
        {del.isError && <p className="mb-3 text-xs text-rose">{errorMessage(del.error, "Couldn't remove — try again.")}</p>}
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" className="flex-1" onClick={onClose} disabled={del.isPending}>
            Cancel
          </Button>
          <button
            type="button"
            onClick={() => del.mutate()}
            disabled={del.isPending}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-[7px] bg-rose py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
          >
            {del.isPending ? <Loader2 size={12} className="animate-spin" /> : null}
            Remove everything
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/**
 * "Connected sheets" (the source's SheetSourceList): click a sheet to filter
 * the Batches/Posts below to it; Check now imports new rows; remove deletes
 * everything imported through it. Last 5 by default, "See more" pages 20.
 */
export function SheetSourceList({
  sources,
  total,
  page,
  pageSize,
  expanded,
  onExpandChange,
  onPageChange,
  selectedSheetId,
  onSelect,
  onChanged,
  index = 0,
}: {
  sources: BulkSheetSource[];
  total: number;
  page: number;
  pageSize: number;
  expanded: boolean;
  onExpandChange: (expanded: boolean) => void;
  onPageChange: (page: number) => void;
  selectedSheetId: string | null;
  onSelect: (id: string | null) => void;
  onChanged: () => void;
  index?: number;
}) {
  const { accessToken } = useAuth();
  const [deleteTarget, setDeleteTarget] = useState<BulkSheetSource | null>(null);
  const check = useMutation({
    mutationFn: (id: string) => bulkTrackApi.checkSheet(accessToken!, id),
    onSuccess: onChanged,
  });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // A delete can empty the last page — step back a page instead of a dead end.
  useEffect(() => {
    if (expanded && page > 1 && sources.length === 0) onPageChange(page - 1);
  }, [expanded, page, sources.length, onPageChange]);

  if (total === 0) return null;

  return (
    <motion.div {...fadeRise(index)} className={cn(CARD, "p-5")} data-testid="bulk-sheet-sources">
      {deleteTarget && (
        <ConfirmDeleteModal
          source={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            if (selectedSheetId === deleteTarget.id) onSelect(null);
            onChanged();
          }}
        />
      )}
      <h3 className="mb-3 text-sm font-bold">Connected sheets</h3>
      <p className="mb-3 text-xs text-text-faint">Click a sheet to see only its batches and posts below.</p>
      {check.isError && <p className="mb-3 text-xs text-rose">{errorMessage(check.error, "Couldn't check that sheet — try again.")}</p>}
      <div className="flex flex-col gap-2">
        {sources.map((s) => {
          const active = selectedSheetId === s.id;
          return (
            <div
              key={s.id}
              onClick={() => onSelect(active ? null : s.id)}
              className={cn(
                "flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3.5 py-2.5 transition-colors",
                active ? "border-blue-line bg-blue-soft" : "border-transparent bg-surface-2 hover:border-border"
              )}
            >
              <div className="min-w-0 flex-1">
                <p className={cn("flex items-center gap-1.5 truncate text-xs font-semibold", active ? "text-blue" : "text-text")}>
                  <SheetIcon size={11} className="shrink-0" /> {sheetSourceLabel(s)}
                </p>
                <a
                  href={s.sheetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-blue hover:text-text"
                >
                  <Link2 size={9} className="shrink-0" /> <span className="truncate">{s.sheetUrl}</span> <ExternalLink size={9} className="shrink-0" />
                </a>
                <p className="mt-0.5 text-[10px] text-text-faint">
                  {s.profileLinkCol && `profiles: ${s.profileLinkCol}`}
                  {s.profileLinkCol && s.postLinkCol && " · "}
                  {s.postLinkCol && `posts: ${s.postLinkCol}`}
                  {` · ${fetchModeLabel(s)}`}
                  {" · checked "}
                  {s.lastCheckedAt ? timeAgo(s.lastCheckedAt) : "never"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    check.mutate(s.id);
                  }}
                  disabled={check.isPending}
                  aria-label="Check now"
                  title="Check now"
                  className="grid h-7 w-7 place-items-center rounded-[8px] border border-border text-blue transition-colors hover:border-blue disabled:opacity-40"
                >
                  <RefreshCw size={11} className={check.isPending && check.variables === s.id ? "animate-spin" : ""} />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteTarget(s);
                  }}
                  aria-label="Remove sheet"
                  title="Remove sheet"
                  className="grid h-7 w-7 place-items-center rounded-[8px] border border-border text-rose transition-colors hover:border-rose"
                >
                  <Trash2 size={11} />
                </button>
                {active && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(null);
                    }}
                    aria-label="Clear selection"
                    className="grid h-7 w-7 place-items-center rounded-[8px] text-blue"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {!expanded && total > sources.length && (
        <button type="button" onClick={() => onExpandChange(true)} className="mt-3 flex items-center gap-1 text-xs font-medium text-blue transition-colors hover:text-text">
          See more <ChevronDown size={12} />
        </button>
      )}

      {expanded && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <button type="button" onClick={() => onExpandChange(false)} className="text-xs font-medium text-blue transition-colors hover:text-text">
            Show less
          </button>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onPageChange(Math.max(1, page - 1))}
                disabled={page <= 1}
                aria-label="Previous page"
                className="grid h-6 w-6 place-items-center rounded-[6px] border border-border text-blue transition-colors hover:border-blue disabled:opacity-30"
              >
                <ChevronLeft size={12} />
              </button>
              <span className="text-[10px] tabular-nums text-text-faint">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => onPageChange(Math.min(totalPages, page + 1))}
                disabled={page >= totalPages}
                aria-label="Next page"
                className="grid h-6 w-6 place-items-center rounded-[6px] border border-border text-blue transition-colors hover:border-blue disabled:opacity-30"
              >
                <ChevronRight size={12} />
              </button>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}
