"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { ApiError, hasAccess, links as linksApi, type Link as Post } from "@/lib/api-client";
import { POST_STATUS } from "@/lib/campaigns";
import { invalidateAfterPostChange } from "@/lib/queries/campaigns";
import { cn } from "@/lib/utils";
import { badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusPill } from "@/components/taggify/status-pill";

const errText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);

/**
 * A post's status pill that doubles as its status menu (design-fix #6, 7 Oct).
 * It only offers the next forward step the server allows, with the same
 * endpoints and permissions as Approvals: proof in review → approve / reject
 * (links.approve), insights in review → approve (links.approve), and "Mark as
 * broken" (links.edit) for anything not yet billed. With no step to take it
 * is a plain pill. Never skips or reverses a step.
 */
export function PostStatusMenu({ post, onMarkBroken }: { post: Post; onMarkBroken: (post: Post) => void }) {
  const { user, accessToken } = useAuth();
  const qc = useQueryClient();
  const [rejecting, setRejecting] = useState(false);
  const st = POST_STATUS[post.status];

  const canReview = hasAccess(user, "links.approve");
  // A post already on an invoice or payout has been billed; marking it broken would leave that money unexplained.
  const canBreak = hasAccess(user, "links.edit") && post.status !== "INVALID" && post.status !== "INVOICED" && !post.invoiceItem && !post.payoutItem;
  const proofStep = canReview && post.status === "PENDING_SCREENSHOT_REVIEW";
  const insightsStep = canReview && post.status === "INSIGHTS_PENDING";

  const act = useMutation({
    mutationFn: ({ kind, note }: { kind: "approve-proof" | "reject-proof" | "approve-insights"; note?: string }) =>
      kind === "approve-insights" ? linksApi.approveInsights(accessToken!, post.id) : linksApi.reviewScreenshot(accessToken!, post.id, kind === "approve-proof", note),
    onSuccess: async (_r, { kind }) => {
      setRejecting(false);
      toast.success(kind === "approve-proof" ? "Proof approved." : kind === "reject-proof" ? "Proof rejected. The creator will upload a new screenshot." : "Insights approved. The post is verified.");
      await invalidateAfterPostChange(qc);
    },
    onError: (e) => toast.error(errText(e, "That didn't go through. Try again.")),
  });

  if (!proofStep && !insightsStep && !canBreak) return <StatusPill tone={st.tone}>{st.label}</StatusPill>;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Status: ${st.label}. Change status`}
          disabled={act.isPending}
          className={cn(badgeVariants({ variant: st.tone }), "cursor-pointer gap-1 focus:outline-none focus-visible:shadow-focus disabled:opacity-60")}
        >
          {st.label}
          <ChevronDown className="h-3 w-3" strokeWidth={2.4} aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {proofStep && (
            <>
              <DropdownMenuItem onSelect={() => act.mutate({ kind: "approve-proof" })}>Approve proof</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setRejecting(true)}>Reject proof…</DropdownMenuItem>
            </>
          )}
          {insightsStep && <DropdownMenuItem onSelect={() => act.mutate({ kind: "approve-insights" })}>Approve insights</DropdownMenuItem>}
          {(proofStep || insightsStep) && canBreak && <DropdownMenuSeparator />}
          {canBreak && (
            <DropdownMenuItem className="text-danger focus:text-danger" onSelect={() => onMarkBroken(post)}>
              Mark as broken…
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <RejectProofDialog open={rejecting} busy={act.isPending} onClose={() => setRejecting(false)} onReject={(note) => act.mutate({ kind: "reject-proof", note })} />
    </>
  );
}

function RejectProofDialog({ open, busy, onClose, onReject }: { open: boolean; busy: boolean; onClose: () => void; onReject: (note: string) => void }) {
  const [note, setNote] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setNote("");
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject this proof?</DialogTitle>
          <DialogDescription>The creator sees your reason and uploads a new screenshot.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="reject-proof-note">Reason for the creator</Label>
          <Input id="reject-proof-note" placeholder="e.g. Screenshot is cut off. Show the full post." value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Keep it
          </Button>
          <Button variant="destructive" disabled={busy || !note.trim()} onClick={() => onReject(note.trim())}>
            Reject
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
