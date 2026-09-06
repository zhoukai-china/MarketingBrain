import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const topicWorkbench = readFileSync(new URL("../apps/web/src/components/acquisition/TopicSystemWorkbench.tsx", import.meta.url), "utf8");
const contentWorkbench = readFileSync(new URL("../apps/web/src/components/acquisition/ContentSystemWorkbench.tsx", import.meta.url), "utf8");
const productPage = readFileSync(new URL("../apps/web/src/pages/AgentProductsApp.tsx", import.meta.url), "utf8");
const routes = readFileSync(new URL("../apps/api/src/routes/agents.ts", import.meta.url), "utf8");

assert.match(topicWorkbench, /onOpenContentSystem:\s*\(selection:\s*FounderIpContentSelection\)/, "选题结果必须选择一条结构化选题后才能进入内容系统");
assert.match(topicWorkbench, /用此选题进入内容系统/, "选题结果必须提供逐条选择入口，而非只有无上下文的总跳转");
assert.match(topicWorkbench, /进入内容系统失败/, "内容草稿创建失败必须在选题页面明确显示，且不能允许重复点击");
assert.match(productPage, /founderIpContentDraft/, "内容系统必须保存当前 FIP 内容草稿标识并在刷新后恢复");
assert.match(productPage, /获客目标简报/, "选题到内容的生成请求必须携带用户可见的获客目标简报上下文");
assert.match(contentWorkbench, /当前已选选题/, "内容系统必须展示从选题系统带入的当前选题上下文");
assert.match(contentWorkbench, /保存内容草稿/, "内容草稿必须支持显式保存");
assert.match(contentWorkbench, /buildFounderIpSafeFallbackDraft/, "内容服务异常时必须只生成事实受控的待补草稿，而不是把异常写入草稿");
assert.match(contentWorkbench, /不会开放投流预览/, "内容生成超时或失败不得被写入草稿，更不得开放投流预览");
assert.match(productPage, /latestContentGenerationError/, "最终交付层必须将内容生成异常与可用草稿严格区分");
assert.match(contentWorkbench, /返回选题系统重新选择/, "内容系统必须允许回到选题系统重新选择");
assert.match(contentWorkbench, /进入投流系统查看预览/, "完成草稿后只能提供投流预览入口");
assert.match(routes, /founder-ip-content-drafts/, "服务端必须提供受租户保护的 FIP 内容草稿保存与恢复接口");
assert.doesNotMatch(contentWorkbench, /LanqiContentDraft|兰琪/, "FIP 内容草稿不得接入兰琪内容模型或用户资料");

console.log("founder_ip_content_draft_closure_smoke:PASS");
