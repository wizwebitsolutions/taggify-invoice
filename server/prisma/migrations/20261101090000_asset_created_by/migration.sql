-- 1 Nov: who added a page (Add page / sheet import / plan sheet) — Approvals groups new pages by this.
ALTER TABLE "Asset" ADD COLUMN "createdById" TEXT;
CREATE INDEX "Asset_createdById_idx" ON "Asset"("createdById");
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
