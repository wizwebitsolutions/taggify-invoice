-- "Upload plan" from a Google Sheet (22 Sep): the sheet link the plan was
-- built from (re-fetched by Refresh), when it was last fetched, and the
-- sheet rows that couldn't become plan items yet.
ALTER TABLE "Plan" ADD COLUMN "sourceSheetUrl" TEXT;
ALTER TABLE "Plan" ADD COLUMN "sourceSheetFetchedAt" TIMESTAMP(3);
ALTER TABLE "Plan" ADD COLUMN "sourceSheetPending" JSONB;
