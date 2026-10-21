"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Download, Loader2, RefreshCw, Trash2, X } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { MICRO, StatusPill, errorMessage } from "@/components/bulk-track/shared";
import { bulkTrack as bulkTrackApi } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { compactNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const BTN = "flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-micro font-medium transition disabled:opacity-50";

/**
 * Batch detail (v1 BatchDetailModal): Profiles and Posts tables with their
 * status, Export Excel, an inline delete confirm, and a Refresh that
 * re-scrapes the batch's "done" posts. Polls while any row is queued so
 * results appear as the worker finishes them.
 */
export function BatchDetailModal({ batchId, onClose, onDeleted }: { batchId: string; onClose: () => void; onDeleted?: () => void }) {
  const { accessToken } = useAuth();
  const token = accessToken!;
  const qc = useQueryClient();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["bulk-batch", batchId],
    queryFn: () => bulkTrackApi.batch(token, batchId),
    refetchInterval: (q) => {
      const d = q.state.data;
      return d && [...d.profiles, ...d.posts].some((r) => r.status === "queued") ? 5000 : false;
    },
  });

  const exportMutation = useMutation({ mutationFn: () => bulkTrackApi.exportBatch(token, batchId) });

  const del = useMutation({
    mutationFn: () => bulkTrackApi.deleteBatch(token, batchId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bulk-batches"] });
      qc.invalidateQueries({ queryKey: ["bulk-posts"] });
      qc.removeQueries({ queryKey: ["bulk-batch", batchId] });
      onDeleted?.();
      onClose();
    },
  });

  // Re-scrapes every already-"done" post (broken/failed are skipped server-side).
  const refresh = useMutation({
    mutationFn: () => bulkTrackApi.refreshBatch(token, batchId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bulk-batch", batchId] });
      qc.invalidateQueries({ queryKey: ["bulk-posts"] });
    },
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent hideClose className="flex max-h-screen flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-5 py-4" data-testid="bulk-batch-detail">
          <div>
            <DialogTitle className="text-body-strong font-bold text-foreground">Batch detail</DialogTitle>
            <DialogDescription className="mt-0.5 text-caption font-normal text-muted-foreground">
              {data ? `${data.batch.sourceType === "sheet" ? "From Google Sheet" : "Manual paste"} · ${data.batch.createdAt.slice(0, 10)}` : "Loading…"}
            </DialogDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending} className={cn(BTN, "border-info bg-info-soft text-info-fg hover:brightness-95")}>
              {exportMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} Export Excel
            </button>
            {confirmingDelete ? (
              <div className="flex items-center gap-1.5">
                <span className="text-micro text-danger-fg">Delete this batch?</span>
                <button type="button" onClick={() => del.mutate()} disabled={del.isPending} className={cn(BTN, "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive-hover")}>
                  {del.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  Confirm
                </button>
                <button type="button" onClick={() => setConfirmingDelete(false)} disabled={del.isPending} className={cn(BTN, "border-border text-muted-foreground hover:text-foreground")}>
                  Cancel
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmingDelete(true)} className={cn(BTN, "border-border text-danger-fg hover:border-danger")}>
                <Trash2 className="h-3 w-3" /> Delete batch
              </button>
            )}
            <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
          {(del.isError || exportMutation.isError) && (
            <p className="rounded-md bg-danger-soft px-3 py-2 text-caption font-normal text-danger-fg">
              {del.isError ? errorMessage(del.error, "Couldn't delete this batch — try again.") : errorMessage(exportMutation.error, "Couldn't export this batch — try again.")}
            </p>
          )}
          {isLoading && <p className="py-8 text-center text-body text-muted-foreground">Loading…</p>}

          {data && data.profiles.length > 0 && (
            <div>
              <p className={cn(MICRO, "mb-2")}>Profiles · {data.profiles.length}</p>
              <div className="overflow-x-auto rounded-md bg-muted">
                <table className="w-full min-w-96 text-micro">
                  <thead>
                    <tr className="border-b">
                      {["Username", "Category", "Followers", "Status", "Reason"].map((h) => (
                        <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.profiles.map((p) => (
                      <tr key={p.id} className="border-b last:border-0">
                        <td className="px-3 py-2">
                          <a href={p.profileUrl} target="_blank" rel="noopener noreferrer" className="text-link hover:text-foreground">
                            @{p.username}
                          </a>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{p.category ?? "—"}</td>
                        <td className="num px-3 py-2 text-foreground">{p.followers != null ? compactNumber(p.followers) : "—"}</td>
                        <td className="px-3 py-2">
                          <StatusPill status={p.status} />
                        </td>
                        <td className="max-w-52 truncate px-3 py-2 text-danger-fg" title={p.failureReason ?? undefined}>
                          {p.failureReason ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {data && data.posts.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className={MICRO}>Posts · {data.posts.length}</p>
                <button type="button" onClick={() => refresh.mutate()} disabled={refresh.isPending} className={cn(BTN, "border-info bg-info-soft px-2 py-1 text-info-fg hover:brightness-95")}>
                  {refresh.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  Refresh
                </button>
              </div>
              <div className="overflow-x-auto rounded-md bg-muted">
                <table className="w-full min-w-96 text-micro">
                  <thead>
                    <tr className="border-b">
                      {["Permalink", "Type", "Views", "Likes", "Comments", "Status", "Reason"].map((h) => (
                        <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.posts.map((p) => (
                      <tr key={p.id} className="border-b last:border-0">
                        <td className="max-w-40 truncate px-3 py-2">
                          <a href={p.permalink} target="_blank" rel="noopener noreferrer" className="text-link hover:text-foreground">
                            {p.permalink}
                          </a>
                        </td>
                        <td className="px-3 py-2 capitalize text-muted-foreground">{p.postType ?? "—"}</td>
                        <td className="num px-3 py-2 text-foreground">{p.views != null ? compactNumber(p.views) : "—"}</td>
                        <td className="num px-3 py-2 text-foreground">{p.likes != null ? compactNumber(p.likes) : "—"}</td>
                        <td className="num px-3 py-2 text-foreground">{p.comments != null ? compactNumber(p.comments) : "—"}</td>
                        <td className="px-3 py-2">
                          <StatusPill status={p.status} />
                        </td>
                        <td className="max-w-44 truncate px-3 py-2 text-danger-fg" title={p.failureReason ?? undefined}>
                          {p.failureReason ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {data && (data.profiles.some((p) => p.status === "failed") || data.posts.some((p) => p.status === "broken")) && (
            <div className="flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2.5">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-danger-fg" />
              <p className="text-micro font-normal leading-relaxed text-danger-fg">
                Failed profiles are usually private or don&apos;t exist. Broken links were deleted, made private, or invalid — they won&apos;t retry on their own.
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
