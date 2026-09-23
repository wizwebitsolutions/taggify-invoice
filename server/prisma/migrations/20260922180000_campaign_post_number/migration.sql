-- Extra posts vs real phases (22 Sep). See schema.prisma's Campaign.postNumber.
ALTER TABLE "Campaign" ADD COLUMN "postNumber" INTEGER NOT NULL DEFAULT 1;

-- Existing "Phase N" rows that were really a page's 2nd/3rd post: created by
-- plan approval (plans/service.js createCampaignFromPlan) in the same
-- transaction as their root, so within seconds of it. Those become extra
-- posts of phase 1 (titled like the root). Phases an admin added by hand
-- later are left as real phases.
UPDATE "Campaign" AS c
SET "postNumber" = c."phaseNumber",
    "phaseNumber" = 1,
    "title" = r."title"
FROM "Campaign" AS r
WHERE c."parentCampaignId" = r."id"
  AND EXISTS (SELECT 1 FROM "Plan" p WHERE p."campaignId" = r."id")
  AND c."createdAt" <= r."createdAt" + INTERVAL '2 minutes';
