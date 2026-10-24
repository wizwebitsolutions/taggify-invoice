-- 24 Oct: Post Tracker -- a pasted public Instagram reel/post link, shown as Instagram's embed. New table only.
CREATE TABLE "TrackedPost" (
    "id" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "inputUrl" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "shortcode" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "note" TEXT,
    "broken" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackedPost_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TrackedPost_createdById_createdAt_idx" ON "TrackedPost"("createdById", "createdAt");

CREATE UNIQUE INDEX "TrackedPost_createdById_shortcode_key" ON "TrackedPost"("createdById", "shortcode");

ALTER TABLE "TrackedPost" ADD CONSTRAINT "TrackedPost_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
