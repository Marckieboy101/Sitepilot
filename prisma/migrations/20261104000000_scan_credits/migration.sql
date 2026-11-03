CREATE TYPE "MolliePaymentType" AS ENUM ('SCAN_CREDIT', 'PLAN');

ALTER TABLE "organizations"
  ADD COLUMN "freePreviewUsed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "scanCredits" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "paidScanPurchases" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "audits"
  ADD COLUMN "previewOnly" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "mollie_payments" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "molliePaymentId" TEXT,
  "type" "MolliePaymentType" NOT NULL,
  "plan" "Plan",
  "interval" TEXT,
  "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "mollie_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mollie_payments_molliePaymentId_key"
  ON "mollie_payments"("molliePaymentId");
CREATE INDEX "mollie_payments_organizationId_createdAt_idx"
  ON "mollie_payments"("organizationId", "createdAt");

ALTER TABLE "mollie_payments"
  ADD CONSTRAINT "mollie_payments_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
