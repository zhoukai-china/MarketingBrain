# 环境相关 URL 配置说明（去写死）

把所有「写死的网址 / 域名」统一抽到了环境变量，按环境配置即可，不用改代码。

## 核心思路

- **一个中枢变量 `PUBLIC_WEB_BASE_URL`**：站点公开根址。
  - 前端 `VITE_PUBLIC_WEB_BASE_URL`（构建期注入，未配则回退生产值）
  - 后端 `PUBLIC_WEB_BASE_URL`（运行时环境变量，未配则回退 `/os-v2/`）
  - 它同时携带「域名」和「部署子路径」两部分，例如 `https://api.lcppch.top/os-v2` 或 `https://api.lcppch.top/lanqi-test`。
- 其余所有对外绝对地址都由它**派生**，不再写死：
  - `PUBLIC_API_BASE_URL = PUBLIC_WEB_BASE_URL + /api`
  - webhook / MCP / 微信回跳 = 在上面的基址上拼具体路径。
- 微信回跳地址多一层保险：没显式配置时，自动用「当前打开页面的域名 + 应用路径」，本地 / 内测不会错指到生产。

## 变量清单

| 原写死值 | 现在由谁控制 | 默认值（生产） | 说明 |
|---|---|---|---|
| `https://api.lcppch.top/os-v2/api/integrations/workbuddy/mcp`（RechargePage） | `VITE_PUBLIC_WEB_BASE_URL` 派生 `WORKBUDDY_MCP_PUBLIC_URL` | 同上 | 充值页「接入指令」展示；也会被接口返回值覆盖 |
| `https://api.lcppch.top/os-v2/api/audio-card-webhooks/getnote`（AudioCardView） | `VITE_PUBLIC_WEB_BASE_URL` 派生 `AUDIO_CARD_WEBHOOK_BASE_URL` | 同上 | 给得到大脑回调的绝对地址 |
| `https://api.lcppch.top/os-v2/api/audio-card-webhooks/feishu`（AudioCardView） | 同上 | 同上 | 给飞书回调的绝对地址 |
| `https://api.getnote.cn/recordings/recent?source=sitong`（AudioCardView） | `VITE_GETNOTE_RECENT_URL`（独立第三方） | 同上 | 第三方固定服务，可单独覆盖 |
| `https://open.weixin.qq.com/connect/oauth2/authorize?...`（LoginPage / WeChatBridgePage） | **不抽**（微信官方固定端点，永远不变） | — | 仅 `redirect_uri` 参数走配置 |
| 微信 `redirect_uri` | `VITE_WECHAT_AUTH_REDIRECT_URI`，未配则「当前域名自适应」 | 当前域名 + `/wechat-callback` | 部署脚本已注入 `${PUBLIC_BASE_URL}/wechat-callback` |
| 后端 `audio-cards.ts` host 兜底 `api.lcppch.top` | `PUBLIC_WEB_BASE_URL` 解析 | 解析出 `api.lcppch.top` | 极端兜底，请求头无 host 时才用 |
| 后端 `audio-cards.ts` 路径前缀 `/os-v2` | `PUBLIC_WEB_BASE_URL` 解析 | `/os-v2` | 现在按部署子路径自动拼，内测 `/lanqi-test` 也正确 |
| `https://api.lcppch.top/os-v2/`（后端 `PUBLIC_WEB_BASE_URL` 默认值） | `PUBLIC_WEB_BASE_URL` | `https://api.lcppch.top/os-v2/` | 已存在，本次明确为中枢；驱动邀请链接、绑定页、webhook 路径 |

> 说明：`http://localhost:3011` 这类仅开发期兜底（本地没配 env 时回退 3011），生产走相对路径 `${base}/api`，不属「环境写死」，保持不变。

## 前端改动位置

- 新增 `apps/web/src/config/site.ts`：集中读取 `VITE_*` 并派生所有对外地址。
- `RechargePage.tsx` / `AudioCardView.tsx` / `LoginPage.tsx` / `WeChatBridgePage.tsx` 改为从 `site.ts` 取，删掉各自的重复内联。

## 后端改动位置

- `apps/api/src/routes/audio-cards.ts`：新增 `publicWebBase()` 从 `PUBLIC_WEB_BASE_URL` 解析出 `origin` 与 `pathPrefix`；`getRequestOrigin` 的 host 兜底与 `publicBinding` 的路径前缀都改用它。

## 不同环境怎么配

部署脚本 `scripts/bootstrap-aliyun-v2.sh` 已支持两个开关，改它们即可切环境：

```bash
WEB_BASE_PATH="/os-v2/"                       # 部署子路径（前端 base）
PUBLIC_BASE_URL="https://api.lcppch.top/os-v2" # 公开根址（前端 + 后端中枢）
```

内测实例若要正确生成 webhook / MCP 绝对地址，把这两项改成：

```bash
WEB_BASE_PATH="/lanqi-test/"
PUBLIC_BASE_URL="https://api.lcppch.top/lanqi-test"
```

> 关键：内测**必须**同时设 `VITE_PUBLIC_WEB_BASE_URL`（前端构建期）和 `PUBLIC_WEB_BASE_URL`（后端运行期）。只改一个，另一方会回退到生产值。

也可以在 `apps/web/.env`（前端）或后端 `.env` 里直接写 `VITE_PUBLIC_WEB_BASE_URL=...` / `PUBLIC_WEB_BASE_URL=...`。

## 静态声明：lanqi-hq-manifest.json

`packages/skills/lanqi-hq-manifest.json` 里的 `deployment.endpoint = https://api.lcppch.top/lanqi-hq/mcp` **不是本项目运行时注入**：它是给 WorkBuddy 平台注册兰琪 HQ 这个独立 MCP 服务时用的静态声明（另一套部署，路径是 `/lanqi-hq`，不属于本项目的 `/os-v2` 体系）。

处理方式：**部署期按环境替换**。该文件随前端打包进 `dist`，若内测要指向不同地址，在发布前用脚本 sed 替换（或在该环境单独维护一份 manifest），不要把它也塞进 `PUBLIC_WEB_BASE_URL` 体系——因为它根本不是同一个服务。
