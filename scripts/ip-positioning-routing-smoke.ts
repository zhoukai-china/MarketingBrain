import assert from "node:assert/strict";
import { resolveAcquisitionWorkbenchCapability } from "../apps/api/src/services/acquisition-workbench-routing.js";
import { isIpPositioningDelivery, scopeAcquisitionCapabilityHistory } from "../apps/web/src/lib/acquisition-routing.js";

assert.equal(resolveAcquisitionWorkbenchCapability(
  "旧任务正在做投流，账户 client_id 待补",
  "【IP定位系统｜知识库一键生成】\n生成正式IP定位方案"
), "ip_positioning", "IP定位工作台标记必须压过旧投流上下文");
assert.equal(resolveAcquisitionWorkbenchCapability("【投流系统｜问题问答】"), "paid_traffic");

const scoped = scopeAcquisitionCapabilityHistory([
  { role: "user" as const, content: "【投流系统｜问题问答】" },
  { role: "assistant" as const, content: "投流结论", capabilityId: "paid_traffic" },
  { role: "user" as const, content: "【IP定位系统｜知识库一键生成】" },
  { role: "assistant" as const, content: "# IP定位全案", capabilityId: "ip_positioning" }
], "ip_positioning");
assert.equal(scoped.length, 2, "IP定位请求不得携带此前投流历史");
assert.equal(isIpPositioningDelivery("投流结论 client_id 待补 P0动作"), false);
assert.equal(isIpPositioningDelivery("# IP定位全案\n## 1分钟速览\n## 项目定位"), true);

console.log("IP positioning routing smoke passed.");
