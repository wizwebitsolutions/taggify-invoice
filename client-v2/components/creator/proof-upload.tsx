"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ImageUp, X } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { ApiError, links as linksApi, type Link } from "@/lib/api-client";
import { captionTitle, formatLabel, latestSnapshot } from "@/lib/finance";
import { invalidateCreator, proofProblem, uploadProof } from "@/lib/queries/creator";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** File picker for a proof screenshot (drag-drop or tap), with the size/type check. */
export function ProofPicker({ file, onFile, error, onError }: { file: File | null; onFile: (f: File | null) => void; error: string | null; onError: (e: string | null) => void }) {
  // One preview URL per chosen file, released when it changes.
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);
  function pick(f?: File) {
    if (!f) return;
    const problem = proofProblem(f);
    onError(problem);
    if (!problem) onFile(f);
  }
  return (
    <div className="flex flex-col gap-2">
      {file ? (
        <div className="flex items-center gap-3 rounded-lg border p-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- local preview of the chosen screenshot */}
          <img src={preview ?? undefined} alt="" className="h-16 w-12 rounded-sm object-cover" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body-strong">{file.name}</span>
            <span className="text-small text-fg-muted">{Math.max(1, Math.round(file.size / 1024))} KB</span>
          </span>
          <Button variant="ghost" size="icon" aria-label="Remove screenshot" onClick={() => onFile(null)}>
            <X />
          </Button>
        </div>
      ) : (
        <label
          className="flex cursor-pointer flex-col items-center gap-1 rounded-lg border-2 border-dashed border-dropzone-line bg-dropzone px-4 py-6 text-center transition-colors hover:border-brand focus-within:border-brand"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            pick(e.dataTransfer.files[0]);
          }}
        >
          <ImageUp className="h-6 w-6" aria-hidden />
          <span className="text-body-strong">Add the screenshot</span>
          <span className="text-small text-fg-muted">Show the full post with its likes and views · PNG or JPG, up to 8 MB</span>
          <input type="file" accept="image/*" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
        </label>
      )}
      {error && (
        <p className="text-small text-danger-helper" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** "Fix proof": re-upload the screenshot for a post whose proof was rejected (or never added). */
export function FixProofDialog({ post, onClose }: { post: Link | null; onClose: () => void }) {
  const { accessToken } = useAuth();
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const upload = useMutation({
    mutationFn: () => uploadProof(accessToken!, post!.id, file!),
    onSuccess: async () => {
      await invalidateCreator(qc);
      toast.success("Proof uploaded. It's back in review.");
      close();
    },
  });
  function close() {
    setFile(null);
    setError(null);
    upload.reset();
    onClose();
  }
  // A different post never inherits the last one's screenshot.
  useEffect(() => {
    setFile(null);
    setError(null);
  }, [post?.id]);
  const title = post ? captionTitle(latestSnapshot(post)?.caption) ?? `${formatLabel(post.format)} on ${post.campaign?.title ?? "the campaign"}` : "";
  // The reviewer's reason lives on the post's status history.
  const timeline = useQuery({
    queryKey: ["links", "timeline", post?.id],
    queryFn: () => linksApi.timeline(accessToken!, post!.id),
    enabled: !!accessToken && post?.status === "SCREENSHOT_REJECTED",
  });
  const reason = [...(timeline.data ?? [])].reverse().find((e) => e.status === "SCREENSHOT_REJECTED" && e.note)?.note;
  return (
    <Dialog
      open={!!post}
      onOpenChange={(o) => {
        if (!o) close();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{post?.status === "SCREENSHOT_REJECTED" ? "Upload a new proof" : "Add the proof"}</DialogTitle>
          <DialogDescription>{title}</DialogDescription>
        </DialogHeader>
        {reason && <p className="rounded-md bg-danger-soft px-3 py-2 text-small text-danger-fg">Why it was rejected: {reason}</p>}
        <ProofPicker file={file} onFile={setFile} error={error} onError={setError} />
        {upload.isError && (
          <p className="text-small text-danger-helper" role="alert">
            {upload.error instanceof ApiError || upload.error instanceof Error ? upload.error.message : "The upload didn't go through. Try again."}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button disabled={!file || upload.isPending} onClick={() => upload.mutate()}>
            {upload.isPending ? "Uploading…" : "Upload proof"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
