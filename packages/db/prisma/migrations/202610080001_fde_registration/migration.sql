-- FDE 生态登记（2026-10-08 保禄交接单）：FDE 工程师合作登记页数据落地。
-- 中文字段原样存 payload（JSONB），手机号为唯一键（重复提交 upsert 更新），
-- name/city 提取成列便于搜索；按创建时间倒序展示。
CREATE TABLE IF NOT EXISTS "FdeRegistration" (
  id         TEXT PRIMARY KEY,
  phone      TEXT NOT NULL UNIQUE,
  name       TEXT,
  city       TEXT,
  status     TEXT NOT NULL DEFAULT '已建档',
  payload    JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "FdeRegistration_createdAt_idx" ON "FdeRegistration" ("createdAt" DESC);
