ALTER TABLE "LanqiMediaJob"
  ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'aliyun_bailian',
  ADD COLUMN "promptVersion" TEXT NOT NULL DEFAULT 'unknown';
