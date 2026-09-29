import { v2 as cloudinary } from "cloudinary";
import { randomUUID } from "node:crypto";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

export function buildScreenshotKey(linkId) {
  // Cloudinary public_ids carry no file extension — format is inferred from the upload.
  return `screenshots/${linkId}/${randomUUID()}`;
}

/** The creator's own invoice document attached to an Invoice (12 Sep) — same one-folder-per-record layout as screenshots. */
export function buildInvoiceAttachmentKey(invoiceId) {
  return `invoice-attachments/${invoiceId}/${randomUUID()}`;
}

/**
 * A PDF invoice document attached to a Plan by Admin / Plan Maker (14 Sep) —
 * same layout, its own folder. Ops note: this one is PDF-only, and
 * Cloudinary serves PDFs only when "PDF and ZIP files delivery" is enabled
 * under Settings → Security on the account — upload + confirm succeed
 * regardless, but the delivered link 401s until that's switched on.
 */
export function buildPlanInvoiceAttachmentKey(planId) {
  return `plan-invoice-attachments/${planId}/${randomUUID()}`;
}

/** The proof-of-payment receipt Finance attaches to a Payout (tasks.md #5, 23 Sep) — same one-folder-per-record layout as the others. */
export function buildPayoutReceiptKey(payoutId) {
  return `payout-receipts/${payoutId}/${randomUUID()}`;
}

/** Finance backfilling a proof-of-payment receipt directly onto an invoice paid without a Payout (legacy direct-mark-paid rows) — same layout. */
export function buildInvoiceReceiptKey(invoiceId) {
  return `invoice-receipts/${invoiceId}/${randomUUID()}`;
}

/**
 * Returns a short-lived signed upload payload so the client uploads the
 * binary directly to Cloudinary — the API server never touches the file bytes.
 */
export function getUploadParams(publicId) {
  const timestamp = Math.round(Date.now() / 1000);
  const signature = cloudinary.utils.api_sign_request(
    { public_id: publicId, timestamp },
    process.env.CLOUDINARY_API_SECRET
  );

  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload`,
    apiKey: process.env.CLOUDINARY_API_KEY,
    timestamp,
    signature,
    publicId,
  };
}

/**
 * Confirms an object actually landed in Cloudinary before trusting a
 * client's "I uploaded it" claim.
 */
export async function objectExists(publicId) {
  try {
    await cloudinary.api.resource(publicId);
    return true;
  } catch (err) {
    // The Admin API SDK rejects with `{ error: { message, http_code } }`
    // (nested), not a bare `http_code` — found driving the plan invoice
    // attachment for real (14 Sep): a confirm for a key nothing had landed
    // at came back 500 instead of the intended 422 UPLOAD_NOT_FOUND.
    if (err?.http_code === 404 || err?.error?.http_code === 404) return false;
    throw err;
  }
}

/**
 * A page's Instagram profile picture, stored so it outlives Instagram's
 * expiring CDN links (user request, 22 Sep — "pages profile pic should be
 * stored"). One fixed public_id per page, overwritten on every re-scrape,
 * so a page never accumulates old pictures. Returns the delivery URL.
 */
export function uploadProfilePic(assetId, buffer) {
  if (!process.env.CLOUDINARY_CLOUD_NAME) return Promise.reject(new Error("Cloudinary isn't configured"));
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      // secure_url is versioned, so a re-upload is picked up without a CDN invalidation.
      { public_id: `profile-pics/${assetId}`, overwrite: true, resource_type: "image" },
      (err, result) => (err ? reject(err) : resolve(result.secure_url))
    );
    stream.end(buffer);
  });
}

export function isCloudinaryConfigured() {
  return Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
}

export function publicUrlFor(publicId) {
  if (!process.env.CLOUDINARY_CLOUD_NAME) return null;
  return cloudinary.url(publicId, { secure: true });
}
