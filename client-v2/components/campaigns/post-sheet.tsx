"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, Image as ImageIcon, RefreshCw, Trash2 } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { ApiError, hasAccess, links as linksApi, type Link as Post } from "@/lib/api-client";
import { POST_STATUS } from "@/lib/campaigns";
import { captionTitle, formatLabel, latestSnapshot, postThumbSrc } from "@/lib/finance";
import { personLabel } from "@/lib/format";
import { invalidateAfterPostChange } from "@/lib/queries/campaigns";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Field } from "@/components/taggify/field";
import { Money } from "@/components/taggify/money";
import { PlatformIcon } from "@/components/taggify/platform-icon";
import { StatusPill } from "@/components/taggify/status-pill";
import { ContentThumb, displayHandle } from "@/components/finance/identity";

const errText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);
const count = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-IN"));
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export type PostSheetFocus = "details" | "cost";

/**
 * One post: what it is, its latest numbers and what it costs. Staff with
 * links.edit can refresh the numbers (POST /links/:id/refresh-metrics) and
 * revise the cost with a reason (PUT /links/:id/cost); anyone with links.view
 * sees the revision history, and can delete a post that isn't on an invoice
 * or payout yet (DELETE /links/:id). Creators see the same post with "You
 * earn" and no staff tools. Opened from Campaign detail → Posts and Content.
 */
export function PostSheet({ post, focus = "details", onClose }: { post: Post | null; focus?: PostSheetFocus; onClose: () => void }) {
  return (
    <Sheet open={!!post} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-md"
        // "Revise cost…" lands in the amount field; otherwise Radix focuses the first control as usual.
        onOpenAutoFocus={(e) => {
          const target = (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>("[data-autofocus]");
          if (target) {
            e.preventDefault();
            target.focus();
          }
        }}
      >{post && <PostDetails key={post.id} post={post} focus={focus} onClose={onClose} />}</SheetContent>
    </Sheet>
  );
}

function PostDetails({ post, focus, onClose }: { post: Post; focus: PostSheetFocus; onClose: () => void }) {
  const { user, accessToken } = useAuth();
  const qc = useQueryClient();
  const staff = user?.role !== "CREATOR" && user?.role !== "TEAM_MEMBER";
  const canEdit = staff && hasAccess(user, "links.edit");
  const snap = latestSnapshot(post);
  const st = POST_STATUS[post.status];
  const title = captionTitle(snap?.caption) ?? formatLabel(post.format);
  const handle = displayHandle(post.asset?.handle ?? "—", post.asset?.platform);
  // Money is fixed once a post is on an invoice or payout: no delete then (the server refuses it too).
  const deletable = canEdit && !post.invoiceItem && !post.payoutItem && post.status !== "INVOICED";
  const [confirmDelete, setConfirmDelete] = useState(false);

  const refresh = useMutation({
    mutationFn: () => linksApi.refreshMetrics(accessToken!, post.id),
    onSuccess: async (r) => {
      await invalidateAfterPostChange(qc);
      if (r.ok) toast.success("Numbers updated.");
      else toast.error(r.reason ? `Couldn't fetch the numbers: ${r.reason}` : "Couldn't fetch the numbers. Try again later.");
    },
    onError: (e) => toast.error(errText(e, "Couldn't fetch the numbers. Try again later.")),
  });

  return (
    <>
      <SheetHeader className="gap-3 border-b p-5 text-left">
        <div className="flex items-center gap-3">
          <ContentThumb src={postThumbSrc(post)} format={post.format} size={56} />
          <div className="min-w-0">
            <SheetTitle className="truncate text-section">{title}</SheetTitle>
            <SheetDescription className="flex items-center gap-1 truncate">
              <PlatformIcon platform={post.asset?.platform ?? "instagram"} size={14} />
              {handle} · {formatLabel(post.format)}
              {post.postedAt ? ` · posted ${day(post.postedAt)}` : ""}
            </SheetDescription>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={st.tone}>{st.label}</StatusPill>
          {post.overQuota && <StatusPill tone="neutral">Over booking</StatusPill>}
          <a href={post.url} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-small font-semibold">
            Open post
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        </div>
      </SheetHeader>

      <div className="flex flex-1 flex-col gap-6 p-5">
        <section aria-labelledby="post-numbers" className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <h3 id="post-numbers" className="text-card-title">
              Numbers
            </h3>
            {canEdit && post.status !== "INVALID" && (
              <Button size="sm" variant="ghost" className="ml-auto" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
                <RefreshCw />
                {refresh.isPending ? "Refreshing…" : "Refresh"}
              </Button>
            )}
          </div>
          <dl className="grid grid-cols-3 gap-x-4 rounded-card border p-4">
            <Stat label="Views" value={count(snap?.videoViews)} />
            <Stat label="Likes" value={count(snap?.likeCount)} />
            <Stat label="Comments" value={count(snap?.commentsCount)} />
          </dl>
          <p className="text-small text-muted-foreground">{snap ? `Fetched ${day(snap.capturedAt)}.` : notFetchedNote(post.status)}</p>
        </section>

        <CostSection post={post} staff={staff} canEdit={canEdit} focus={focus} />

        {/* The title is the caption's first line; only show the caption when there's more to it. */}
        {snap?.caption && snap.caption.trim() !== title ? (
          <section aria-labelledby="post-caption" className="flex flex-col gap-2">
            <h3 id="post-caption" className="text-card-title">
              Caption
            </h3>
            <p className="line-clamp-6 whitespace-pre-line text-body text-muted-foreground">{snap.caption}</p>
          </section>
        ) : null}
      </div>

      {(post.screenshot?.url || deletable) && (
        <SheetFooter className="mt-auto flex-row flex-wrap gap-2 border-t p-5 sm:justify-start">
          {post.screenshot?.url && (
            <Button asChild variant="outline">
              <a href={post.screenshot.url} target="_blank" rel="noreferrer">
                <ImageIcon />
                View proof
              </a>
            </Button>
          )}
          {deletable && (
            <Button variant="ghost" className="ml-auto text-danger-fg hover:text-danger-fg" onClick={() => setConfirmDelete(true)}>
              <Trash2 />
              Delete post…
            </Button>
          )}
        </SheetFooter>
      )}
      {deletable && <DeletePostDialog post={post} title={title} open={confirmDelete} onCancel={() => setConfirmDelete(false)} onDeleted={onClose} />}
    </>
  );
}

/**
 * "Delete post?" — removes the post and its history for good. A post on an
 * invoice or payout never gets here; if the server still refuses (it was
 * billed meanwhile), its message is shown and the button stays off.
 */
function DeletePostDialog({ post, title, open, onCancel, onDeleted }: { post: Post; title: string; open: boolean; onCancel: () => void; onDeleted: () => void }) {
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: () => linksApi.remove(accessToken!, post.id),
    onSuccess: async () => {
      toast.success("Post deleted.");
      onDeleted();
      await invalidateAfterPostChange(qc);
    },
  });
  const cancel = () => {
    remove.reset();
    onCancel();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && cancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this post?</DialogTitle>
          <DialogDescription>
            {title} on {displayHandle(post.asset?.handle ?? "this page", post.asset?.platform)} is removed with its proof, numbers and cost history. It no longer counts toward the campaign. This can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>
        {remove.isError && (
          <p className="text-small text-danger-helper" role="alert">
            {errText(remove.error, "Couldn't delete the post. Try again.")}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={cancel}>
            Keep post
          </Button>
          <Button variant="destructive" disabled={remove.isPending || remove.isError} onClick={() => remove.mutate()}>
            {remove.isPending ? "Deleting…" : "Delete post"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The 6-hourly rescrape (server jobs/instagramRescrape.js) only picks up posts whose proof is approved. */
function notFetchedNote(status: Post["status"]) {
  if (status === "SCREENSHOT_APPROVED" || status === "INSIGHTS_PENDING") return "Not fetched yet. Numbers come in automatically every few hours.";
  if (status === "INVALID") return "Not fetched. This link is marked as broken.";
  return "Not fetched yet. Numbers start coming in once the proof is approved.";
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-label text-muted-foreground">{label}</dt>
      <dd className="num text-card-title">{value}</dd>
    </div>
  );
}

/**
 * Cost, the inline "Revise" form and the revision history. A post that's
 * already on an invoice or a payout can't be revised: that money is fixed on
 * the bill (the server blocks INVOICED; we also block a payout for the same reason).
 */
function CostSection({ post, staff, canEdit, focus }: { post: Post; staff: boolean; canEdit: boolean; focus: PostSheetFocus }) {
  const { user, accessToken } = useAuth();
  const qc = useQueryClient();
  const ref = useRef<HTMLElement>(null);
  const onInvoice = !!post.invoiceItem || post.status === "INVOICED";
  const lockedNote = onInvoice
    ? `On ${post.invoiceItem?.invoice?.invoiceNumber ?? "an invoice"}, so the cost can't change here. Reject that invoice first if it needs to.`
    : post.payoutItem
      ? "Already on a payout, so the cost can't change here."
      : null;
  const revisable = canEdit && !lockedNote && post.status !== "INVALID";
  const reviseButton = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(focus === "cost" && revisable);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const showHistory = staff && hasAccess(user, "links.view");

  useEffect(() => {
    if (focus === "cost") ref.current?.scrollIntoView({ block: "start" });
  }, [focus]);

  const revisions = useQuery({
    queryKey: ["links", post.id, "cost-revisions"],
    queryFn: () => linksApi.costRevisions(accessToken!, post.id),
    enabled: showHistory && !!accessToken,
  });

  const current = Number(post.cost);
  const trimmed = amount.trim();
  const amountError = trimmed && !/^\d+$/.test(trimmed) ? "Enter a whole amount in rupees." : trimmed.length > 7 ? "That's more than ₹99,99,999. Check the amount." : trimmed && Number(trimmed) === current ? "That's the current cost." : null;
  const ready = !!trimmed && !amountError && !!note.trim();

  // The form unmounts with focus inside it; once "Revise cost" is back on screen, focus it.
  const [refocus, setRefocus] = useState(false);
  useEffect(() => {
    if (refocus && !editing) {
      reviseButton.current?.focus();
      setRefocus(false);
    }
  }, [refocus, editing]);
  const closeForm = () => {
    setEditing(false);
    setRefocus(true);
  };

  const revise = useMutation({
    mutationFn: () => linksApi.reviseCost(accessToken!, post.id, Number(trimmed), note.trim()),
    onSuccess: async () => {
      await Promise.all([invalidateAfterPostChange(qc), qc.invalidateQueries({ queryKey: ["invoices"] })]);
      toast.success("Cost revised.");
      closeForm();
      setAmount("");
      setNote("");
    },
  });

  return (
    <section ref={ref} aria-labelledby="post-cost" className="flex scroll-mt-5 flex-col gap-3">
      <div className="flex items-center gap-2">
        <h3 id="post-cost" className="text-card-title">
          {staff ? "Cost" : "You earn"}
        </h3>
        <Money value={post.cost} className="ml-auto text-card-title" />
      </div>

      {canEdit && lockedNote && <p className="text-small text-muted-foreground">{lockedNote}</p>}

      {revisable &&
        (editing ? (
          <div className="flex flex-col gap-3 rounded-card border p-4">
            <Field label="New cost (₹)" error={amountError}>
              {(a) => <Input {...a} inputMode="numeric" data-autofocus placeholder={String(current)} value={amount} onChange={(e) => setAmount(e.target.value)} />}
            </Field>
            <Field label="Reason (required)" description="Shown in the history below, for whoever checks this later.">
              {(a) => <Input {...a} placeholder="e.g. Extra story added on request" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />}
            </Field>
            {revise.isError && (
              <p className="text-small text-danger-helper" role="alert">
                {errText(revise.error, "Couldn't revise the cost. Try again.")}
              </p>
            )}
            <div className="flex gap-2">
              <Button disabled={!ready || revise.isPending} onClick={() => revise.mutate()}>
                {revise.isPending ? "Saving…" : "Save new cost"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  closeForm();
                  revise.reset();
                  setAmount("");
                  setNote("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button ref={reviseButton} variant="outline" className="self-start" onClick={() => setEditing(true)}>
            Revise cost
          </Button>
        ))}

      {showHistory && (
        <div className="flex flex-col gap-2">
          <h4 className="text-label text-muted-foreground">History</h4>
          {revisions.isLoading ? (
            <Skeleton className="h-12 w-full" />
          ) : revisions.isError ? (
            <p className="text-small text-muted-foreground">Couldn&apos;t load the history.</p>
          ) : (revisions.data?.length ?? 0) === 0 ? (
            <p className="text-small text-muted-foreground">Unchanged since it was submitted.</p>
          ) : (
            <ol className="flex flex-col divide-y rounded-card border">
              {revisions.data!.map((r) => (
                <li key={r.id} className="flex flex-col gap-1 px-3 py-2">
                  <span className="flex items-center gap-2 text-body-strong">
                    <Money value={r.previousCost} className="text-muted-foreground line-through" />
                    <span aria-hidden>→</span>
                    <span className="sr-only">changed to</span>
                    <Money value={r.newCost} />
                  </span>
                  {r.note && <span className="text-body">{r.note}</span>}
                  <span className="text-small text-fg-muted">
                    {personLabel(r.revisedBy, "Someone")} · {day(r.createdAt)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
