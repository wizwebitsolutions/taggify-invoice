-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "attachmentName" TEXT,
ADD COLUMN     "attachmentPublicId" TEXT,
ADD COLUMN     "attachmentUploadedAt" TIMESTAMP(3),
ADD COLUMN     "attachmentUploadedById" TEXT;
