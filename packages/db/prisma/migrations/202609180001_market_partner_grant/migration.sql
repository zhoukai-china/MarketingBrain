-- CreateTable
CREATE TABLE "MarketPartnerGrant" (
    "userId" TEXT NOT NULL,
    "grantedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketPartnerGrant_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "MarketPartnerGrant" ADD CONSTRAINT "MarketPartnerGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
