"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { StatusTimeline, type TimelineStep } from "@/components/dashboard/status-timeline";
import { ErrorNotice } from "@/components/ui/table-parts";
import { links as linksApi, screenshots as screenshotsApi, ApiError, type Link } from "@/lib/api-client";
import { money } from "@/lib/format";

/**
 * One link's detail + admin review actions (approve/reject screenshot,
 * approve insights, refresh metrics) + the creator's proof-screenshot
 * upload. Shared by the creator "My Works" table and the admin dashboard's
 * "Needs your review" queue — both are just different ways of picking
 * which link to show here, and admin still gets full review capability
 * from the new admin dashboard, not just analytics.
 */
export function LinkDetailPanel({
  link,
  token,
  isAdmin,
  canUploadScreenshot,
  onChanged,
}: {
  link: Link;
  token: string;
  isAdmin: boolean;
  canUploadScreenshot: boolean;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const timelineQuery = useQuery({
    queryKey: ["linkTimeline", link.id],
    queryFn: () => linksApi.timeline(token, link.id),
  });

  const reviewMutation = useMutation({
    mutationFn: (approved: boolean) => linksApi.reviewScreenshot(token, link.id, approved),
    onSuccess: onChanged,
  });
  const approveInsightsMutation = useMutation({
    mutationFn: () => linksApi.approveInsights(token, link.id),
    onSuccess: onChanged,
  });
  const refreshMetricsMutation = useMutation({
    mutationFn: () => linksApi.refreshMetrics(token, link.id),
    onSuccess: onChanged,
  });

  const uploadScreenshotMutation = useMutation({
    mutationFn: async (file: File) => {
      const params = await screenshotsApi.requestUploadUrl(token, link.id);

      // Direct-to-Cloudinary signed upload — only the fields that were part
      // of the signature may be sent, or Cloudinary rejects it (server side,
      // see cloudinaryClient.js).
      const form = new FormData();
      form.append("file", file);
      form.append("api_key", params.apiKey);
      form.append("timestamp", String(params.timestamp));
      form.append("signature", params.signature);
      form.append("public_id", params.publicId);

      const uploadRes = await fetch(params.uploadUrl, { method: "POST", body: form });
      if (!uploadRes.ok) {
        throw new Error("Cloudinary rejected the upload — check the image and try again.");
      }

      return screenshotsApi.confirm(token, link.id, params.publicId);
    },
    onSuccess: onChanged,
  });

  const steps: TimelineStep[] = (timelineQuery.data ?? []).map((event, i, arr) => ({
    id: event.id,
    title: STATUS_LABEL[event.status] ?? event.status,
    time: new Date(event.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
    note: event.note,
    state: i === arr.length - 1 ? "current" : "done",
  }));

  // No outer chrome (border/bg/width/padding) here — call sites own that,
  // since desktop wraps this in a persistent side panel while mobile wraps
  // it in a <Sheet> bottom sheet; the content is identical either way.
  return (
    <div className="flex flex-col gap-5">
      {link.screenshot?.url ? (
        <a
          href={link.screenshot.url}
          target="_blank"
          rel="noreferrer"
          title="Open full-size screenshot"
          className="block h-[140px] overflow-hidden rounded-[14px] bg-surface-2"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- Cloudinary-hosted, not a local/optimizable asset */}
          <img src={link.screenshot.url} alt="Submitted proof screenshot" className="h-full w-full object-cover" />
        </a>
      ) : (
        <div className="h-[140px] rounded-[14px] bg-gradient-to-br from-accent-soft to-accent-2-soft" />
      )}
      <div>
        <p className="text-base font-bold">{link.campaign?.title ?? "—"}</p>
        <p className="mt-1 text-[0.8125rem] text-text-faint">@{link.asset?.handle} · {link.url}</p>
      </div>
      <div className="border-t border-border pt-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-faint">Cost</span>
          <span className="text-[1.125rem] font-extrabold tabular-nums">{money(link.cost)}</span>
        </div>
        {isAdmin && (
          <CostRevisionControl
            link={link}
            token={token}
            onChanged={() => {
              queryClient.invalidateQueries({ queryKey: ["linkCostRevisions", link.id] });
              onChanged();
            }}
          />
        )}
      </div>

      {timelineQuery.isLoading ? (
        <p className="text-[0.8125rem] text-text-faint">Loading timeline…</p>
      ) : (
        <StatusTimeline steps={steps.length > 0 ? steps : [{ title: STATUS_LABEL[link.status] ?? link.status, state: "current" }]} />
      )}

      {canUploadScreenshot && (link.status === "SUBMITTED" || link.status === "SCREENSHOT_REJECTED") && (
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <label className="text-xs font-semibold text-text-faint">
            {link.status === "SCREENSHOT_REJECTED" ? "Re-upload proof screenshot" : "Upload proof screenshot"}
          </label>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={uploadScreenshotMutation.isPending}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadScreenshotMutation.mutate(file);
              e.target.value = "";
            }}
            className="text-[0.8125rem] text-text-faint file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-2 file:text-[0.8125rem] file:font-bold file:text-accent-ink"
          />
          {uploadScreenshotMutation.isPending && <p className="text-[0.8125rem] text-text-faint">Uploading…</p>}
          {uploadScreenshotMutation.isError && (
            <ErrorNotice
              message={uploadScreenshotMutation.error instanceof ApiError ? uploadScreenshotMutation.error.message : "Couldn't upload the screenshot."}
            />
          )}
        </div>
      )}

      {isAdmin && link.status === "PENDING_SCREENSHOT_REVIEW" && (
        <div className="flex gap-2 border-t border-border pt-4">
          <Button size="sm" className="flex-1" onClick={() => reviewMutation.mutate(true)} disabled={reviewMutation.isPending}>
            Approve
          </Button>
          <Button variant="danger" size="sm" className="flex-1" onClick={() => reviewMutation.mutate(false)} disabled={reviewMutation.isPending}>
            Reject
          </Button>
        </div>
      )}
      {isAdmin && (link.status === "SCREENSHOT_APPROVED" || link.status === "INSIGHTS_PENDING") && (
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          {link.status === "INSIGHTS_PENDING" && (
            <Button size="sm" className="w-full" onClick={() => approveInsightsMutation.mutate()} disabled={approveInsightsMutation.isPending}>
              Approve insights
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            className="w-full"
            onClick={() => refreshMetricsMutation.mutate()}
            disabled={refreshMetricsMutation.isPending}
          >
            {refreshMetricsMutation.isPending ? "Refreshing…" : "Refresh metrics"}
          </Button>
          {refreshMetricsMutation.data && !refreshMetricsMutation.data.ok && (
            <p className="text-[0.8125rem] text-rose">No data found for this URL — it may be dead, private, or invalid.</p>
          )}
          {refreshMetricsMutation.data?.ok && <p className="text-[0.8125rem] font-semibold text-accent">Metrics updated.</p>}
          {refreshMetricsMutation.isError && (
            <ErrorNotice
              message={refreshMetricsMutation.error instanceof ApiError ? refreshMetricsMutation.error.message : "Couldn't refresh metrics."}
            />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Admin-only cost revision (newTask.md #10: "campaigns can have cost
 * revise ... for individual pages"). Blocked once a link is INVOICED —
 * matches the server-side guard (reject the invoice first if it genuinely
 * needs to change).
 */
function CostRevisionControl({ link, token, onChanged }: { link: Link; token: string; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [cost, setCost] = useState(link.cost);
  const [note, setNote] = useState("");

  const revisionsQuery = useQuery({
    queryKey: ["linkCostRevisions", link.id],
    queryFn: () => linksApi.costRevisions(token, link.id),
    enabled: showHistory,
  });

  const reviseMutation = useMutation({
    mutationFn: () => linksApi.reviseCost(token, link.id, Number(cost), note || undefined),
    onSuccess: () => {
      setEditing(false);
      setNote("");
      onChanged();
    },
  });

  if (link.status === "INVOICED") {
    return <p className="mt-1 text-[0.6875rem] text-text-faint">Reject the invoice to revise this link's cost.</p>;
  }

  return (
    <div className="mt-1.5">
      {editing ? (
        <div className="flex flex-col gap-2 rounded-md border border-border-strong bg-surface-2 p-2.5">
          <input
            type="number"
            min={0}
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            className="h-8 w-full rounded-md border border-border-strong bg-surface px-2.5 text-right text-[0.8125rem] text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Reason (optional)"
            className="h-8 w-full rounded-md border border-border-strong bg-surface px-2.5 text-[0.75rem] text-text placeholder:text-text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          {reviseMutation.isError && (
            <ErrorNotice message={reviseMutation.error instanceof ApiError ? reviseMutation.error.message : "Couldn't revise the cost."} />
          )}
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" className="flex-1" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button size="sm" className="flex-1" onClick={() => reviseMutation.mutate()} disabled={reviseMutation.isPending}>
              {reviseMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <button onClick={() => setEditing(true)} className="text-[0.75rem] font-semibold text-accent hover:text-accent-2">
            Revise cost
          </button>
          <button onClick={() => setShowHistory((v) => !v)} className="text-[0.75rem] text-text-faint hover:text-text-muted">
            {showHistory ? "Hide history" : "History"}
          </button>
        </div>
      )}

      {showHistory && !editing && (
        <div className="mt-2 flex flex-col gap-1.5 border-t border-border pt-2">
          {revisionsQuery.isLoading ? (
            <p className="text-[0.75rem] text-text-faint">Loading…</p>
          ) : (revisionsQuery.data?.length ?? 0) === 0 ? (
            <p className="text-[0.75rem] text-text-faint">No revisions yet.</p>
          ) : (
            revisionsQuery.data!.map((r) => (
              <div key={r.id} className="text-[0.75rem] text-text-faint">
                <span className="font-semibold text-text-muted">
                  {money(r.previousCost)} → {money(r.newCost)}
                </span>{" "}
                by {r.revisedBy?.name ?? "admin"} · {new Date(r.createdAt).toLocaleDateString()}
                {r.note && <span> — {r.note}</span>}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export const STATUS_LABEL: Record<string, string> = {
  SUBMITTED: "Submitted",
  PENDING_SCREENSHOT_REVIEW: "Screenshot submitted",
  SCREENSHOT_REJECTED: "Screenshot rejected",
  SCREENSHOT_APPROVED: "Screenshot approved",
  INSIGHTS_PENDING: "Insights pending",
  INSIGHTS_APPROVED: "Insights approved",
  INVOICED: "Invoiced",
};
