-- AlterTable
ALTER TABLE "CampaignAssignment" ADD COLUMN     "cost" DECIMAL(12,2),
ADD COLUMN     "format" TEXT,
ADD COLUMN     "linkId" TEXT,
ADD COLUMN     "postUrl" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CampaignAssignment_linkId_key" ON "CampaignAssignment"("linkId");

-- AddForeignKey
ALTER TABLE "CampaignAssignment" ADD CONSTRAINT "CampaignAssignment_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE SET NULL ON UPDATE CASCADE;
