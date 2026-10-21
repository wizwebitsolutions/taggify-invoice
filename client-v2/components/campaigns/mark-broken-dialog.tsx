"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth-context";
import { ApiError, links as linksApi, type Link as Post } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const errText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);

/** "Mark as broken" (POST /links/:id/mark-invalid, links.edit): the post stays on record but stops counting toward spend and payouts. */
export function MarkBrokenDialog({ post, onClose, onDone }: { post: Post | null; onClose: () => void; onDone: () => Promise<unknown> }) {
  const { accessToken } = useAuth();
  const [note, setNote] = useState("");
  const mark = useMutation({
    mutationFn: () => linksApi.markInvalid(accessToken!, post!.id, note.trim()),
    onSuccess: async () => {
      await onDone();
      toast.success("Marked as broken. It no longer counts toward spend or payouts.");
      setNote("");
      onClose();
    },
  });
  return (
    <Dialog open={!!post} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark this post as broken?</DialogTitle>
          <DialogDescription>Use this when the link no longer works. The post stays on record but stops counting toward spend, invoices and payouts.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="broken-note">What&apos;s wrong</Label>
          <Input id="broken-note" placeholder="e.g. Post deleted, link shows 'page not found'" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {mark.isError && (
          <p className="text-small text-danger-helper" role="alert">
            {errText(mark.error, "Couldn't mark it. Try again.")}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Keep as is
          </Button>
          <Button variant="destructive" disabled={!note.trim() || mark.isPending} onClick={() => mark.mutate()}>
            Mark as broken
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
