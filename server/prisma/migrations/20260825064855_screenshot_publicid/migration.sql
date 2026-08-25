-- Switch screenshot storage from Cloudflare R2 to Cloudinary: the stored
-- object key is now a Cloudinary public_id rather than an R2 object key.
ALTER TABLE "Screenshot" RENAME COLUMN "r2Key" TO "publicId";
