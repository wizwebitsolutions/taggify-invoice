import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../middleware/errorHandler.js";
import { buildScreenshotKey, getUploadParams, objectExists, publicUrlFor } from "../../lib/cloudinaryClient.js";
import { markPendingScreenshotReview } from "../links/service.js";
import { ALREADY_INVOICED } from "../links/statusTimeline.js";
import { assertCanActOnPage } from "../../lib/pageOwnership.js";

/**
 * Step 1: client asks for somewhere to upload. Server mints the public_id
 * itself (never trusts a client-supplied path) and returns a short-lived
 * signed upload payload — the binary goes straight to Cloudinary, never
 * through this API.
 */
export async function requestUploadUrl(linkId, user) {
  const link = await prisma.link.findUnique({ where: { id: linkId }, include: { asset: { select: { ownerId: true } } } });
  if (!link) throw new ApiError(404, "LINK_NOT_FOUND", "Link not found");
  // Only the page's own creator (or their team member) — 24 Sep.
  await assertCanActOnPage(user, link.asset);
  // Told before the upload, not after (the status move in step 2 would refuse anyway).
  if (link.status === "INVOICED") throw ALREADY_INVOICED("upload a screenshot for it");

  const publicId = buildScreenshotKey(linkId);
  return getUploadParams(publicId);
}

/**
 * Step 2: client confirms the upload finished. Server verifies the object
 * actually exists in Cloudinary before trusting the claim, then records the
 * Screenshot row and moves the Link into review.
 */
export async function confirmUpload(linkId, publicId, user) {
  const link = await prisma.link.findUnique({ where: { id: linkId }, include: { asset: { select: { ownerId: true } } } });
  if (!link) throw new ApiError(404, "LINK_NOT_FOUND", "Link not found");
  await assertCanActOnPage(user, link.asset);
  // The invoice may have been raised between step 1 and step 2 — checked
  // again here, before the screenshot row is replaced / its approval reset.
  if (link.status === "INVOICED") throw ALREADY_INVOICED("upload a screenshot for it");
  if (!publicId.startsWith(`screenshots/${linkId}/`)) {
    throw new ApiError(400, "KEY_MISMATCH", "Object key does not belong to this link");
  }

  const exists = await objectExists(publicId);
  if (!exists) {
    throw new ApiError(422, "UPLOAD_NOT_FOUND", "No object found at that key — upload may not have completed");
  }

  const screenshot = await prisma.screenshot.upsert({
    where: { linkId },
    create: { linkId, publicId },
    update: { publicId, approved: null, reviewedById: null },
  });

  await markPendingScreenshotReview(linkId);

  return { ...screenshot, url: publicUrlFor(publicId) };
}
