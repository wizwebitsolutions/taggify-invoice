"use client";

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { ApiError, campaigns as campaignsApi, type CampaignAssignment } from "@/lib/api-client";
import { canAddForOwner, normalizeHandle, PAGE_APPROVAL } from "@/lib/creators";
import { personLabel } from "@/lib/format";
import { useAllPages } from "@/lib/queries/creators";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchField } from "@/components/taggify/search-field";
import { StatusPill } from "@/components/taggify/status-pill";
import { audienceLabel, displayHandle, PageAvatar } from "@/components/finance/identity";

const errText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);
const SHOWN = 8;

/**
 * Match a pending campaign-sheet row to a page that's already in Inventory
 * (PUT /campaigns/:id/assignments/:assignmentId, campaigns.edit). When the
 * page isn't in Inventory yet, "Add as a new page" hands over to the Add page
 * dialog, which matches the row once the page is saved.
 */
export function MatchPageDialog({
  campaignId,
  row,
  onClose,
  onAddNew,
  onMatched,
}: {
  campaignId: string;
  row: CampaignAssignment | null;
  onClose: () => void;
  onAddNew: (row: CampaignAssignment) => void;
  onMatched: () => Promise<unknown>;
}) {
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-screen overflow-y-auto sm:max-w-lg">{row && <MatchForm key={row.id} campaignId={campaignId} row={row} onClose={onClose} onAddNew={onAddNew} onMatched={onMatched} />}</DialogContent>
    </Dialog>
  );
}

function MatchForm({ campaignId, row, onClose, onAddNew, onMatched }: { campaignId: string; row: CampaignAssignment; onClose: () => void; onAddNew: (row: CampaignAssignment) => void; onMatched: () => Promise<unknown> }) {
  const { user, accessToken } = useAuth();
  const pages = useAllPages();
  const sheetHandle = displayHandle(row.pageHandle);
  const [q, setQ] = useState(sheetHandle);
  const [picked, setPicked] = useState<string | null>(null);

  const needle = (normalizeHandle(q) ?? q.trim()).toLowerCase();
  const matches = useMemo(
    () =>
      (pages.data ?? [])
        .filter((p) => !needle || `${p.handle} ${p.fullName ?? ""} ${p.owner?.name ?? ""} ${p.owner?.email ?? ""}`.toLowerCase().includes(needle))
        // An exact handle match first, inactive pages last, then by handle.
        .sort(
          (a, b) =>
            Number(b.handle.toLowerCase() === needle) - Number(a.handle.toLowerCase() === needle) ||
            Number(a.isActive === false) - Number(b.isActive === false) ||
            a.handle.localeCompare(b.handle)
        ),
    [pages.data, needle]
  );
  const shown = matches.slice(0, SHOWN);
  const chosen = (pages.data ?? []).find((p) => p.id === picked) ?? null;

  const match = useMutation({
    mutationFn: () => campaignsApi.resolveAssignment(accessToken!, campaignId, row.id, picked!),
    onSuccess: async () => {
      await onMatched();
      toast.success(chosen ? `${sheetHandle} matched to ${displayHandle(chosen.handle)}.` : `${sheetHandle} matched.`);
      onClose();
    },
  });

  return (
    <div className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>Match {sheetHandle}</DialogTitle>
        <DialogDescription>
          The campaign sheet names this page, but it isn&apos;t in Inventory under that handle. Pick the page it means.
          {row.creatorPhone ? ` The sheet lists ${row.creatorPhone} for it.` : ""}
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-2">
        <SearchField label="Find a page" placeholder="Search handle or creator..." value={q} onChange={(e) => setQ(e.target.value)} />
        <ul aria-label="Pages" className="max-h-72 overflow-y-auto rounded-md border">
          {pages.isLoading ? (
            <li className="flex flex-col gap-2 p-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </li>
          ) : pages.isError ? (
            <li className="px-3 py-2 text-small text-muted-foreground">Couldn&apos;t load pages. Close this and try again.</li>
          ) : shown.length === 0 ? (
            <li className="px-3 py-3 text-small text-muted-foreground">No page matches &ldquo;{q.trim()}&rdquo;. Try part of the handle or the creator&apos;s name.</li>
          ) : (
            shown.map((p) => {
              const st = PAGE_APPROVAL[p.approvalStatus];
              return (
                <li key={p.id}>
                  <button type="button" aria-pressed={p.id === picked} onClick={() => setPicked(p.id)} className={cn("flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:shadow-focus", p.id === picked && "bg-brand-soft")}>
                    <PageAvatar assetId={p.id} handle={p.handle} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body-strong">{displayHandle(p.handle)}</span>
                      <span className="block truncate text-small text-muted-foreground">{[personLabel(p.owner, "No vendor"), audienceLabel(p.followers, p.platform)].filter(Boolean).join(" · ")}</span>
                    </span>
                    {p.isActive === false && <StatusPill tone="neutral">Inactive</StatusPill>}
                    {p.approvalStatus !== "approved" && st && <StatusPill tone={st.tone}>{st.label}</StatusPill>}
                    {p.id === picked && <Check className="h-4 w-4 text-brand-ink" aria-hidden />}
                  </button>
                </li>
              );
            })
          )}
        </ul>
        {/* The search can hide the picked page; say which one "Match page" will use. */}
        {chosen && <p className="text-small text-muted-foreground">Selected: {displayHandle(chosen.handle)}</p>}
        {matches.length > shown.length && <p className="text-small text-muted-foreground">Showing {shown.length} of {matches.length}. Type more of the handle to narrow it down.</p>}
        {canAddForOwner(user) && (
          <p className="text-small text-muted-foreground">
            Not in Inventory yet?{" "}
            <button type="button" onClick={() => onAddNew(row)} className="rounded-sm font-semibold text-foreground underline underline-offset-4 hover:text-brand-ink focus-visible:outline-none focus-visible:shadow-focus">
              Add {sheetHandle} as a new page
            </button>
          </p>
        )}
      </div>

      {match.isError && (
        <p className="text-small text-danger-helper" role="alert">
          {errText(match.error, "Couldn't match the page. Try again.")}
        </p>
      )}

      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!picked || match.isPending} onClick={() => match.mutate()}>
          {match.isPending ? "Matching…" : "Match page"}
        </Button>
      </DialogFooter>
    </div>
  );
}
