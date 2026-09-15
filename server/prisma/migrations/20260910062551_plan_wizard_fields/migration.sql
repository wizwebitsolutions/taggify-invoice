-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "clientAddress" TEXT,
ADD COLUMN     "clientCompany" TEXT,
ADD COLUMN     "clientGstNumber" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "overrideCost" DECIMAL(12,2),
ADD COLUMN     "overrideFollowers" INTEGER,
ADD COLUMN     "overrideImpressions" INTEGER,
ADD COLUMN     "overridePosts" INTEGER,
ADD COLUMN     "pitchGroupId" TEXT,
ADD COLUMN     "variantLabel" TEXT NOT NULL DEFAULT 'Plan A';

-- CreateIndex
CREATE INDEX "Plan_pitchGroupId_idx" ON "Plan"("pitchGroupId");
