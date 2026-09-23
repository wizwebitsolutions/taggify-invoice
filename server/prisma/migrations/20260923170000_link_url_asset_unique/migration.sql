-- Link(url, assetId) unique (23 Sep, code review finding): the real guard
-- behind autoAttachLink's duplicate check, which was previously a
-- read-then-write race that could double-create a billable Link for the
-- same post under concurrent execution-sheet syncs. No existing rows
-- violate this (checked before writing this migration).
CREATE UNIQUE INDEX "Link_url_assetId_key" ON "Link"("url", "assetId");
