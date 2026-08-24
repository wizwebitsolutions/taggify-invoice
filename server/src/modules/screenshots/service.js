import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../middleware/errorHandler.js";
import { buildScreenshotKey, getUploadUrl, objectExists, publicUrlFor } from "../../lib/r2Client.js";
import { markPendingScreenshotReview } from "../links/service.js";

const EXT_BY_CONTENT_TYPE = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/**
 * Step 1: client asks for somewhere to upload. Server mints the object key
 * itself (never trusts a client-supplied path) and returns a short-lived
 * pre-signed PUT URL — the binary goes straight to R2, never through this API.
 */
export async function requestUploadUrl(linkId, contentType) {
  const link = await prisma.link.findUnique({ where: { id: linkId } });
  if (!link) throw new ApiError(404, "LINK_NOT_FOUND", "Link not found");

  const extension = EXT_BY_CONTENT_TYPE[contentType] ?? "jpg";
  const r2Key = buildScreenshotKey(linkId, extension);
  const uploadUrl = await getUploadUrl(r2Key, contentType);

  return { uploadUrl, r2Key };
}

/**
 * Step 2: client confirms the upload finished. Server verifies the object
 * actually exists in R2 before trusting the claim, then records the
 * Screenshot row and moves the Link into review.
 */
export async function confirmUpload(linkId, r2Key) {
  const link = await prisma.link.findUnique({ where: { id: linkId } });
  if (!link) throw new ApiError(404, "LINK_NOT_FOUND", "Link not found");
  if (!r2Key.startsWith(`screenshots/${linkId}/`)) {
    throw new ApiError(400, "KEY_MISMATCH", "Object key does not belong to this link");
  }

  const exists = await objectExists(r2Key);
  if (!exists) {
    throw new ApiError(422, "UPLOAD_NOT_FOUND", "No object found at that key — upload may not have completed");
  }

  const screenshot = await prisma.screenshot.upsert({
    where: { linkId },
    create: { linkId, r2Key },
    update: { r2Key, approved: null, reviewedById: null },
  });

  await markPendingScreenshotReview(linkId);

  return { ...screenshot, url: publicUrlFor(r2Key) };
}
