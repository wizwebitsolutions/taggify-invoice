-- 16 Oct: page grade + group link + planner-proposed edits (Inventory), flat plan discount before GST.
ALTER TABLE "Asset" ADD COLUMN "grade" TEXT;
ALTER TABLE "Asset" ADD COLUMN "groupLink" TEXT;
ALTER TABLE "Asset" ADD COLUMN "pendingEdit" JSONB;
ALTER TABLE "Asset" ADD COLUMN "pendingEditById" TEXT;
ALTER TABLE "Asset" ADD COLUMN "pendingEditAt" TIMESTAMP(3);

ALTER TABLE "Plan" ADD COLUMN "discount" DECIMAL(12,2);

ALTER TABLE "ClientInvoice" ADD COLUMN "discount" DECIMAL(12,2) NOT NULL DEFAULT 0;
