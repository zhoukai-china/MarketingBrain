# Sitong AI Growth OS v2

思潼AI增长OS v2 是新版独立工程，目标是替代旧版 `/opt/Sitong-agent`，但开发和测试期间不影响旧版线上服务。

## Product Shape

- 标准版：手机 H5，聚焦日常获客、内容、话术、经营建议。
- 高级版：手机 H5 + 电脑端 Web 工作台，增加文件分析、报告导出、录音卡分析、多账号协作、经营自动化。
- 后续升级：H5 可替换为小程序，电脑端 Web 工作台可按需封装为桌面端。

## Hard Constraints

- 生产模型只接国内大模型，例如 DeepSeek 或国内模型中转服务。
- 客户端不直接调用模型，所有模型请求必须经过后端。
- 所有业务数据必须按 `tenant_id` 隔离。
- 老版服务不动，新版单独部署、单独端口、单独数据库。
- 付费按商家/品牌主体收费，账号在主体下分角色管理。

## Monorepo Layout

```text
apps/api          Fastify API service
apps/web          H5 + desktop web workbench
packages/agent    Agent routing, prompt assembly, quality guardrails
packages/db       Prisma schema and database access
packages/shared   Shared types and SKU definitions
packages/skills   Skill manifests and prompts
docs              Architecture and product documents
```

## First Deployment Target

```text
/opt/Sitong-os-v2
API port: 3011
Database: Sitong_os_v2
Routes:
  /v2/chat
  /v2/workbench
  /v2/admin
```

