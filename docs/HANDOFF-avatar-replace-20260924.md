# 数字员工形象照替换 · 交接文档

> 交接人：设计侧（思潼）
> 接收人：周凯（技术合伙人）
> 日期：2026-09-24
> 优先级：低（纯素材替换，无逻辑改动）
> 预计工作量：30 分钟内

---

## 1. 一句话说明

8 张数字员工职业形象照已生成并压缩完毕，需要替换线上 `public/avatars/` 下的旧头像并重新构建部署。素材包：`docs/prototypes/avatars-20260923/`（与本文档同仓库）。

**为什么要换**：旧头像是深蓝背景半身照（每张约 1.3MB，8 张共 11MB），手机端加载重、观感压抑。新照片统一职业风格、明亮橙色影棚底，与商城品牌色一致。

## 2. 素材包内容

`docs/prototypes/avatars-20260923/`，8 个文件，全部为 **512×512 JPEG（中心裁剪 1:1，quality 85）**：

| 文件 | 数字员工 | 职位 | 能力核 | 大小 |
|---|---|---|---|---|
| `ip-position.jpg` | 沈定 | 首席定位官 | ip-pos | 35 KB |
| `topic.jpg` | 何策 | 选题策略官 | topic | 39 KB |
| `copywriter.jpg` | 秦文 | 金牌文案主笔 | copy | 36 KB |
| `video-diag.jpg` | 江流 | 流量诊断官 | vidrev | 37 KB |
| `live-host.jpg` | 罗盘 | 直播话术师 | livescript | 50 KB |
| `live-coach.jpg` | 许复 | 直播复盘导师 | liverev | 39 KB |
| `sales-coach.jpg` | 易成 | 首席成交官 | sales | 36 KB |
| `private.jpg` | 周域 | 私域增长顾问 | moments | 35 KB |

合计约 307KB（旧图 11MB → 新图 0.3MB）。

> 注：`<能力核>` 即 `coreSkuCode(skuCode)` 的后缀，与 `apps/web/src/marketplace/employee-names.ts` 的 `EMPLOYEE_NAME_BY_CAPABILITY` 键一致。

## 3. 现状：线上引用方式

头像路径单一来源在 `apps/web/src/marketplace/eco-mall-data.ts` 末尾：

```ts
export const EMPLOYEE_IMAGE_PATHS: Record<string, string> = {
  "ip-position": "/avatars/ip-position.png",
  topic: "/avatars/topic.png",
  copywriter: "/avatars/copywriter.png",
  "video-diag": "/avatars/video-diag.png",
  "live-host": "/avatars/live-host.png",
  "live-coach": "/avatars/live-coach.png",
  "sales-coach": "/avatars/sales-coach.png",
  private: "/avatars/private.png"
};
```

通过 `employeeImagePath()` 被商城首页、详情弹窗等消费。**替换前请先全仓核对引用点**：

```bash
cd /opt/baolu-os-v2/apps/web/src
grep -rn "avatars/" .
```

已知可能还有直接写 `/avatars/xxx.png` 的位置（详情页 / 对话页），以 grep 结果为准，统一改。

## 4. 实施步骤（推荐方案 B：改扩展名，图片体积小一半）

### 4.1 替换图片文件

```bash
# 服务器或仓库内，把 8 张 jpg 拷入 public/avatars/
cp docs/prototypes/avatars-20260923/*.jpg apps/web/public/avatars/
# 旧 png 可先保留不删（回滚方便），确认全量验收后再清理
```

### 4.2 修改引用路径

`apps/web/src/marketplace/eco-mall-data.ts` 中 `EMPLOYEE_IMAGE_PATHS` 的 8 个值：`.png` → `.jpg`。
其余 grep 出来的引用点同步修改。

### 4.3 本地验证 + typecheck

```bash
pnpm --filter @baolu/web build   # 或先本地 pnpm dev 看一眼
```

### 4.4 备份（项目纪律，勿跳过）

```bash
mkdir -p /opt/baolu-backups/20260924-avatar-replace-before-baolu-os-v2
cp -r /opt/baolu-os-v2/apps/web/public/avatars /opt/baolu-backups/20260924-avatar-replace-before-baolu-os-v2/
cp /opt/baolu-os-v2/apps/web/src/marketplace/eco-mall-data.ts /opt/baolu-backups/20260924-avatar-replace-before-baolu-os-v2/
# 生产两套 dist 也各打一份 tgz（参照 CURRENT_DEPLOYMENT_STATUS.md 既有条目格式）
```

### 4.5 双构建部署（生产）

```bash
# 入口一：ai.lcppch.top（根路径）
bash /opt/baolu-os-v2/scripts/build-ai-root.sh
# 入口二：api.lcppch.top/os-v2/
bash /opt/baolu-os-v2/scripts/build-os-v2-web.sh
```

（可先在测试机 `/opt/baolu-os-v2-test` 用 `VITE_BASE_PATH=/lanqi-test/` 构建验收一轮，再推生产。）

### 4.6 验收清单

- [ ] `https://ai.lcppch.top/agents`：8 张商品卡头像全部为新职业照（强刷 Ctrl+F5）
- [ ] 点击任意员工 → 详情弹窗头像为新照
- [ ] 详情页/对话页（grep 出的引用点）头像正常，控制台无 404
- [ ] 手机端（或 DevTools 手机模拟）2 列商品流正常，Network 面板确认每张头像 35-50KB
- [ ] 深色模式下头像白边正常（该样式走主题变量，理论不受影响，顺手看一眼）

### 4.7 回滚

```bash
cp /opt/baolu-backups/20260924-avatar-replace-before-baolu-os-v2/avatars/*.png /opt/baolu-os-v2/apps/web/public/avatars/
# eco-mall-data.ts 引用改回 .png，重跑 4.5 两个构建脚本
```

### 4.8 台账

完成后在 `docs/CURRENT_DEPLOYMENT_STATUS.md` 追加条目 `20260924-avatar-replace`（格式参照既有条目：发布方式 / 验收结果 / 备份与回滚）。

## 5. 效果预览

设计评审用 demo（双击本地打开，无需服务）：

- `docs/prototypes/avatar-showcase-demo-20260923.html` — 8 张新照的商品卡效果 + 详情页两种图位方案 + 交接映射表
- `docs/prototypes/agent-product-detail-demo-20260923.html` — 商品详情页原型（含 AI 实况演示大图位、缩略图第 2 格为新照片直铺效果）

本文档只覆盖**头像替换**这一件事。商品详情页原型（含 AI 演示图位）为后续独立需求，暂不实施。

## 6. 联系

照片风格调整 / 新增员工照片，联系设计侧重新生成（豆包文生图，统一 prompt 模板见 `docs/prototypes/avatar-showcase-demo-20260923.html` 页脚）。
