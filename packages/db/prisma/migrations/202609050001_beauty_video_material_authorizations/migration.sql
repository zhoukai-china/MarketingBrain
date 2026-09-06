-- BY-46 additive only. No existing table/data rewrite; no activation or grants.
CREATE TABLE "BeautyVideoAssetAuthorization" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  "storeId" TEXT NOT NULL REFERENCES "Store"("id") ON DELETE RESTRICT,
  "fileId" TEXT NOT NULL UNIQUE REFERENCES "UploadedFile"("id") ON DELETE RESTRICT,
  "fileSha256" TEXT NOT NULL,
  "basisFileId" TEXT NOT NULL REFERENCES "UploadedFile"("id") ON DELETE RESTRICT,
  "basisSha256" TEXT NOT NULL,
  "subjectRole" TEXT NOT NULL,
  "purpose" TEXT NOT NULL DEFAULT 'video_replacement',
  "rights" JSONB NOT NULL,
  "assurance" TEXT NOT NULL DEFAULT 'user_declared_not_independently_verified',
  "declaredByUserId" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "contractVersion" TEXT NOT NULL DEFAULT 'beauty-video-asset-authorization-v1',
  "metadata" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "BeautyVideoAssetAuthorization_tenantId_requestKey_key" ON "BeautyVideoAssetAuthorization"("tenantId","requestKey");
CREATE UNIQUE INDEX "BeautyVideoAssetAuthorization_tenantId_storeId_fileSha256_key" ON "BeautyVideoAssetAuthorization"("tenantId","storeId","fileSha256");
CREATE INDEX "BeautyVideoAssetAuthorization_tenantId_storeId_expiresAt_revo_idx" ON "BeautyVideoAssetAuthorization"("tenantId","storeId","expiresAt","revokedAt");
CREATE TABLE "BeautyVideoStagingLease" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "authorizationVersions" JSONB NOT NULL,
  "objects" JSONB NOT NULL,
  "adapterId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'creating',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "releasedAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "BeautyVideoStagingLease_tenantId_requestHash_key" ON "BeautyVideoStagingLease"("tenantId","requestHash");
CREATE INDEX "BeautyVideoStagingLease_status_expiresAt_idx" ON "BeautyVideoStagingLease"("status","expiresAt");
