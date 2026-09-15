import { readFileSync } from "node:fs";

const scanFiles = [
  "apps/web/src/pages/MarketplaceApp.tsx",
  "apps/web/src/styles/marketplace.css",
  "apps/api/src/routes/marketplace.ts",
  "apps/api/src/services/marketplace-catalog.ts",
  // 2026-09-15 文案口径落地后，真正渲染给客户的页面都在 apps/web/src/marketplace/ 下，
  // 一并纳入扫描（后台 AdminConsolePage / AdminPage 属内部页面，不在此列）。
  "apps/web/src/marketplace/shell.tsx",
  "apps/web/src/marketplace/HomePage.tsx",
  "apps/web/src/marketplace/AgentDetailPage.tsx",
  "apps/web/src/marketplace/AgentChatPage.tsx",
  "apps/web/src/marketplace/MinePage.tsx",
  "apps/web/src/marketplace/chat-flows.ts",
  "apps/web/src/pages/RechargePage.tsx"
  // LoginPage.tsx 有意不纳入：它是**产品品牌化**页面（兰琪/美业等按产品切换文案，
  // 例如「例如：兰琪某某门店」），会与本扫描的「真实客户名」规则冲突；其平台侧文案已人工核对。
];

// 只扫用户可见文案中出现的高危词/真实客户词。代码内部标识（skill/profile 等）
// 不作为命中，避免把变量名和类型名误判为 UI 文案。
const forbiddenUiPatterns = [
  { pattern: /人民币/, label: "人民币" },
  { pattern: /AI反问/, label: "AI反问" },
  { pattern: /贴膜小子|兰琪|枕水江南|李沐珊/, label: "真实客户名" },
  { pattern: /保禄·|我是.*保禄/, label: "非思潼品牌口径" },
  // 2026-09-15 用户口径：客户界面不出现「按次使用」与「扣积分 / 扣费 / 统一积分钱包扣」这类计费感话术；
  // 积分只在交付后以「本次消耗 N 积分」的形式告知（不前置报价）。
  { pattern: /按次使用/, label: "按次使用（计费感话术，改成直接讲交付物）" },
  { pattern: /积分钱包扣|从.{0,6}钱包扣|钱包两处用/, label: "钱包扣费话术（改成「共用同一份积分」）" },
  { pattern: /扣积分|扣费/, label: "扣积分/扣费话术（改成「消耗积分」或中性表述）" },
  { pattern: /免费重做已下线/, label: "免费重做已下线（负面表述，改成「需要再要一份，重新发起即可」）" }
];

const issues: string[] = [];
for (const file of scanFiles) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    const value = line.trim();
    // 跳过注释、import、类型/变量声明，避免内部代码被当成 UI 文案。
    if (value.startsWith("//") || value.startsWith("/*") || value.startsWith("*")) return;
    if (value.startsWith("import ") || value.startsWith("export interface ")) return;
    for (const rule of forbiddenUiPatterns) {
      if (rule.pattern.test(line)) {
        issues.push(`${file}:${index + 1} hit=${rule.label}`);
      }
    }
  });
}

if (issues.length > 0) {
  console.error(issues.join("\n"));
  process.exit(1);
}
console.log("PASS marketplace-copy-scan");
