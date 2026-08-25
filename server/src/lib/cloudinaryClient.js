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
    if (err?.http_code === 404) return false;
    throw err;
  }
}

export function publicUrlFor(publicId) {
  if (!process.env.CLOUDINARY_CLOUD_NAME) return null;
  return cloudinary.url(publicId, { secure: true });
}
