-- AlterTable: add the GST breakdown columns. subtotal is backfilled from the
-- existing `amount` for pre-existing invoices (they predate the GST split,
-- so their whole amount was the subtotal — no GST was ever added to them)
-- before being made NOT NULL, since the table isn't empty.
ALTER TABLE "Invoice" ADD COLUMN     "gstAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "isGstInvoice" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "subtotal" DECIMAL(12,2);

UPDATE "Invoice" SET "subtotal" = "amount" WHERE "subtotal" IS NULL;

ALTER TABLE "Invoice" ALTER COLUMN "subtotal" SET NOT NULL;
