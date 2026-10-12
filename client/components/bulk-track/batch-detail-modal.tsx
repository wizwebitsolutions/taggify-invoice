"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Download, Loader2, RefreshCw, Trash2, X } from "lucide-react";

import { Sheet } from "@/components/ui/sheet";
import { MICRO, StatusPill, errorMessage } from "@/components/bulk-track/shared";
import { bulkTrack as bulkTrackApi } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { compactNumber } from "@/lib/format";

const BTN = "flex items-center gap-1 rounded-[8px] border px-2.5 py-1.5 text-[11px] font-medium transition disabled:opacity-50";

/**
 * Batch detail (the source's BatchDetailModal): Profiles and Posts tables
 * with their status, Export Excel, an inline delete confirm, and a Refresh
 * that re-scrapes the batch's "done" posts. Polls while any row is queued so
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
    <Sheet onClose={onClose} panelClassName="md:max-w-3xl">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-4" data-testid="bulk-batch-detail">
        <div>
          <h3 className="text-sm font-bold text-text">Batch detail</h3>
          {data && (
            <p className="mt-0.5 text-xs text-text-faint">
              {data.batch.sourceType === "sheet" ? "From Google Sheet" : "Manual paste"} · {data.batch.createdAt.slice(0, 10)}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending} className={`${BTN} border-blue-line bg-blue-soft text-blue hover:brightness-110`}>
            {exportMutation.isPending ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />} Export Excel
          </button>
          {confirmingDelete ? (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-rose">Delete this batch?</span>
              <button type="button" onClick={() => del.mutate()} disabled={del.isPending} className={`${BTN} border-transparent bg-rose text-white hover:brightness-110`}>
                {del.isPending ? <Loader2 size={11} className="animate-spin" /> : null}
                Confirm
              </button>
              <button type="button" onClick={() => setConfirmingDelete(false)} disabled={del.isPending} className={`${BTN} border-border text-text-muted hover:text-text`}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmingDelete(true)} className={`${BTN} border-border text-rose hover:border-rose`}>
              <Trash2 size={11} /> Delete batch
            </button>
          )}
          <button type="button" onClick={onClose} className="text-text-faint hover:text-text" aria-label="Close">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
        {(del.isError || exportMutation.isError) && (
          <p className="rounded-md bg-rose-soft px-3 py-2 text-xs text-rose">
            {del.isError ? errorMessage(del.error, "Couldn't delete this batch — try again.") : errorMessage(exportMutation.error, "Couldn't export this batch — try again.")}
          </p>
        )}
        {isLoading && <p className="py-8 text-center text-sm text-text-muted">Loading…</p>}

        {data && data.profiles.length > 0 && (
          <div>
            <p className={`${MICRO} mb-2`}>Profiles · {data.profiles.length}</p>
            <div className="overflow-x-auto rounded-md bg-surface-2">
              <table className="w-full min-w-[480px] text-[11px]">
                <thead>
                  <tr className="border-b border-border">
                    {["Username", "Category", "Followers", "Status", "Reason"].map((h) => (
                      <th key={h} className="px-3 py-2 text-left font-medium text-text-faint">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.profiles.map((p) => (
                    <tr key={p.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2">
                        <a href={p.profileUrl} target="_blank" rel="noopener noreferrer" className="text-blue hover:text-text">
                          @{p.username}
                        </a>
                      </td>
                      <td className="px-3 py-2 text-text-muted">{p.category ?? "—"}</td>
                      <td className="px-3 py-2 tabular-nums text-text">{p.followers != null ? compactNumber(p.followers) : "—"}</td>
                      <td className="px-3 py-2">
                        <StatusPill status={p.status} />
                      </td>
                      <td className="max-w-[200px] truncate px-3 py-2 text-rose" title={p.failureReason ?? undefined}>
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
              <button type="button" onClick={() => refresh.mutate()} disabled={refresh.isPending} className={`${BTN} border-blue-line bg-blue-soft px-2 py-1 text-blue hover:brightness-110`}>
                {refresh.isPending ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                Refresh
              </button>
            </div>
            <div className="overflow-x-auto rounded-md bg-surface-2">
              <table className="w-full min-w-[520px] text-[11px]">
                <thead>
                  <tr className="border-b border-border">
                    {["Permalink", "Type", "Views", "Likes", "Comments", "Status", "Reason"].map((h) => (
                      <th key={h} className="px-3 py-2 text-left font-medium text-text-faint">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.posts.map((p) => (
                    <tr key={p.id} className="border-b border-border last:border-0">
                      <td className="max-w-[160px] truncate px-3 py-2">
                        <a href={p.permalink} target="_blank" rel="noopener noreferrer" className="text-blue hover:text-text">
                          {p.permalink}
                        </a>
                      </td>
                      <td className="px-3 py-2 capitalize text-text-muted">{p.postType ?? "—"}</td>
                      <td className="px-3 py-2 tabular-nums text-text">{p.views != null ? compactNumber(p.views) : "—"}</td>
                      <td className="px-3 py-2 tabular-nums text-text">{p.likes != null ? compactNumber(p.likes) : "—"}</td>
                      <td className="px-3 py-2 tabular-nums text-text">{p.comments != null ? compactNumber(p.comments) : "—"}</td>
                      <td className="px-3 py-2">
                        <StatusPill status={p.status} />
                      </td>
                      <td className="max-w-[180px] truncate px-3 py-2 text-rose" title={p.failureReason ?? undefined}>
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
          <div className="flex items-start gap-2 rounded-md bg-rose-soft px-3 py-2.5">
            <AlertTriangle size={12} className="mt-0.5 shrink-0 text-rose" />
            <p className="text-[11px] leading-relaxed text-rose">
              Failed profiles are usually private or don&apos;t exist. Broken links were deleted, made private, or invalid — they won&apos;t retry on their own.
            </p>
          </div>
        )}
      </div>
    </Sheet>
  );
}
