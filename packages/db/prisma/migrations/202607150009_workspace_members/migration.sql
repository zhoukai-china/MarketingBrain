-- Add brand workspace invitation records.
CREATE TABLE "WorkspaceInvite" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "codePreview" TEXT NOT NULL,
  "role" "UserRole" NOT NULL DEFAULT 'staff',
  "storeId" TEXT,
  "label" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "maxUses" INTEGER NOT NULL DEFAULT 1,
  "usedCount" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkspaceInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkspaceInvite_codeHash_key" ON "WorkspaceInvite"("codeHash");
CREATE INDEX "WorkspaceInvite_tenantId_isActive_expiresAt_idx" ON "WorkspaceInvite"("tenantId", "isActive", "expiresAt");
CREATE INDEX "WorkspaceInvite_createdByUserId_idx" ON "WorkspaceInvite"("createdByUserId");
CREATE INDEX "WorkspaceInvite_storeId_idx" ON "WorkspaceInvite"("storeId");

ALTER TABLE "WorkspaceInvite" ADD CONSTRAINT "WorkspaceInvite_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceInvite" ADD CONSTRAINT "WorkspaceInvite_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkspaceInvite" ADD CONSTRAINT "WorkspaceInvite_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Attribute conversations to a member. Existing rows stay visible to workspace
-- administrators as legacy records; new rows are private to their creator.
ALTER TABLE "Conversation"
  ADD COLUMN "createdByUserId" TEXT,
  ADD COLUMN "storeId" TEXT,
  ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'private';

CREATE INDEX "Conversation_tenantId_createdByUserId_updatedAt_idx" ON "Conversation"("tenantId", "createdByUserId", "updatedAt");
CREATE INDEX "Conversation_tenantId_storeId_updatedAt_idx" ON "Conversation"("tenantId", "storeId", "updatedAt");

ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;
