-- 智能体「按月订阅（积分口径 + 每日次数上限）」（用户 2026-09-17 拍板）。
--
-- 背景：货架一直有「包月」概念，但价格只写了人民币（subscriptionPriceCny），而生产上这些值
-- 全是 NULL（= 没上架），且订阅支付只有 mock-pay（生产 404），所以「包月」实际不可用。
--
-- 用户口径（2026-09-17）：
--   1. 文案智能体 = 4000 积分/月，每天 5 条；选了包月就不再扣积分。
--   2. 计费方式按单个智能体走：有的按次（ppu）、有的按消耗（成本口径）、有的支持按月订阅。
--
-- 本次只新增列，不改历史数据、不迁移历史行；纯叠加，可安全发布与回滚（回滚=不读新列）。
-- 已存在的订阅行 credits=0 / dailyQuota=NULL，语义等价于「老的人民币口径包月」，行为不变。

-- AlterTable
ALTER TABLE "MarketplaceSku"
    ADD COLUMN "subscriptionCredits" INTEGER,
    ADD COLUMN "subscriptionDailyQuota" INTEGER;

-- AlterTable
ALTER TABLE "MarketplaceSubscription"
    ADD COLUMN "credits" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "dailyQuota" INTEGER;
