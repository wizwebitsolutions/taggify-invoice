-- 13 Nov: a plan maker's suggested vendor contact change, waiting for an admin.
ALTER TABLE "User" ADD COLUMN "pendingVendorEdit" JSONB;
ALTER TABLE "User" ADD COLUMN "pendingVendorEditById" TEXT;
ALTER TABLE "User" ADD COLUMN "pendingVendorEditAt" TIMESTAMP(3);
