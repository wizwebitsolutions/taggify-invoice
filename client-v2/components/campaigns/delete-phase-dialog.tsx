"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth-context";
import { ApiError, campaigns as campaignsApi } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const errText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);

export type PhaseRef = { id: string; phaseNumber: number };

/**
 * "Delete phase N" (DELETE /campaigns/:id/phase, campaigns.edit). Phase 1 is
 * the campaign itself and is never offered. The server refuses a phase that
 * has posts or invoices and says how many; that message is shown as is.
 * Later phases move up a number. Deleting the phase you're on takes you to phase 1.
 */
export function DeletePhaseDialog({ phase, viewingId, onClose }: { phase: PhaseRef | null; viewingId: string; onClose: () => void }) {
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  // A refusal (posts or invoices on the phase) won't change on retry, so the error stays until the dialog closes.
  const close = () => {
    remove.reset();
    onClose();
  };
  const remove = useMutation({
    mutationFn: () => campaignsApi.deletePhase(accessToken!, phase!.id),
    onSuccess: async ({ rootId }) => {
      const wasViewing = phase!.id === viewingId;
      toast.success(`Phase ${phase!.phaseNumber} deleted.`);
      close();
      if (wasViewing) router.replace(`/campaigns/${rootId}`);
      await Promise.all([qc.invalidateQueries({ queryKey: ["campaigns"] }), qc.invalidateQueries({ queryKey: ["links"] })]);
    },
  });

  return (
    <Dialog open={!!phase} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete phase {phase?.phaseNumber}?</DialogTitle>
          <DialogDescription>
            The phase and its bookings are removed, and any later phases move up a number. This can&apos;t be undone. A phase with posts or invoices can&apos;t be deleted: delete its posts first from each post&apos;s details (invoiced posts can&apos;t be deleted).
          </DialogDescription>
        </DialogHeader>
        {remove.isError && (
          <p className="text-small text-danger-helper" role="alert">
            {errText(remove.error, "Couldn't delete the phase. Try again.")}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Keep phase
          </Button>
          <Button variant="destructive" disabled={remove.isPending || remove.isError} onClick={() => remove.mutate()}>
            {remove.isPending ? "Deleting…" : `Delete phase ${phase?.phaseNumber ?? ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
