-- Follow-up to 20260922180000_campaign_post_number (22 Sep): once plan-made
-- "Phase N" rows became extra posts of phase 1, a phase an admin had added
-- by hand afterwards can be left with a gap (Phase 1, Phase 4). Renumber the
-- remaining real phases of each campaign 2, 3, … in their existing order,
-- carrying their extra posts (same old phaseNumber) along, and rename only
-- auto-named titles ("<root title> — Phase N").
WITH ranked AS (
  SELECT c."id" AS phase_id,
         c."parentCampaignId" AS root_id,
         c."phaseNumber" AS old_number,
         (dense_rank() OVER (PARTITION BY c."parentCampaignId" ORDER BY c."phaseNumber") + 1)::int AS new_number
  FROM "Campaign" c
  WHERE c."parentCampaignId" IS NOT NULL AND c."postNumber" = 1 AND c."phaseNumber" > 1
)
UPDATE "Campaign" AS c
SET "phaseNumber" = r.new_number,
    "title" = CASE
      WHEN c."postNumber" = 1 AND c."title" = root."title" || ' — Phase ' || r.old_number
        THEN root."title" || ' — Phase ' || r.new_number
      ELSE c."title"
    END
FROM ranked r
JOIN "Campaign" root ON root."id" = r.root_id
WHERE c."parentCampaignId" = r.root_id
  AND c."phaseNumber" = r.old_number
  AND r.new_number <> r.old_number;
