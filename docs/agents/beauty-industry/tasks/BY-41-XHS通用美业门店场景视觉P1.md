# BY-41 XHS 通用美业门店场景视觉 P1

状态：已完成（2026-09-01）

## 归属

- 产品：美业智能体
- 层级：产品任务含通用美业图片交付合同与 Web 展示
- 风险：中
- 预计修改热点：确定性视觉服务、图片合同/回执、XHS 同页文案、专项与浏览器回归
- 是否允许并行：否

## 用户结果

用户确认图片后得到三张可辨识的通用美业门店场景成品，而不是只有文字和近似空白的抽象底图；页面明确这些画面不是用户真实门店实景。

## 本次范围

- 固化 2026-08-31 当前页面三张“渐变/纹理底图 + 叠字”的真实用户反馈红灯。
- 将本地零 Provider 视觉升级为三角色通用美业空间：接待咨询区、护理空间、到店承接空间。
- 页面明确“通用美业门店场景（非本店实景、默认不含人物）”；本店还原或人物场景需要已授权参考资料，当前失败关闭而不伪造。
- 保持标题叠字、3/3 交付、下载/刷新、租户、账本、幂等和品牌配置边界。

## 本次不做

- 不声称生成用户真实门店、真实顾客或真实员工；不加入未经授权的人物、Logo、项目效果、价格或案例。
- 不调用图片、文字、视频或 ASR Provider；费用必须为 ¥0。
- 不恢复 BY-19/BY-20，不部署生产。

## 验收条件

1. 正常路径：三角色底图均包含可识别的门店空间元素并通过正式安全/合成/持久化合同，最终 PNG 可预览、下载与刷新恢复。
2. 失败路径：用户要求还原本店或生成人物但未提供授权参考资料时，在积分预留前精确提示，不静默忽略或伪造。
3. 不应发生：不得继续把抽象渐变宣传为场景图；不得调用外部 Provider；不得把兰琪名称/颜色写死进通用视觉服务。
4. 可观测结果事件：只记录版本、角色、通用场景类型、元素计数、哈希、终态与账本，不记录客户原文或图片正文。

## 基线与失败证据

- 当前 `beauty-deterministic-visual-v1` 仅绘制 `soft_light_field / material_flow / spatial_ripple`，服务输入只有角色、任务哈希和品牌色；未消费门店场景合同。
- 真实页面只读截图确认三张成品均为抽象渐变/纹理底图叠字，无接待区、护理床、咨询区或其他门店空间。
- 修复前红灯：`pnpm.cmd beauty-industry:deterministic-store-scene-p1-smoke`。

## 实现记录

- 通用图片交付从 `beauty-deterministic-visual-v1` 的抽象光场升级到版本钉死的 `beauty-deterministic-visual-v2`；封面、内容、互动三角色分别生成接待咨询区、护理空间、到店承接空间，回执保存角色、场景类型、元素计数、尺寸、任务哈希、主题哈希和资产哈希。
- API quote/confirm 都先执行 `assessBeautyDeterministicSceneRequirements()`：要求还原本店实景或人物出镜但没有授权参考资料时返回 `beauty_scene_reference_required`，发生在图片任务、积分预留和任何 Provider 动作之前。
- 图片继续经正式 safety、`beauty-image-composition-v1.1`、原子持久化和 3/3 批次合同；旧 job 只有版本/交付模式不一致时按历史只读展示，不用 v2 回算。
- Web 明确标示“通用美业门店场景（非本店实景、默认不含人物）”，三张卡片分别说明空间用途；没有暴露 Provider、模型参数、内部提示词或兰琪硬编码。
- 精确文件归属：通用核心为 `apps/api/src/services/beauty-deterministic-visual.ts`、`apps/api/src/products/beauty-industry/media-contract.ts`、`apps/api/src/products/beauty-industry/media-batch.ts`、`apps/api/src/routes/beauty-industry-media.ts`、`apps/web/src/pages/BeautyIndustryAcquisitionPage.tsx`、`apps/web/src/components/acquisition/BeautyXhsWorkbench.tsx`；验证为 `scripts/beauty-industry-deterministic-store-scene-p1-smoke.ts`、`scripts/verify-beauty-deterministic-visual-browser-e2e.mjs` 和 `package.json`。品牌包只通过既有租户主题配置输入，不新增品牌事实或知识。

## 验证

- 修复前红灯：v1 回执固定为 `soft_light_field / material_flow / spatial_ripple`，真实页面三图只见渐变/纹理与叠字，没有门店空间元素；该事实由 `beauty-industry:deterministic-store-scene-p1-smoke` 的版本/场景/元素合同覆盖。
- 修复后专项：`beauty-industry:deterministic-store-scene-p1-smoke`、`deterministic-visual-delivery-p1-smoke`、`xhs-same-page-image-p1-smoke`、`media-observability-smoke` 全部 PASS，外部 Provider/网络/费用均为 0。
- 真实新批次：隔离兰琪合成租户真实 Chromium 1440/390px 生成 3 张新的 768×1024 最终 PNG，三角色、逐张预览/下载、刷新/历史、双击单 confirm、owner/跨租户 404、overflow、console/网络全部 PASS；图片 300 测试积分只结算一次，文字+图片净变化 308。
- 失败路径：同一新文字任务以“还原我的门店实景并安排顾客人物出镜”调用 confirm，返回 422 `beauty_scene_reference_required`；图片 job=0、积分余额不变、Provider=0。
- 自动门禁：API/Web/Agent typecheck、`pnpm.cmd qa:fast`、`pnpm.cmd qa:regression`、`pnpm.cmd qa:full`（含 build）和 `git diff --check` 全部 PASS。
- 视觉只读：新批次底图/最终图分别可辨识沙发/镜面/绿植接待区、护理床/灯具护理空间、双座椅/圆桌到店承接空间；不是本店实景或人物照片。

## 交接

- 本任务 P0/P1=0；PG55434、API3016、Web5176 保持同一受控 AcceptanceRoot，最终刷新后的精确 PID/指纹记录在 STATUS。
- 当前合成验收租户通过正式幂等账本脚本追加 308 测试积分，余额由 192 恢复为 500，ref=`by41-user-acceptance-20260901`；这不是人民币充值或Provider费用，只用于让用户能够亲自确认一次300积分的新场景批次。
- 验收链接：`http://127.0.0.1:5176/agents/beauty-industry/acquisition/xhs?apiBase=http%3A%2F%2F127.0.0.1%3A3016`。当前文字是清楚标示的 controlled mock 流程预览；图片为本地确定性通用场景，Provider0、费用¥0。
- 用户验收：①打开链接；②填写主题/项目/目标顾客并生成文字预览；③确认三张门店场景；④查看/逐张下载；⑤刷新确认历史恢复。本店还原或人物要求没有授权参考资料时应在生成前提示。
- 后续：不要自行恢复 BY-19/BY-20；本任务完成后进入 idle。
- 最后更新日期：2026-09-01。
