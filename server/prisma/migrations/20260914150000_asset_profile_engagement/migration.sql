-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "lastScrapeError" TEXT,
ADD COLUMN     "lastScrapedAt" TIMESTAMP(3),
ADD COLUMN     "profileAvgComments" INTEGER,
ADD COLUMN     "profileAvgLikes" INTEGER,
ADD COLUMN     "profileAvgViews" INTEGER,
ADD COLUMN     "profileSampleSize" INTEGER NOT NULL DEFAULT 0;
