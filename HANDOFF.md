
# 保禄OS V2（思潼·门店增长操作系统）—— 开发交接文档

## 当前工作区与备份（强制）

- 唯一开发主工作区：`F:\思潼AI增长os`
- 唯一电脑本地备份：`D:\思潼AI增长OS备份`
- C 盘不保存项目备份，不允许在 D 盘备份副本内开发。
- 统一备份命令：`powershell -ExecutionPolicy Bypass -File "F:\思潼AI增长os\baolu-os-v2-source\scripts\sync-local-backup.ps1" -SourceRoot "F:\思潼AI增长os" -BackupRoot "D:\思潼AI增长OS备份"`
- 同步为非破坏式更新，不使用镜像删除；`node_modules` 由各电脑重新安装，不纳入日常同步。

## 导出时间
2026年7月5日 10:10

## 导出位置
桌面文件夹：aolu-os-v2-source（已排除 node_modules、dist、.git、.turbo）

---

## 一、项目概述

**项目名称**：保禄OS V2（思潼 · 门店增长操作系统 / Store Growth OS）

**定位**：为本地商家（餐饮/零售/美业/生活服务）提供AI驱动的门店经营管理平台。核心功能包括：AI经营诊断、AI咨询师对话、每日简报、经营记忆管理、录音卡绑定、自动化工作流、套餐/积分计费。

**技术栈**：
- **前端**：React 18 + TypeScript + Vite，纯自研UI（无第三方组件库）
- **后端**：Node.js + Express + TypeScript（monorepo pps/api）
- **数据库**：Prisma ORM + SQLite（开发）/ MySQL（生产）
- **AI 引擎**：DeepSeek API 代理（services/deepseek-provider.ts）
- **包管理**：pnpm workspace monorepo
- **部署**：阿里云 ECS（参见 docs/ALIYUN_DEPLOYMENT.md）

**项目结构**（monorepo）：

`
baolu-os-v2/
├── apps/
│   ├── api/          # 后端 API 服务（Express + TypeScript）
│   │   └── src/
│   │       ├── server.ts              # 入口
│   │       ├── config/env.ts          # 环境变量配置
│   │       ├── routes/                # 路由（17个文件）
│   │       │   ├── auth.ts            # 微信扫码登录
│   │       │   ├── chat.ts            # AI对话（核心）
│   │       │   ├── diagnosis.ts       # 经营诊断
│   │       │   ├── billing.ts         # 支付/套餐
│   │       │   ├── audio-cards.ts     # 录音卡绑定
│   │       │   ├── automation.ts      # 自动化任务
│   │       │   ├── proactive.ts       # 主动推送建议
│   │       │   ├── tenant.ts          # 租户管理
│   │       │   ├── catalog.ts         # 咨询师目录
│   │       │   ├── conversations.ts   # 对话历史
│   │       │   ├── credits.ts         # 积分管理
│   │       │   ├── reports.ts         # 报告
│   │       │   ├── files.ts           # 文件上传
│   │       │   ├── feedback.ts        # 反馈
│   │       │   ├── workbench.ts       # 工作台
│   │       │   ├── account.ts         # 账号
│   │       │   ├── admin.ts           # 管理后台
│   │       │   ├── desktop.ts         # 桌面端
│   │       │   └── health.ts          # 健康检查
│   │       └── services/              # 服务层（18个文件）
│   │           ├── deepseek-provider.ts    # DeepSeek AI 调用
│   │           ├── wechat-auth.ts          # 微信OAuth
│   │           ├── wechat-pay.ts           # 微信支付
│   │           ├── auth-token.ts           # JWT Token
│   │           ├── access-guards.ts        # 权限校验
│   │           ├── billing-effects.ts      # 计费逻辑
│   │           ├── chat-persistence.ts     # 对话持久化
│   │           ├── database-bootstrap.ts   # 数据库初始化
│   │           ├── demo-automation.ts      # Demo自动化
│   │           ├── demo-billing.ts         # Demo计费
│   │           ├── demo-context.ts         # Demo上下文
│   │           ├── demo-files.ts           # Demo文件
│   │           ├── desktop-auth.ts         # 桌面认证
│   │           ├── file-storage.ts         # 文件存储
│   │           ├── invite-codes.ts         # 邀请码
│   │           ├── outbound-policy.ts      # 外发策略
│   │           └── request-context.ts      # 请求上下文
│   │
│   └── web/          # 前端 SPA（React + Vite）
│       └── src/
│           ├── main.tsx                    # 入口
│           ├── pages/                     # 页面组件
│           │   ├── App.tsx               # 主路由
│           │   ├── StoreGrowthApp.tsx     # ★ 门店增长主界面（核心页面）
│           │   ├── BaoluDiagnosisApp.tsx  # 保禄诊断应用
│           │   ├── DiagnosisPage.tsx      # 诊断页面
│           │   ├── LoginPage.tsx          # 登录页
│           │   └── WeChatCallback.tsx     # 微信回调
│           ├── components/               # UI 组件
│           │   ├── layout/LayoutComponents.tsx  # TopBar/NavTabs/ConsultantAvatar
│           │   ├── diagnosis/
│           │   │   ├── DiagnosisView.tsx   # ★ 诊断视图
│           │   │   ├── DailyView.tsx       # 每日简报视图
│           │   │   └── MemoryView.tsx      # 经营记忆视图
│           │   ├── consult/ConsultViewWrapper.tsx  # ★ AI咨询对话
│           │   ├── automation/
│           │   │   ├── AudioCardView.tsx   # 录音卡视图
│           │   │   └── AutomationView.tsx  # 自动化视图
│           │   ├── billing/BillingView.tsx # 套餐/支付视图
│           │   └── onboarding/OnboardingView.tsx  # 新手引导
│           ├── data/
│           │   ├── constants.ts          # 常量/默认数据
│           │   └── consultants.ts        # AI咨询师定义
│           ├── hooks/                    # React Hooks（待完善）
│           ├── lib/utils.ts             # 工具函数
│           ├── types/index.ts           # TypeScript 类型定义
│           └── styles/                   # CSS样式
│               ├── app.css
│               ├── store-growth.css
│               └── baolu-diagnosis.css
│
├── packages/         # 共享包
│   ├── shared/       # 共享类型和常量（SkillId, TenantType, PlanCode, CreditPackCode）
│   ├── agent/        # AI Agent 编排
│   ├── db/           # Prisma 数据库客户端和 Schema
│   ├── skills/       # 技能定义（27个skill markdown prompt）
│   └── dashboard/    # 仪表盘包
│
├── docs/             # 文档
│   ├── ARCHITECTURE.md
│   ├── DEVELOPMENT.md
│   ├── ALIYUN_DEPLOYMENT.md
│   ├── API.md
│   ├── SKU.md
│   ├── LAUNCH_PLAN.md
│   └── ...
│
├── scripts/          # 运维脚本
├── deploy-package/   # 部署打包
├── prisma/           # Prisma 配置
└── work/             # 临时工作文件
`

---

## 二、当前已完成进度

### ✅ 1. Monorepo 基础架构搭建
- pnpm workspace 配置完成（pnpm-workspace.yaml）
- 共享包 @baolu/shared 定义完成（TenantType、SkillId、PlanCode、CreditPackCode）
- Prisma Schema 设计完成，含迁移文件
- 所有 package.json 依赖关系正确

### ✅ 2. 后端 API（pps/api）
- 17个路由模块全部编写完成
- 18个服务模块全部编写完成
- DeepSeek AI 代理服务就绪
- 微信扫码登录流程完整
- 微信支付集成（JSAPI / Native）
- JWT Token 认证体系
- 权限校验中间件
- 文件上传/存储服务
- 邀请码系统
- 对话持久化
- Demo模式支持

### ✅ 3. 前端页面（pps/web）
- 所有页面组件已编写：StoreGrowthApp、DiagnosisPage、LoginPage、WeChatCallback
- 所有子组件已编写：DiagnosisView、DailyView、MemoryView、ConsultViewWrapper、AudioCardView、AutomationView、BillingView、OnboardingView、LayoutComponents
- 类型定义完整（	ypes/index.ts）
- 工具函数完整（lib/utils.ts）
- 咨询师定义完整（data/consultants.ts，含7个AI咨询师）
- 常量数据完整（data/constants.ts）
- CSS 样式文件完整

### ✅ 4. 技能系统（packages/skills）
- 27个技能 prompt markdown 全部编写
- 涵盖内容创作、数据分析、招商加盟、商学院、财务管理等

### ✅ 5. 文档
- 部署文档（阿里云）
- 架构文档
- API文档
- 开发文档
- 客户Beta指南
- SKU/定价文档

---

## 三、本会话所做的修改（2026-07-04）

### 修复内容：

1. **pps/web/src/types/index.ts** — 修复了 PlanCode 和 CreditPackCode 的导出方式
   - 原来用 import type 导入但后面又需要作为运行时值使用
   - 改为：import { type CreditPackCode, type PlanCode } + export type { PlanCode, CreditPackCode }

2. **pps/web/src/data/constants.ts** — 修复了三类错误：
   - **roleOptions 类型不匹配**：原本 mixed TenantType 和自定义字符串。修复为全部使用 TenantType 的合法值（local_business, chain_brand, personal_ip）
   - **billingRolePlanMap 类型不匹配**：修复 plan code 值，全部改为合法 PlanCode
   - **dailyInsightsData 字符串引号断裂**：中文文本中包含普通双引号 "，破坏了 JS 字符串语法。改为模板字符串 ` ... ` 并转义中文引号为 \u201C/\u201D
   - **memoryDefaults.role 类型不匹配**："local_store" → "local_business"（匹配 TenantType）

3. **pps/web/src/lib/utils.ts** — 修复 "local_store" → "local_business"

4. **pps/web/src/pages/StoreGrowthApp.tsx** — 修复了8个组件的导入路径
   - 原来：./layout/LayoutComponents（pages/ 下找不到）
   - 改为：../components/layout/LayoutComponents（指向正确的 components 目录）

---

## 四、接下来需要完成的任务（按优先级排列）

### 🔴 P0 — 阻塞性（必须完成才能编译通过）

1. **StoreGrowthApp.tsx 完整代码调试**
   - 当前文件被截断（只显示了前20行），需要补齐完整逻辑
   - 确认所有 import 的组件和 hooks 都存在且有正确的导出

2. **缺失的组件文件**
   - components/chat/ 目录为空，可能需要咨询对话的聊天组件（如 ChatBubble、ChatInput）
   - hooks/ 目录为空，可能需要自定义 hooks（如 useChat、useMemory 等）

3. **LayoutComponents.tsx 中的 sprite sheet 路径**
   - ConsultantAvatar 组件使用 import.meta.env.BASE_URL + "../assets/consultant-avatars-sheet.png"
   - 需要确认该 PNG 文件存在且路径正确

4. **SkillId 类型不匹配**
   - consultants.ts 中的咨询师 ID（如 "Sitong_content_creator"）不匹配 SkillId 类型
   - 需要在 @baolu/shared 中将 SkillId 扩展为包含所有咨询师ID的联合类型，或者在 consultants.ts 中使用类型断言

5. **@baolu/shared 包构建**
   - 前端依赖 @Sitong/shared（注意大小写可能不一致），需要确保该包正确构建和链接

### 🟡 P1 — 重要（功能完整性）

6. **StoreGrowthApp.tsx 页面核心逻辑**
   - 视图切换（diagnosis/consult/daily/memory/audio/automation/billing）
   - AI 对话流式响应处理
   - 经营记忆 CRUD
   - 支付流程

7. **CSS 样式完善**
   - store-growth.css — 门店增长主界面样式
   - pp.css — 全局样式
   - aolu-diagnosis.css — 诊断界面样式

8. **前端路由配置**
   - App.tsx 中的路由分发逻辑
   - 微信回调页面流程

### 🟢 P2 — 增强

9. **TypeScript 类型检查全部通过**（
px tsc --noEmit）
10. **Vite 构建通过**（
px vite build）
11. **后端 API 联调测试**
12. **端到端测试**

---

## 五、在新电脑上启动开发环境

`ash
# 1. 安装依赖
cd baolu-os-v2-source
pnpm install

# 2. 构建共享包
pnpm --filter @baolu/shared build
pnpm --filter @baolu/db build
pnpm --filter @baolu/skills build
pnpm --filter @baolu/agent build

# 3. 初始化数据库
cd packages/db
npx prisma generate
npx prisma db push

# 4. 启动后端
cd ../../apps/api
pnpm dev

# 5. 启动前端（另一个终端）
cd ../../apps/web
pnpm dev
`

环境变量需要配置：
- DATABASE_URL — SQLite 路径或 MySQL 连接串
- DEEPSEEK_API_KEY — DeepSeek API 密钥
- JWT_SECRET — JWT 签名密钥
- WECHAT_APP_ID / WECHAT_APP_SECRET — 微信开放平台（可选）
- WECHAT_PAY_MCH_ID / WECHAT_PAY_API_KEY — 微信支付（可选）

详见 docs/baolu-os-v2.env.template

---

## 六、注意事项

1. **包名大小写**：代码中混用了 @Sitong/shared 和 @baolu/shared，需要统一
2. **pnpm workspace**：所有内部包通过 workspace 协议引用（"@baolu/shared": "workspace:*"）
3. **Vite 别名**：前端 ite.config.ts 可能配置了路径别名，查看确认
4. **前端 types**：	ypes/index.ts 中 import type { SkillId, TenantType } from "@Sitong/shared" — 注意包名是 @Sitong 还是 @baolu
5. **CSS 样式**：样式是纯 CSS（无 Tailwind），直接在 styles/ 目录下

---

祝开发顺利！🎯
