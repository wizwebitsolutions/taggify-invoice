-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "invoiceAttachmentName" TEXT,
ADD COLUMN     "invoiceAttachmentPublicId" TEXT,
ADD COLUMN     "invoiceAttachmentUploadedAt" TIMESTAMP(3),
ADD COLUMN     "invoiceAttachmentUploadedById" TEXT;
