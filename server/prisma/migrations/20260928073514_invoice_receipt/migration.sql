-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "receiptName" TEXT,
ADD COLUMN     "receiptPublicId" TEXT,
ADD COLUMN     "receiptUploadedAt" TIMESTAMP(3),
ADD COLUMN     "receiptUploadedById" TEXT;
