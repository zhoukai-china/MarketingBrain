ALTER TABLE "InviteCode" ADD COLUMN "brandCode" TEXT;

CREATE INDEX "InviteCode_brandCode_idx" ON "InviteCode"("brandCode");
