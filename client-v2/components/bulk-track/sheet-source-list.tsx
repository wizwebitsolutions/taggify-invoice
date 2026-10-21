"use client";

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { motion } from "motion/react";
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, FileSpreadsheet, Link2, Loader2, RefreshCw, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { CARD, errorMessage, fadeRise, sheetSourceLabel, timeAgo } from "@/components/bulk-track/shared";
import { bulkTrack as bulkTrackApi, type BulkSheetSource } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

export { sheetSourceLabel };

// What this sheet sends to Apify — the rest is read from the sheet only.
function fetchModeLabel(s: BulkSheetSource): string {
  const followers = s.fetchFollowers !== false;
  const engagement = s.fetchEngagement !== false;
  if (followers && engagement) return "fetching followers + engagement";
  return followers ? "fetching followers only" : "fetching engagement only";
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
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent hideClose className="p-5 sm:max-w-sm">
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-danger-fg" />
          <DialogTitle className="text-body-strong font-bold text-foreground">Remove sheet</DialogTitle>
        </div>
        <p className="mb-1 truncate font-mono text-caption font-normal text-muted-foreground">{source.sheetUrl}</p>
        <DialogDescription className="mb-4 text-caption font-normal text-muted-foreground">
          This deletes every profile, post, and scraped snapshot imported through this sheet, and every batch tied to it. This can&apos;t be undone.
        </DialogDescription>
        {del.isError && <p className="mb-3 text-caption font-normal text-danger-fg">{errorMessage(del.error, "Couldn't remove — try again.")}</p>}
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" className="flex-1" onClick={onClose} disabled={del.isPending}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" className="flex-1" onClick={() => del.mutate()} disabled={del.isPending}>
            {del.isPending ? <Loader2 className="animate-spin" /> : null}
            Remove everything
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Connected sheets" (v1 SheetSourceList): click a sheet to filter the
 * Batches/Posts below to it; Check now imports new rows; remove deletes
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
  onRemoved,
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
  /** A removed sheet, so the page can drop it from what it remembers. */
  onRemoved?: (id: string) => void;
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
            onRemoved?.(deleteTarget.id);
            onChanged();
          }}
        />
      )}
      <h3 className="mb-3 text-body-strong font-bold">Connected sheets</h3>
      <p className="mb-3 text-caption font-normal text-muted-foreground">Click a sheet to see only its batches and posts below.</p>
      {check.isError && <p className="mb-3 text-caption font-normal text-danger-fg">{errorMessage(check.error, "Couldn't check that sheet — try again.")}</p>}
      <div className="flex flex-col gap-2">
        {sources.map((s) => {
          const active = selectedSheetId === s.id;
          return (
            <div
              key={s.id}
              onClick={() => onSelect(active ? null : s.id)}
              data-testid="bulk-sheet-source"
              className={cn(
                "flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3.5 py-2.5 transition-colors",
                active ? "border-info bg-info-soft" : "border-transparent bg-muted hover:border-border"
              )}
            >
              <div className="min-w-0 flex-1">
                <p className={cn("flex items-center gap-1.5 truncate text-caption font-semibold", active ? "text-info-fg" : "text-foreground")}>
                  <FileSpreadsheet className="h-3 w-3 shrink-0" /> {sheetSourceLabel(s)}
                </p>
                <a
                  href={s.sheetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="mt-0.5 flex items-center gap-1 truncate text-micro font-normal text-link hover:text-foreground"
                >
                  <Link2 className="h-2.5 w-2.5 shrink-0" /> <span className="truncate">{s.sheetUrl}</span> <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                </a>
                <p className="mt-0.5 text-micro font-normal text-muted-foreground">
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
                  className="grid h-7 w-7 place-items-center rounded-md border border-border text-info-fg transition-colors hover:border-info disabled:opacity-40"
                >
                  <RefreshCw className={cn("h-3 w-3", check.isPending && check.variables === s.id && "animate-spin")} />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteTarget(s);
                  }}
                  aria-label="Remove sheet"
                  title="Remove sheet"
                  className="grid h-7 w-7 place-items-center rounded-md border border-border text-danger-fg transition-colors hover:border-danger"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
                {active && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(null);
                    }}
                    aria-label="Clear selection"
                    className="grid h-7 w-7 place-items-center rounded-md text-info-fg"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {!expanded && total > sources.length && (
        <button type="button" onClick={() => onExpandChange(true)} className="mt-3 flex items-center gap-1 text-caption text-link transition-colors hover:text-foreground">
          See more <ChevronDown className="h-3 w-3" />
        </button>
      )}

      {expanded && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <button type="button" onClick={() => onExpandChange(false)} className="text-caption text-link transition-colors hover:text-foreground">
            Show less
          </button>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onPageChange(Math.max(1, page - 1))}
                disabled={page <= 1}
                aria-label="Previous page"
                className="grid h-6 w-6 place-items-center rounded-sm border border-border text-info-fg transition-colors hover:border-info disabled:opacity-30"
              >
                <ChevronLeft className="h-3 w-3" />
              </button>
              <span className="num text-micro font-normal text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => onPageChange(Math.min(totalPages, page + 1))}
                disabled={page >= totalPages}
                aria-label="Next page"
                className="grid h-6 w-6 place-items-center rounded-sm border border-border text-info-fg transition-colors hover:border-info disabled:opacity-30"
              >
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}
