"use client";

import { useRef } from "react";
import { useMutation } from "@tanstack/react-query";

import { invoices as invoicesApi, ApiError } from "@/lib/api-client";
import { UploadIcon } from "@/components/icons";

/**
 * Finance backfilling proof of payment onto a legacy standalone-paid invoice
 * (28 Sep fix) — one paid before the direct mark-paid path was removed, so it
 * never went through PaySheet's mandatory receipt upload. Same direct-to-
 * Cloudinary two-step as every other attachment in the app.
 */
export function InvoiceReceiptUpload({ token, invoiceId, onUploaded }: { token: string; invoiceId: string; onUploaded: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const params = await invoicesApi.requestReceiptUpload(token, invoiceId);
      const form = new FormData();
      form.append("file", file);
      form.append("api_key", params.apiKey);
      form.append("timestamp", String(params.timestamp));
      form.append("signature", params.signature);
      form.append("public_id", params.publicId);
      const res = await fetch(params.uploadUrl, { method: "POST", body: form });
      if (!res.ok) throw new Error("The receipt upload was rejected — check the file and try again.");
      return invoicesApi.confirmReceipt(token, invoiceId, params.publicId, file.name);
    },
    onSuccess: onUploaded,
  });

  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <button
        type="button"
        disabled={upload.isPending}
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center gap-1 text-[0.75rem] font-semibold text-blue hover:underline disabled:opacity-50"
      >
        <UploadIcon className="h-3.5 w-3.5" /> {upload.isPending ? "Uploading…" : "Attach receipt"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf,image/*"
        aria-label="Invoice payment receipt"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) upload.mutate(file);
        }}
      />
      {upload.isError && (
        <span className="text-[0.72rem] text-rose">{upload.error instanceof ApiError || upload.error instanceof Error ? upload.error.message : "Upload failed."}</span>
      )}
    </span>
  );
}
