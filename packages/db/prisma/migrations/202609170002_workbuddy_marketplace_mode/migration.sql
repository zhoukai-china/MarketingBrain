-- PLAT-47：WorkBuddy 接入货架已上架 SKU（用户 2026-09-17）。
--
-- 旧模型把每个 WorkBuddy 连接绑死到单个 `agentId`（生产 4 个 active 连接全绑 agent_ceo_cockpit），
-- 导致 `sitong.skills` 只吐一个 ceo-cockpit-analyst。本次让 `agentId` 变为可空，并新增 `mode`
-- 区分「智能体模式（agent，默认，兼容老连接）」与「货架模式（marketplace，按货架 selling SKU 接入）」。
--
-- 纯叠加：老行 `agentId` 非空、`mode` 默认 'agent'，行为不变；可安全发布与回滚（回滚=不读新列）。

-- AlterTable
ALTER TABLE "WorkbuddyMcpConnection" ALTER COLUMN "agentId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "WorkbuddyMcpConnection" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'agent';
