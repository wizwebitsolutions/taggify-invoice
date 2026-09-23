-- Replace the fixed-18%-or-nothing isGstPlan toggle with an editable
-- percentage. Existing GST plans keep their 18% rate; non-GST plans get
-- NULL (no GST line), same behavior as isGstPlan = false.
ALTER TABLE "Plan" ADD COLUMN "gstPercent" DECIMAL(5,2);

UPDATE "Plan" SET "gstPercent" = 18 WHERE "isGstPlan" = true;

ALTER TABLE "Plan" DROP COLUMN "isGstPlan";
