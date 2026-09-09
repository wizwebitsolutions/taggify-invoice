-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "parentCampaignId" TEXT,
ADD COLUMN     "phaseNumber" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX "Campaign_parentCampaignId_idx" ON "Campaign"("parentCampaignId");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_parentCampaignId_fkey" FOREIGN KEY ("parentCampaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
