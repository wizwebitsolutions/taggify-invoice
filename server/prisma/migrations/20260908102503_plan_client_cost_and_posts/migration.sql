-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "isGstPlan" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PlanItem" ADD COLUMN     "clientCost" DECIMAL(12,2),
ADD COLUMN     "postsPerProfile" INTEGER NOT NULL DEFAULT 1;
