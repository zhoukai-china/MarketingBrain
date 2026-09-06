import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

const requiredFiles = [
  "docs/agents/AGENTS.md",
  "docs/agents/README.md",
  "docs/agents/_templates/TASK_TEMPLATE.md",
  "docs/agents/platform-tasks.md",
  "docs/SOLO_AGENT_DEVELOPMENT.md",
  ...["takeaway-growth", "founder-ip-acquisition", "lanqi-beauty"].flatMap(
    (product) =>
      ["PRODUCT.md", "WORKFLOW.md", "CONTRACTS.md", "TEST_MATRIX.md", "STATUS.md", "tasks/README.md"].map(
        (file) => `docs/agents/${product}/${file}`,
      ),
  ),
  "docs/agents/lanqi-beauty/KNOWLEDGE_GOVERNANCE.md",
  "docs/PRODUCT_PLATFORM_ARCHITECTURE.md",
];

const failures = [];
const contents = new Map();

for (const relativePath of requiredFiles) {
  try {
    const content = readFileSync(resolve(root, relativePath), "utf8");
    contents.set(relativePath, content);
    if (content.trim().length < 20) failures.push(`${relativePath} 内容为空或不完整`);
  } catch {
    failures.push(`${relativePath} 不存在或不可读`);
  }
}

const markerChecks = [
  ["docs/agents/AGENTS.md", ["takeaway-growth", "founder-ip-acquisition", "lanqi-beauty", "一个对话/任务只负责一个主要用户结果"]],
  ["docs/agents/founder-ip-acquisition/PRODUCT.md", ["招商加盟", "C 端团购到店", "学员招募", "合作方招募"]],
  ["docs/agents/lanqi-beauty/PRODUCT.md", ["兰琪方法论", "内部定价", "不另造"]],
  ["docs/agents/lanqi-beauty/CONTRACTS.md", ["推荐关系不等于数据访问权", "重复扣费", "跨租户"]],
  ["docs/agents/lanqi-beauty/KNOWLEDGE_GOVERNANCE.md", ["K1 兰琪授权核心知识", "K2 兰琪总部私密知识", "K3 门店私有知识", "K4 任务临时上下文"]],
  ["docs/SOLO_AGENT_DEVELOPMENT.md", ["最多同时进行两个编码任务", "仓库文件才是可验证的交接依据"]],
];

for (const [relativePath, markers] of markerChecks) {
  const content = contents.get(relativePath) ?? "";
  for (const marker of markers) {
    if (!content.includes(marker)) failures.push(`${relativePath} 缺少关键规则：${marker}`);
  }
}

const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
for (const script of ["agent:development-architecture-smoke", "qa:takeaway", "qa:founder-ip-acquisition", "qa:lanqi-foundation"]) {
  if (!packageJson.scripts?.[script]) failures.push(`package.json 缺少脚本：${script}`);
}

if (failures.length > 0) {
  console.error("智能体开发架构检查失败：");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`智能体开发架构检查通过：${requiredFiles.length} 个文件，3 个产品入口。`);
