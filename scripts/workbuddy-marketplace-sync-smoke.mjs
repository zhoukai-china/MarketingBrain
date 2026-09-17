#!/usr/bin/env node
/**
 * PLAT-47 契约 smoke（只读源码：不连网、不调模型、不花钱）。
 *
 * 用户 2026-09-17 口径：「在 WorkBuddy 里接入思潼 AI」接入的是**货架（marketplace-v3.json）**
 * 已上架的 SKU，计费与货架同价同账（ppu / 成本口径 / 包月），而不是单绑一个智能体。
 *
 * 本契约把这条口径写死成源码级断言：一旦有人把 WorkBuddy 接回单 agent 线、或把计费引回
 * `invokeSkillViaGateway`、或把 `sitong.skills` 改回 `agent.allowedSkills`，qa 直接红。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const marketplace = read("apps/api/src/routes/marketplace.ts");
assert(/export async function runMarketplaceSku\(/.test(marketplace), "runMarketplaceSku 必须导出供 WorkBuddy 与网页共用");
assert(/export async function listMarketplaceSkus\(/.test(marketplace), "listMarketplaceSkus 必须导出");
assert(/export async function getMarketplaceSku\(/.test(marketplace), "getMarketplaceSku 必须导出");
assert(/post<\{ Params: \{ skuId: string \} \}>\(\"\/skus\/:skuId\/run\"/.test(marketplace), "网页 /run 路由必须保留");
assert(/runMarketplaceSku\(\{ context, sku, body: parsed\.data, log: request\.log \}\)/.test(marketplace), "/run 必须复用 runMarketplaceSku");

const mcp = read("apps/api/src/routes/workbuddy-mcp.ts");
assert(/mode === "marketplace"/.test(mcp), "workbuddy-mcp 必须识别 marketplace 模式");
assert(/listMarketplaceSkus\(\{ status: "selling" as const \}, false\)/.test(mcp), "sitong.skills 在货架模式必须列 selling SKU");
assert(/runMarketplaceSku\(\{/.test(mcp), "sitong.ask 在货架模式必须走 runMarketplaceSku");
assert(/getMarketplaceSku\(skuCode\)/.test(mcp), "sitong.ask 必须按 skuCode 解析 SKU");
assert(/message\.startsWith\("marketplace_"\)/.test(mcp), "marketplace_* 错误码必须透传给 MCP 客户端");

const settings = read("apps/api/src/routes/workbuddy-settings.ts");
assert(/mode: z\.literal\("marketplace"\)/.test(settings), "连接创建必须支持 mode=marketplace");
assert(/mode: marketplaceMode \? "marketplace" : "agent"/.test(settings), "连接写入必须携带 mode");

const schema = read("packages/db/prisma/schema.prisma");
assert(/agentId\s+String\?/.test(schema), "WorkbuddyMcpConnection.agentId 必须可空");
assert(/mode\s+String\s+@default\("agent"\)/.test(schema), "WorkbuddyMcpConnection 必须有 mode 字段");

const migration = read("packages/db/prisma/migrations/202609170002_workbuddy_marketplace_mode/migration.sql");
assert(/ALTER COLUMN "agentId" DROP NOT NULL/.test(migration), "迁移必须把 agentId 改为可空");
assert(/ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'agent'/.test(migration), "迁移必须新增 mode 列");

const recharge = read("apps/web/src/pages/RechargePage.tsx");
assert(/mode: "marketplace"/.test(recharge), "充值页「接入 WorkBuddy」必须创建货架模式连接");

console.log("workbuddy_marketplace_sync_smoke: PASS");
