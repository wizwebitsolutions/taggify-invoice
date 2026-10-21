/**
 * Invoice documents attached by hand: a creator's own GST invoice on their
 * Invoice, and the client invoice file on a Plan. Same rules as v1
 * (client/components/invoices/invoice-attachment.tsx): PDF or image, up to 10 MB,
 * uploaded straight to Cloudinary with the API's signed fields, then confirmed.
 */
export const ATTACHMENT_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";
/** A plan's client invoice: PDF only (server plans/schemas.js checks the file name ends in .pdf). */
export const PDF_ACCEPT = "application/pdf,.pdf";
export type AttachmentKind = "pdf-or-image" | "pdf";
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

export type Attachment = { name: string; url: string | null; uploadedAt: string | null } | null | undefined;
export type SignedUpload = { uploadUrl: string; apiKey: string; timestamp: number; signature: string; publicId: string };

/** Null when the file is fine, otherwise what's wrong and how to fix it. */
export function attachmentProblem(file: File, kind: AttachmentKind = "pdf-or-image"): string | null {
  if (kind === "pdf" && !/\.pdf$/i.test(file.name)) return `${file.name} isn't a PDF. Attach the client invoice as a PDF.`;
  if (kind === "pdf-or-image" && !ATTACHMENT_ACCEPT.split(",").includes(file.type)) return `${file.name} isn't a PDF or image. Attach the invoice as a PDF, JPG, PNG or WebP.`;
  if (file.size > ATTACHMENT_MAX_BYTES) return `${file.name} is over 10 MB. Attach a smaller copy.`;
  return null;
}

/** Sends only the signed fields, or Cloudinary rejects the upload (server lib/cloudinaryClient.js getUploadParams). */
export async function uploadSigned(params: SignedUpload, file: File) {
  const form = new FormData();
  form.append("file", file);
  form.append("api_key", params.apiKey);
  form.append("timestamp", String(params.timestamp));
  form.append("signature", params.signature);
  form.append("public_id", params.publicId);
  const res = await fetch(params.uploadUrl, { method: "POST", body: form });
  if (!res.ok) throw new Error("The upload didn't go through. Check the file and try again.");
  return params.publicId;
}
