-- 17 Oct: plan wizard's Instagram check — when a page was last confirmed to exist, and whether it came back broken.
ALTER TABLE "Asset" ADD COLUMN "profileCheckedAt" TIMESTAMP(3);
ALTER TABLE "Asset" ADD COLUMN "profileBroken" BOOLEAN NOT NULL DEFAULT false;
