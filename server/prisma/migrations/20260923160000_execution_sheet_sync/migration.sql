-- Execution sheet sync (23 Sep): the attached sheet is now parsed into
-- links; these hold when it was last read and which rows couldn't be used.
ALTER TABLE "Plan" ADD COLUMN "executionSheetFetchedAt" TIMESTAMP(3);
ALTER TABLE "Plan" ADD COLUMN "executionSheetPending" JSONB;
