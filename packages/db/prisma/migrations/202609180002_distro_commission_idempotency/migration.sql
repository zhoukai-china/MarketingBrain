-- AlterTable
ALTER TABLE "DistroCommissionLog" ADD COLUMN "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "DistroCommissionLog_idempotencyKey_key" ON "DistroCommissionLog"("idempotencyKey");
