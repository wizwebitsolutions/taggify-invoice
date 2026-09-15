"use client";

import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { cn } from "@/lib/utils";
import { ErrorNotice } from "@/components/ui/table-parts";
import { CloseIcon, DownloadIcon, LinkIcon } from "@/components/icons";
import { invoices as invoicesApi, ApiError, type Invoice } from "@/lib/api-client";

const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * "Attach invoice" (user request, 12 Sep): the creator's own invoice
 * document (their GST invoice PDF/image) kept on the Invoice record so
 * Finance sees it next to the system-generated one. Used by the Invoices
 * page's detail panel and the campaign page's invoice rows — one
 * component so the two can't diverge. Same direct-to-Cloudinary two-step
 * as the screenshot upload in link-detail-panel.tsx.
 *
 * `compact` renders a one-line variant for a table row.
 */
export function InvoiceAttachmentControl({ token, invoice, compact = false }: { token: string; invoice: Invoice; compact?: boolean }) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const frozen = invoice.status === "PAID";
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["invoices"] });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > MAX_BYTES) throw new Error("That file is over 10 MB — attach a smaller PDF or image.");
      const params = await invoicesApi.requestAttachmentUpload(token, invoice.id);
      // Only the signed fields may be sent, or Cloudinary rejects it (see
      // server/src/lib/cloudinaryClient.js's getUploadParams).
      const form = new FormData();
      form.append("file", file);
      form.append("api_key", params.apiKey);
      form.append("timestamp", String(params.timestamp));
      form.append("signature", params.signature);
      form.append("public_id", params.publicId);
      const uploadRes = await fetch(params.uploadUrl, { method: "POST", body: form });
      if (!uploadRes.ok) throw new Error("The upload was rejected — check the file and try again.");
      return invoicesApi.confirmAttachment(token, invoice.id, params.publicId, file.name);
    },
    onSuccess: refresh,
  });
  const removeMutation = useMutation({ mutationFn: () => invoicesApi.removeAttachment(token, invoice.id), onSuccess: refresh });

  const busy = uploadMutation.isPending || removeMutation.isPending;
  const error = uploadMutation.error ?? removeMutation.error;
  const attachment = invoice.attachment;

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept={ACCEPT}
      hidden
      aria-label={`Attach invoice file for ${invoice.invoiceNumber}`}
      disabled={busy || frozen}
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) uploadMutation.mutate(file);
        e.target.value = "";
      }}
    />
  );

  if (compact) {
    return (
      <span className="flex items-center gap-1.5" data-testid={`invoice-attachment-${invoice.id}`}>
        {fileInput}
        {attachment ? (
          <a
            href={attachment.url ?? undefined}
            target="_blank"
            rel="noreferrer"
            title={attachment.name}
            className="flex max-w-[160px] items-center gap-1 truncate rounded-full bg-surface-2 px-2 py-0.5 text-[0.6875rem] font-semibold text-text-muted ring-1 ring-inset ring-border hover:text-text"
          >
            <LinkIcon className="h-3 w-3 shrink-0" />
            <span className="truncate">{attachment.name}</span>
          </a>
        ) : (
          !frozen && (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold text-text-faint ring-1 ring-inset ring-border hover:text-text disabled:opacity-50"
            >
              {uploadMutation.isPending ? "Uploading…" : "+ Attach invoice"}
            </button>
          )
        )}
        {error && <span className="text-[0.6875rem] text-rose">{error instanceof ApiError || error instanceof Error ? error.message : "Failed."}</span>}
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3.5" data-testid={`invoice-attachment-${invoice.id}`}>
      {fileInput}
      <p className="text-[0.625rem] font-semibold uppercase tracking-[0.06em] text-text-faint">Creator's invoice document</p>
      {attachment ? (
        <div className={cn("flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2", frozen && "opacity-80")}>
          <a href={attachment.url ?? undefined} target="_blank" rel="noreferrer" className="flex min-w-0 flex-1 items-center gap-2 text-[0.8125rem] font-semibold text-blue hover:text-text">
            <DownloadIcon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{attachment.name}</span>
          </a>
          {!frozen && (
            <>
              <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} className="text-[0.75rem] font-semibold text-text-faint hover:text-text disabled:opacity-50">
                Replace
              </button>
              <button
                type="button"
                onClick={() => removeMutation.mutate()}
                disabled={busy}
                aria-label="Remove attached invoice"
                className="flex h-6 w-6 items-center justify-center rounded-md text-text-faint hover:bg-rose-soft hover:text-rose disabled:opacity-50"
              >
                <CloseIcon className="h-3 w-3" />
              </button>
            </>
          )}
        </div>
      ) : frozen ? (
        <p className="text-[0.8125rem] text-text-faint">None attached.</p>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="flex items-center justify-center gap-2 rounded-md border border-dashed border-border-strong px-3 py-2.5 text-[0.8125rem] font-semibold text-text-muted hover:border-accent/50 hover:text-text disabled:opacity-50"
        >
          <LinkIcon className="h-3.5 w-3.5" />
          {uploadMutation.isPending ? "Uploading…" : "Attach the creator's invoice (PDF or image)"}
        </button>
      )}
      {error && <ErrorNotice message={error instanceof ApiError || error instanceof Error ? error.message : "Couldn't update the attachment."} />}
    </div>
  );
}
