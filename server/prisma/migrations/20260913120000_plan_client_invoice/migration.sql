-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "clientInvoiceAt" TIMESTAMP(3),
ADD COLUMN     "clientInvoiceNumber" TEXT,
ADD COLUMN     "clientPhone" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Plan_clientInvoiceNumber_key" ON "Plan"("clientInvoiceNumber");

