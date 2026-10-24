-- 22 Oct: post thumbnails stored in Cloudinary -- Instagram's CDN link (thumbnailUrl) is signed and expires in days.
ALTER TABLE "PostSnapshot" ADD COLUMN "thumbnailStoredUrl" TEXT;
