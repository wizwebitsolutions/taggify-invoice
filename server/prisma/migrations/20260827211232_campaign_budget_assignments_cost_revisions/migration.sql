-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "costCap" DECIMAL(12,2),
ADD COLUMN     "sheetLink" TEXT;

-- CreateTable
CREATE TABLE "CampaignAssignment" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "assetId" TEXT,
    "pageHandle" TEXT NOT NULL,
    "creatorPhone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinkCostRevision" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "previousCost" DECIMAL(12,2) NOT NULL,
    "newCost" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "revisedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinkCostRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignAssignment_campaignId_idx" ON "CampaignAssignment"("campaignId");

-- CreateIndex
CREATE INDEX "LinkCostRevision_linkId_idx" ON "LinkCostRevision"("linkId");

-- AddForeignKey
ALTER TABLE "CampaignAssignment" ADD CONSTRAINT "CampaignAssignment_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignAssignment" ADD CONSTRAINT "CampaignAssignment_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkCostRevision" ADD CONSTRAINT "LinkCostRevision_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkCostRevision" ADD CONSTRAINT "LinkCostRevision_revisedById_fkey" FOREIGN KEY ("revisedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
