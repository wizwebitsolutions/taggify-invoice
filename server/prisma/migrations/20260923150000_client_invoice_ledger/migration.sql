-- ClientInvoice (23 Sep): receivables ledger for the Taggify → client
-- invoice minted on a Plan. Backfilled from every plan that already has a
-- clientInvoiceNumber, with the same client-facing totals the PDF shows
-- (overrideCost wins over the per-item client cost sum; GST from gstPercent).
CREATE TYPE "ClientInvoiceStatus" AS ENUM ('ISSUED', 'PAID', 'CANCELLED');

CREATE TABLE "ClientInvoice" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "campaignId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "gstPercent" DECIMAL(5,2),
    "gstAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "status" "ClientInvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidAmount" DECIMAL(12,2),
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientInvoice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientInvoice_planId_key" ON "ClientInvoice"("planId");
CREATE UNIQUE INDEX "ClientInvoice_invoiceNumber_key" ON "ClientInvoice"("invoiceNumber");
CREATE INDEX "ClientInvoice_status_idx" ON "ClientInvoice"("status");
CREATE INDEX "ClientInvoice_campaignId_idx" ON "ClientInvoice"("campaignId");

ALTER TABLE "ClientInvoice" ADD CONSTRAINT "ClientInvoice_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientInvoice" ADD CONSTRAINT "ClientInvoice_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "ClientInvoice" ("id", "planId", "campaignId", "invoiceNumber", "subtotal", "gstPercent", "gstAmount", "total", "status", "issuedAt", "issuedById", "createdAt", "updatedAt")
SELECT
    'cli_' || md5(p."id"),
    p."id",
    p."campaignId",
    p."clientInvoiceNumber",
    t.subtotal,
    p."gstPercent",
    t.gst,
    t.subtotal + t.gst,
    'ISSUED',
    COALESCE(p."clientInvoiceAt", p."updatedAt"),
    p."createdById",
    COALESCE(p."clientInvoiceAt", p."updatedAt"),
    CURRENT_TIMESTAMP
FROM "Plan" p
CROSS JOIN LATERAL (
    SELECT
        s.subtotal,
        ROUND(s.subtotal * COALESCE(p."gstPercent", 0) / 100, 2) AS gst
    FROM (
        SELECT COALESCE(
            p."overrideCost",
            (SELECT COALESCE(SUM(COALESCE(i."clientCost", i."cost") * i."postsPerProfile"), 0) FROM "PlanItem" i WHERE i."planId" = p."id")
        )::DECIMAL(12,2) AS subtotal
    ) s
) t
WHERE p."clientInvoiceNumber" IS NOT NULL;
