import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";

// Cloudflare R2 is S3-compatible, so the AWS SDK v3 S3Client works as-is
// pointed at the account's R2 endpoint.
const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME;
const UPLOAD_URL_TTL_SECONDS = 5 * 60; // short-lived, single-object-scoped

export function buildScreenshotKey(linkId, extension = "jpg") {
  return `screenshots/${linkId}/${randomUUID()}.${extension}`;
}

/**
 * Returns a short-lived pre-signed PUT URL so the client uploads the binary
 * directly to R2 — the API server never touches the file bytes.
 */
export async function getUploadUrl(key, contentType = "image/jpeg") {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  });
  const url = await getSignedUrl(r2, command, { expiresIn: UPLOAD_URL_TTL_SECONDS });
  return url;
}

/**
 * Confirms an object actually landed in R2 before trusting a client's
 * "I uploaded it" claim.
 */
export async function objectExists(key) {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch (err) {
    if (err?.$metadata?.httpStatusCode === 404) return false;
    throw err;
  }
}

export function publicUrlFor(key) {
  const base = process.env.R2_PUBLIC_BASE_URL;
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/${key}`;
}
