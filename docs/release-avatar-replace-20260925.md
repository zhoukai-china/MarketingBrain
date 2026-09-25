# 发版记录 · 数字员工头像替换（前端素材替换）

- **日期**：2026-09-25
- **类型**：前端静态素材替换（纯素材，无逻辑改动）
- **来源**：`docs/HANDOFF-avatar-replace-20260924.md`（交接文档，commit `e83b27b` 已推 main）
- **新素材**：`docs/prototypes/avatars-20260923/*.jpg`（8 张 512×512 JPEG，约 307KB，旧 png 共约 11MB）
- **影响服务**：前端双包（`dist` + `dist-ai-root`），**不涉及后端 3002**。

---

## 一、改动内容

### 1.1 新增 8 张 jpg 到 `apps/web/public/avatars/`
（旧 png 保留不删，满足构建脚本自检 `avatars/ip-position.png` 且便于回滚）

| 能力核 | 旧文件 | 新文件 |
|---|---|---|
| ip-pos | ip-position.png | ip-position.jpg |
| topic | topic.png | topic.jpg |
| copy | copywriter.png | copywriter.jpg |
| vidrev | video-diag.png | video-diag.jpg |
| livescript | live-host.png | live-host.jpg |
| liverev | live-coach.png | live-coach.jpg |
| sales | sales-coach.png | sales-coach.jpg |
| moments | private.png | private.jpg |

### 1.2 修改 `apps/web/src/marketplace/eco-mall-data.ts`
头像引用**唯一源头**是 `EMPLOYEE_AVATAR_BY_CAPABILITY`（行 318–326），8 处 `.png` → `.jpg`：

```diff
 export const EMPLOYEE_AVATAR_BY_CAPABILITY: Record<string, string> = {
-  "ip-pos": "avatars/ip-position.png",
-  topic: "avatars/topic.png",
-  copy: "avatars/copywriter.png",
-  vidrev: "avatars/video-diag.png",
-  livescript: "avatars/live-host.png",
-  liverev: "avatars/live-coach.png",
-  sales: "avatars/sales-coach.png",
-  moments: "avatars/private.png"
+  "ip-pos": "avatars/ip-position.jpg",
+  topic: "avatars/topic.jpg",
+  copy: "avatars/copywriter.jpg",
+  vidrev: "avatars/video-diag.jpg",
+  livescript: "avatars/live-host.jpg",
+  liverev: "avatars/live-coach.jpg",
+  sales: "avatars/sales-coach.jpg",
+  moments: "avatars/private.jpg"
 };
```
`employeeAvatarPath()` / `EMPLOYEE_IMAGE_PATHS`（派生）/ `employeeImagePath()` / `EcoMallHomePage` / `AgentChatPage` 全部经此单一来源消费，改这 8 处即全覆盖。

> 注意：交接文档 `HANDOFF-avatar-replace-20260924.md` 已**过时**——它写的是早期硬编码 `EMPLOYEE_IMAGE_PATHS` 写法，线上实际代码已重构为 `EMPLOYEE_AVATAR_BY_CAPABILITY`。本次以线上实际代码为准。

---

## 二、备份（更新前已完成）

备份根目录：`/opt/baolu-backups/20260925-avatar-replace-before-baolu-os-v2/`

| 备份对象 | 路径 |
|---|---|
| 头像目录 | `…/avatars/`（8 张旧 png） |
| 源码 | `…/eco-mall-data.ts` |
| /os-v2 前端包 | `…/dist.tgz`（`apps/web/dist`） |
| ai-root 前端包 | `…/dist-ai-root.tgz`（`apps/web/dist-ai-root`） |

---

## 三、部署步骤

```bash
# 1) 拷 8 张 jpg 进 public/avatars（保留 png）
cp docs/prototypes/avatars-20260923/*.jpg /opt/baolu-os-v2/apps/web/public/avatars/

# 2) 改 eco-mall-data.ts 8 处 .png→.jpg（本地+服务器同步）

# 3) 双构建部署（两套必须成对，否则出现“一个域名新一个旧”）
bash /opt/baolu-os-v2/scripts/build-os-v2-web.sh     # -> dist  (api.lcppch.top/os-v2/)
bash /opt/baolu-os-v2/scripts/build-ai-root.sh        # -> dist-ai-root (ai.lcppch.top/)
```

---

## 四、动过的服务器目录

- `/opt/baolu-os-v2/apps/web/public/avatars/`（新增 8 jpg）
- `/opt/baolu-os-v2/apps/web/src/marketplace/eco-mall-data.ts`（8 处改扩展名）
- `/opt/baolu-os-v2/apps/web/dist/`（重建）
- `/opt/baolu-os-v2/apps/web/dist-ai-root/`（重建）

---

## 五、验收清单

- [ ] `https://ai.lcppch.top/avatars/ip-position.jpg` → 200 `image/jpeg`
- [ ] `https://api.lcppch.top/os-v2/avatars/ip-position.jpg` → 200 `image/jpeg`
- [ ] `https://ai.lcppch.top/agents`：8 张商品卡头像为新职业照（强刷 Ctrl+F5）
- [ ] 点击任意员工 → 详情弹窗头像为新照
- [ ] 控制台无 `/avatars/*.jpg` 404
- [ ] 手机端 2 列商品流正常，Network 确认每张头像 35–50KB
- [ ] 旧 png 仍保留（回滚用），未误删

---

## 六、回滚

```bash
# 1) 源码引用改回 .png，重跑两个构建脚本
# 2) dist/avatars、dist-ai-root/avatars 中 jpg 删除或覆盖回 png
# 或直接从备份恢复：
# tar xzf /opt/baolu-backups/20260925-avatar-replace-before-baolu-os-v2/dist.tgz -C /opt/baolu-os-v2/apps/web/
# tar xzf /opt/baolu-backups/20260925-avatar-replace-before-baolu-os-v2/dist-ai-root.tgz -C /opt/baolu-os-v2/apps/web/
```

## 七、残留 / 待办（非阻塞）

- 旧 png（约 11MB）按交接文档暂留服务器，全量验收后再清理。
- 本地 `eco-mall-data.ts` 的 `.png→.jpg` 改动 + 本记录尚未 git commit。
- `docs/CURRENT_DEPLOYMENT_STATUS.md` 已追加 `20260925-avatar-replace` 台账条目。
