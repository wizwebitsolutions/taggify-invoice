-- CreateTable
CREATE TABLE "BulkImportSheetSource" (
    "id" TEXT NOT NULL,
    "addedByUserId" TEXT NOT NULL,
    "name" TEXT,
    "sheetUrl" TEXT NOT NULL,
    "gid" TEXT NOT NULL DEFAULT '0',
    "profileLinkCol" TEXT,
    "postLinkCol" TEXT,
    "categoryCol" TEXT,
    "followersCol" TEXT,
    "dateCol" TEXT,
    "pageNameCol" TEXT,
    "fetchFollowers" BOOLEAN NOT NULL DEFAULT true,
    "fetchEngagement" BOOLEAN NOT NULL DEFAULT true,
    "lastCheckedAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BulkImportSheetSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BulkImportBatch" (
    "id" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sheetSourceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BulkImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BulkTrackedProfile" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "profileUrl" TEXT NOT NULL,
    "pageName" TEXT,
    "category" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "failureReason" TEXT,
    "addedByUserId" TEXT NOT NULL,
    "sheetSourceId" TEXT,
    "batchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pendingBatchId" TEXT,
    "pendingWeight" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BulkTrackedProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BulkTrackedProfileSnapshot" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "followers" INTEGER NOT NULL DEFAULT 0,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BulkTrackedProfileSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BulkTrackedPost" (
    "id" TEXT NOT NULL,
    "permalink" TEXT NOT NULL,
    "profileId" TEXT,
    "pageLink" TEXT,
    "pageName" TEXT,
    "followers" INTEGER,
    "postedDate" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "postType" TEXT,
    "failureReason" TEXT,
    "addedByUserId" TEXT NOT NULL,
    "sheetSourceId" TEXT,
    "batchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pendingBatchId" TEXT,
    "pendingWeight" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BulkTrackedPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BulkTrackedPostSnapshot" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "reposts" INTEGER NOT NULL DEFAULT 0,
    "saves" INTEGER NOT NULL DEFAULT 0,
    "pageName" TEXT,
    "followers" INTEGER,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BulkTrackedPostSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BulkTrackedProfile_addedByUserId_idx" ON "BulkTrackedProfile"("addedByUserId");

-- CreateIndex
CREATE INDEX "BulkTrackedProfile_sheetSourceId_idx" ON "BulkTrackedProfile"("sheetSourceId");

-- CreateIndex
CREATE INDEX "BulkTrackedProfile_batchId_idx" ON "BulkTrackedProfile"("batchId");

-- CreateIndex
CREATE INDEX "BulkTrackedPost_addedByUserId_idx" ON "BulkTrackedPost"("addedByUserId");

-- CreateIndex
CREATE INDEX "BulkTrackedPost_sheetSourceId_idx" ON "BulkTrackedPost"("sheetSourceId");

-- CreateIndex
CREATE INDEX "BulkTrackedPost_batchId_idx" ON "BulkTrackedPost"("batchId");

-- AddForeignKey
ALTER TABLE "BulkImportSheetSource" ADD CONSTRAINT "BulkImportSheetSource_addedByUserId_fkey" FOREIGN KEY ("addedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkImportBatch" ADD CONSTRAINT "BulkImportBatch_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkImportBatch" ADD CONSTRAINT "BulkImportBatch_sheetSourceId_fkey" FOREIGN KEY ("sheetSourceId") REFERENCES "BulkImportSheetSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkTrackedProfile" ADD CONSTRAINT "BulkTrackedProfile_addedByUserId_fkey" FOREIGN KEY ("addedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkTrackedProfile" ADD CONSTRAINT "BulkTrackedProfile_sheetSourceId_fkey" FOREIGN KEY ("sheetSourceId") REFERENCES "BulkImportSheetSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkTrackedProfile" ADD CONSTRAINT "BulkTrackedProfile_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "BulkImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkTrackedProfileSnapshot" ADD CONSTRAINT "BulkTrackedProfileSnapshot_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "BulkTrackedProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkTrackedPost" ADD CONSTRAINT "BulkTrackedPost_addedByUserId_fkey" FOREIGN KEY ("addedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkTrackedPost" ADD CONSTRAINT "BulkTrackedPost_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "BulkTrackedProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkTrackedPost" ADD CONSTRAINT "BulkTrackedPost_sheetSourceId_fkey" FOREIGN KEY ("sheetSourceId") REFERENCES "BulkImportSheetSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkTrackedPost" ADD CONSTRAINT "BulkTrackedPost_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "BulkImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkTrackedPostSnapshot" ADD CONSTRAINT "BulkTrackedPostSnapshot_postId_fkey" FOREIGN KEY ("postId") REFERENCES "BulkTrackedPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

