"use client";

import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { CloseIcon, DownloadIcon, LinkIcon } from "@/components/icons";
import { plans as plansApi, ApiError, type Plan } from "@/lib/api-client";

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Plan card → "Attach invoice (PDF)" (user request, 14 Sep — "in plans for
 * admin, plan maker side, there'll be option of attaching invoice document
 * in pdf format as well"). A PDF the Admin / Plan Maker keeps on the plan
 * next to the generated client invoice — the signed copy, or one raised
 * outside the system. Same direct-to-Cloudinary two-step as
 * components/invoices/invoice-attachment.tsx (upload-url → upload →
 * confirm); PDF-only is checked here on type/name and again server-side
 * on the file name (plans/schemas.js).
 *
 * `plan` only needs id/name/invoiceAttachment — narrowed (23 Sep) so the
 * Payments tab's receivables rows (which carry a ClientInvoice's slimmer
 * `plan` shape, not a full Plan) can reuse this control too.
 */
export function PlanInvoiceAttachmentControl({ token, plan }: { token: string; plan: Pick<Plan, "id" | "name" | "invoiceAttachment"> }) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  // Also invalidates client-invoices (23 Sep) — the Payments tab's
  // receivables view renders this control on a ClientInvoice row, a
  // separate cache entry from ["plans"], and needs to pick up the change too.
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["plans"] });
    queryClient.invalidateQueries({ queryKey: ["client-invoices"] });
  };

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      if (!isPdf) throw new Error("Only PDF files can be attached as the invoice document.");
      if (file.size > MAX_BYTES) throw new Error("That file is over 10 MB — attach a smaller PDF.");
      const params = await plansApi.requestInvoiceAttachmentUpload(token, plan.id);
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
      return plansApi.confirmInvoiceAttachment(token, plan.id, params.publicId, file.name);
    },
    onSuccess: refresh,
  });
  const removeMutation = useMutation({ mutationFn: () => plansApi.removeInvoiceAttachment(token, plan.id), onSuccess: refresh });

  const busy = uploadMutation.isPending || removeMutation.isPending;
  const error = uploadMutation.error ?? removeMutation.error;
  const attachment = plan.invoiceAttachment;

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={`plan-invoice-attachment-${plan.id}`}>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        aria-label={`Attach invoice PDF for ${plan.name}`}
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) uploadMutation.mutate(file);
          e.target.value = "";
        }}
      />
      {attachment ? (
        <>
          <a
            href={attachment.url ?? undefined}
            target="_blank"
            rel="noreferrer"
            title={attachment.name}
            className="inline-flex max-w-[220px] items-center gap-1 truncate rounded-full bg-surface-2 px-2.5 py-1 text-[0.6875rem] font-semibold text-text-muted ring-1 ring-inset ring-border transition-colors hover:bg-border hover:text-text"
          >
            <DownloadIcon className="h-3 w-3 shrink-0" />
            <span className="truncate">{attachment.name}</span>
          </a>
          <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} className="text-[0.6875rem] font-semibold text-text-faint hover:text-text disabled:opacity-50">
            {uploadMutation.isPending ? "Uploading…" : "Replace"}
          </button>
          <button
            type="button"
            onClick={() => removeMutation.mutate()}
            disabled={busy}
            aria-label={`Remove attached invoice for ${plan.name}`}
            className="flex h-5 w-5 items-center justify-center rounded-full text-text-faint hover:bg-rose-soft hover:text-rose disabled:opacity-50"
          >
            <CloseIcon className="h-3 w-3" />
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="inline-flex w-fit items-center gap-1 rounded-full border border-dashed border-border-strong px-2.5 py-1 text-[0.6875rem] font-semibold text-text-muted transition-colors hover:border-accent/50 hover:text-text disabled:opacity-50"
        >
          <LinkIcon className="h-3 w-3" />
          {uploadMutation.isPending ? "Uploading…" : "Attach invoice (PDF)"}
        </button>
      )}
      {error && <span className="basis-full text-[0.6875rem] text-rose">{error instanceof ApiError || error instanceof Error ? error.message : "Couldn't update the attached invoice."}</span>}
    </div>
  );
}
