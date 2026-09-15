-- AlterTable
ALTER TABLE "Plan" ADD COLUMN "campaignId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Plan_campaignId_key" ON "Plan"("campaignId");

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
