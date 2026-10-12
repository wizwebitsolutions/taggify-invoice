"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ChevronRight, Eye, Layers, Loader2, PlusCircle, Radar, RefreshCw, Share2, Sheet as SheetIcon } from "lucide-react";

import { RequireAuth } from "@/components/auth/require-auth";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { CARD, FIELD, MICRO, StatChip, StatusPill, errorMessage, fadeRise, formatDate, parseLines, timeAgo } from "@/components/bulk-track/shared";
import { ConnectSheetCard } from "@/components/bulk-track/connect-sheet-card";
import { SheetSourceList, sheetSourceLabel } from "@/components/bulk-track/sheet-source-list";
import { BatchDetailModal } from "@/components/bulk-track/batch-detail-modal";
import { BulkPostCard } from "@/components/bulk-track/bulk-post-card";
import { useAuth } from "@/lib/auth-context";
import { bulkTrack as bulkTrackApi, hasAccess, type BulkSheetSource } from "@/lib/api-client";
import { initialsOf, roleLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Bulk Tracker (12 Oct) — market-research Instagram scraping of any profile
 * or post links, outside the managed pages and not tied to payouts. Ported
 * from wizwebitsolutions/affiliate-creator-tool (pages/BulkTrack.tsx): same
 * layout, components and states, in this app's palette. Replaces "Job runs"
 * in the sidebar. Gated on the opt-in `bulkTrack.view` key (server-enforced
 * on every /api/bulk-track route; this redirect is only UI).
 */
export default function BulkTrackPage() {
  return (
    <RequireAuth>
      <BulkTrackContent />
    </RequireAuth>
  );
}

function BulkTrackContent() {
  const { user, accessToken } = useAuth();
  const token = accessToken!;
  const router = useRouter();
  const allowed = hasAccess(user, "bulkTrack.view");

  useEffect(() => {
    if (!allowed) router.replace("/dashboard");
  }, [allowed, router]);

  const qc = useQueryClient();
  const [profileLinks, setProfileLinks] = useState("");
  const [postLinks, setPostLinks] = useState("");
  const [tab, setTab] = useState<"batches" | "posts">("batches");
  const [selectedSheetId, setSelectedSheetId] = useState<string | null>(null);
  const [detailBatchId, setDetailBatchId] = useState<string | null>(null);

  // Connected sheets: last 5 collapsed; "See more" pages 20 at a time (server caps).
  const [sheetsExpanded, setSheetsExpanded] = useState(false);
  const [sheetsPage, setSheetsPage] = useState(1);
  const sheetsPageSize = sheetsExpanded ? 20 : 5;

  const { data: sheetsData } = useQuery({
    queryKey: ["bulk-sheet-sources", sheetsExpanded, sheetsPage],
    queryFn: () => bulkTrackApi.sheetSources(token, sheetsPage, sheetsPageSize),
    enabled: allowed,
  });

  // The sheets query holds one page — remember every sheet seen so the
  // "Showing: <sheet>" label still resolves after paging away from it.
  const [sheetsById, setSheetsById] = useState<Record<string, BulkSheetSource>>({});
  useEffect(() => {
    if (!sheetsData?.sources.length) return;
    setSheetsById((prev) => {
      const next = { ...prev };
      for (const s of sheetsData.sources) next[s.id] = s;
      return next;
    });
  }, [sheetsData]);

  // Polls while any batch is still running so progress moves without a click.
  const { data: batches, isLoading: batchesLoading } = useQuery({
    queryKey: ["bulk-batches"],
    queryFn: () => bulkTrackApi.batches(token),
    enabled: allowed,
    refetchInterval: (q) => (q.state.data?.some((b) => b.status === "running") ? 5000 : false),
  });

  const { data: posts, isLoading: postsLoading } = useQuery({
    queryKey: ["bulk-posts", selectedSheetId],
    queryFn: () => bulkTrackApi.posts(token, selectedSheetId),
    enabled: allowed && tab === "posts",
    refetchInterval: (q) => (q.state.data?.some((p) => p.status === "queued") ? 5000 : false),
  });

  const submitBatch = useMutation({
    mutationFn: () =>
      bulkTrackApi.createBatch(token, {
        profileLinks: parseLines(profileLinks).slice(0, 50),
        postLinks: parseLines(postLinks).slice(0, 50),
      }),
    onSuccess: () => {
      setProfileLinks("");
      setPostLinks("");
      qc.invalidateQueries({ queryKey: ["bulk-batches"] });
      qc.invalidateQueries({ queryKey: ["bulk-posts"] });
    },
  });

  const refreshSheets = () => {
    qc.invalidateQueries({ queryKey: ["bulk-sheet-sources"] });
    qc.invalidateQueries({ queryKey: ["bulk-batches"] });
    qc.invalidateQueries({ queryKey: ["bulk-posts"] });
  };

  // Re-scrapes every "done" post in the current Posts filter (broken/failed skipped server-side).
  const refreshPosts = useMutation({
    mutationFn: () => bulkTrackApi.refreshPosts(token, selectedSheetId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bulk-posts", selectedSheetId] }),
  });

  // A selected sheet filters Batches/Posts to it; otherwise manual pastes only.
  const filteredBatches = useMemo(() => {
    const all = batches ?? [];
    return selectedSheetId ? all.filter((b) => b.sheetSourceId === selectedSheetId) : all.filter((b) => b.sourceType === "manual");
  }, [batches, selectedSheetId]);

  const totals = useMemo(() => {
    const b = batches ?? [];
    return {
      batches: b.length,
      tracked: b.reduce((s, x) => s + x.totalCount, 0),
      done: b.reduce((s, x) => s + x.successCount, 0),
      failed: b.reduce((s, x) => s + x.failedCount, 0),
    };
  }, [batches]);

  const selectedSheet = selectedSheetId ? sheetsById[selectedSheetId] : undefined;
  const nothingPasted = !parseLines(profileLinks).length && !parseLines(postLinks).length;

  if (!allowed) return null;

  return (
    <AppShell
      active="bulk-track"
      user={{ initials: initialsOf(user?.name), name: user?.name ?? "—", role: roleLabel(user?.role), tone: user?.role === "FINANCE" ? "blue" : "emerald" }}
      searchPlaceholder="Search…"
    >
      <div className="flex flex-col">
        <motion.div {...fadeRise(0)} className="mb-6 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-md border border-blue-line bg-blue-soft">
            <Radar size={18} className="text-blue" />
          </div>
          <div>
            <h1 className="text-[1.5rem] font-semibold leading-tight tracking-[-0.03em]">Bulk Tracker</h1>
            <p className="mt-0.5 text-xs text-text-muted">Market-research Instagram scraping — outside your managed pages, not tied to payouts.</p>
          </div>
        </motion.div>

        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatChip index={1} icon={Layers} label="Batches" value={String(totals.batches)} tone="slate" />
          <StatChip index={2} icon={Radar} label="Rows tracked" value={String(totals.tracked)} tone="blue" />
          <StatChip index={3} icon={Eye} label="Done" value={String(totals.done)} tone="accent" />
          <StatChip index={4} icon={Share2} label="Failed" value={String(totals.failed)} tone="rose" />
        </div>

        <motion.div {...fadeRise(5)} className={cn(CARD, "mb-5 p-5")} data-testid="bulk-new-batch">
          <div className="mb-3 flex items-center gap-2">
            <PlusCircle size={14} className="text-blue" />
            <h3 className="text-sm font-bold">New batch</h3>
          </div>
          <div className="mb-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={`${MICRO} mb-1.5 block`}>Profile links (one per line, max 50)</span>
              <textarea value={profileLinks} onChange={(e) => setProfileLinks(e.target.value)} rows={4} placeholder="https://instagram.com/username" className={cn(FIELD, "font-mono")} />
            </label>
            <label className="block">
              <span className={`${MICRO} mb-1.5 block`}>Post / reel links (one per line, max 50)</span>
              <textarea value={postLinks} onChange={(e) => setPostLinks(e.target.value)} rows={4} placeholder="https://instagram.com/reel/..." className={cn(FIELD, "font-mono")} />
            </label>
          </div>
          <Button onClick={() => submitBatch.mutate()} disabled={submitBatch.isPending || nothingPasted}>
            {submitBatch.isPending ? <Loader2 className="animate-spin" /> : null}
            Track links
          </Button>
          {submitBatch.isError && <p className="mt-2 text-xs text-rose">{errorMessage(submitBatch.error, "Couldn't queue this batch — check the links and try again.")}</p>}
        </motion.div>

        <ConnectSheetCard onConnected={refreshSheets} index={6} />
        <div className="h-5" />
        <SheetSourceList
          sources={sheetsData?.sources ?? []}
          total={sheetsData?.total ?? 0}
          page={sheetsPage}
          pageSize={sheetsPageSize}
          expanded={sheetsExpanded}
          onExpandChange={(expanded) => {
            setSheetsExpanded(expanded);
            setSheetsPage(1);
          }}
          onPageChange={setSheetsPage}
          selectedSheetId={selectedSheetId}
          onSelect={setSelectedSheetId}
          onChanged={refreshSheets}
          index={7}
        />
        <div className="h-5" />

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5" role="tablist">
            {(["batches", "posts"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn(
                  "rounded-full border px-3.5 py-1.5 text-xs font-medium capitalize transition-colors",
                  tab === t ? "border-blue-line bg-blue-soft text-blue" : "border-border text-text-muted hover:text-text"
                )}
              >
                {t}
              </button>
            ))}
          </div>
          <p className="text-xs text-text-faint">
            Showing: <span className="font-medium text-text">{selectedSheet ? sheetSourceLabel(selectedSheet) : "Manual entries"}</span>
          </p>
        </div>

        {tab === "batches" ? (
          <motion.div {...fadeRise(8)} className={cn(CARD, "overflow-hidden")}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse" data-testid="bulk-batches-table">
                <thead>
                  <tr className="text-left">
                    {["Created", "Source", "Progress", "Status", ""].map((h) => (
                      <th key={h} className={`${MICRO} whitespace-nowrap border-b border-border px-5 py-3 font-semibold`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {batchesLoading ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-10 text-center text-sm text-text-muted">
                        Loading…
                      </td>
                    </tr>
                  ) : filteredBatches.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-10 text-center text-sm text-text-faint">
                        No batches here yet.
                      </td>
                    </tr>
                  ) : (
                    filteredBatches.map((b) => (
                      <tr key={b.id} onClick={() => setDetailBatchId(b.id)} className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-surface-2" data-testid="bulk-batch-row">
                        <td className="whitespace-nowrap px-5 py-3.5 text-sm text-text-muted">
                          {formatDate(b.createdAt)} · {timeAgo(b.createdAt)}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3.5 text-sm text-text">
                          <span className="flex items-center gap-1.5">
                            {b.sourceType === "sheet" ? <SheetIcon size={11} className="text-text-faint" /> : <PlusCircle size={11} className="text-text-faint" />}
                            {b.sourceType === "sheet" ? "Google Sheet" : "Manual"}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-5 py-3.5 text-sm tabular-nums text-text-muted">
                          {b.successCount + b.failedCount}/{b.totalCount}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3.5">
                          <StatusPill status={b.status} size="md" />
                        </td>
                        <td className="px-5 py-3.5">
                          <ChevronRight size={14} className="text-text-faint" />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </motion.div>
        ) : (
          <div className="flex flex-col gap-4 pb-20">
            {postsLoading ? (
              <p className="py-12 text-center text-sm text-text-muted">Loading…</p>
            ) : !posts || posts.length === 0 ? (
              <p className="py-12 text-center text-sm text-text-faint">No posts here yet.</p>
            ) : (
              posts.map((p, i) => <BulkPostCard key={p.id} post={p} index={i} />)
            )}
          </div>
        )}

        {tab === "posts" && posts && posts.length > 0 && (
          <button
            type="button"
            onClick={() => refreshPosts.mutate()}
            disabled={refreshPosts.isPending}
            className="fixed bottom-24 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full bg-ink py-3 pl-4 pr-5 text-sm font-semibold text-ink-fg shadow-lg transition hover:brightness-110 disabled:opacity-60 md:bottom-8"
          >
            {refreshPosts.isPending ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            {refreshPosts.isPending ? "Refreshing…" : "Refresh posts"}
          </button>
        )}

        {detailBatchId && <BatchDetailModal batchId={detailBatchId} onClose={() => setDetailBatchId(null)} onDeleted={refreshSheets} />}
      </div>
    </AppShell>
  );
}
