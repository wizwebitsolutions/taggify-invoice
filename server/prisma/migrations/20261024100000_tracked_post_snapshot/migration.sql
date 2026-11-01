-- 24 Oct: Post Tracker snapshot capture (logged-out headless browser). New nullable/defaulted columns only.
ALTER TABLE "TrackedPost" ADD COLUMN     "caption" TEXT,
ADD COLUMN     "captureCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "captureError" TEXT,
ADD COLUMN     "captureStatus" TEXT NOT NULL DEFAULT 'queued',
ADD COLUMN     "capturedAt" TIMESTAMP(3),
ADD COLUMN     "commentCount" INTEGER,
ADD COLUMN     "coverUrl" TEXT,
ADD COLUMN     "likeCount" INTEGER,
ADD COLUMN     "ownerHandle" TEXT,
ADD COLUMN     "postedOn" TEXT,
ADD COLUMN     "screenshotUrl" TEXT;

CREATE INDEX "TrackedPost_captureStatus_idx" ON "TrackedPost"("captureStatus");
