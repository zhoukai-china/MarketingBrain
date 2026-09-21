-- PLAT-47 后续：货架 MCP 多轮会话记忆（用户 2026-09-18「把复杂留给服务端，把简单留给用户」）。
--
-- 背景：WorkBuddy 客户端目前不传 `history`，导致「追问 → 补全续聊」第二轮丢上下文、生成失败。
-- 本次在服务端按 `conversationId` 持久化历史消息，客户端只需回传 `conversationId`，服务端自动拼上下文。
-- 纯新增表，不影响现有数据。

-- CreateTable
CREATE TABLE "MarketplaceConversation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "skuCode" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "history" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceConversation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceConversation_conversationId_key" ON "MarketplaceConversation"("conversationId");

-- CreateIndex
CREATE INDEX "MarketplaceConversation_tenantId_userId_skuCode_updatedAt_idx" ON "MarketplaceConversation"("tenantId", "userId", "skuCode", "updatedAt");

-- AddForeignKey
ALTER TABLE "MarketplaceConversation" ADD CONSTRAINT "MarketplaceConversation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceConversation" ADD CONSTRAINT "MarketplaceConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
