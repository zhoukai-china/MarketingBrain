import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const targets = [
  path.join(root, "mcp-skills", "skills", "baolu_content_creator", "SKILL.md"),
  path.join(root, "packages", "skills", "skills", "baolu_content_creator", "prompt.md")
];
const referencePaths = [
  path.join(root, "mcp-skills", "skills", "baolu_content_creator", "references", "edl-template.md"),
  path.join(root, "packages", "skills", "skills", "baolu_content_creator", "references", "edl-template.md")
];

const failures = [];
const documents = targets.map((target) => ({ target, text: readRequired(target) }));

for (const document of documents) {
  const tenPieceOrder = [
    "一、选题策划",
    "二、口播逐字稿",
    "三、访谈话术",
    "四、拍摄脚本",
    "五、拍摄注意事项",
    "六、剪辑EDL",
    "七、发布标题与话题",
    "八、最佳发布时间",
    "九、评论区引导话术",
    "十、投流建议"
  ];
  const shooting = section(document.text, "输出四：拍摄脚本", "输出五：拍摄注意事项");
  const edl = section(document.text, "输出六：剪辑EDL文件", "输出七：发布标题与话题标签");
  const traffic = section(document.text, "输出十：", "核心文件");
  const attribution = section(document.text, "租户与署名边界", "思潼内容创作引擎 V3");

  verifyOrderedStructures(document.target, "content_v5_ten_piece_order", document.text, tenPieceOrder);
  verifyScenario(document.target, "interview_script_contract", document.text, ["输出三：访谈话术", "一问一答", "不得编造"]);
  verifyScenario(document.target, "fixed_and_mobile_shooting", shooting, ["固定机位拍摄场景", "移动拍摄场景", "画中画补拍素材", "访谈补拍"]);
  verifyScenario(document.target, "edl_delivery", edl, ["剪辑原则", "段落时间线", "配乐（BGM）", "字幕与特效"]);
  verifyScenario(document.target, "safe_paid_traffic_routing", traffic, ["PREVIEW_ONLY", "dou_plus_ads", "optimize_local_push_ads", "baolu_ad_manager"]);
  verifyScenario(document.target, "tenant_signature_isolation", attribution.replaceAll("`", ""), ["当前 tenant/brand", "明确提供", "授权", "未提供则不署名"]);

  if (/\b(?:\d{2,}|2000-5000)元\b|消耗2000-5000/.test(traffic)) {
    failures.push(`${document.target}: paid-traffic routing still embeds fixed budget or execution-calendar guidance`);
  }
  if (!/不得(?:充值|提交计划|自动投放)|不(?:充值|提交计划|自动投放)/.test(traffic)) {
    failures.push(`${document.target}: paid-traffic routing does not prohibit external execution`);
  }
  if (/^author\s*:/m.test(document.text)) {
    failures.push(`${document.target}: fixed author metadata remains`);
  }
}

for (const referencePath of referencePaths) {
  const reference = readRequired(referencePath);
  verifyScenario(referencePath, "edl_reference", reference, ["剪辑原则", "段落时间线", "配乐（BGM）", "字幕与特效", "待补"]);
}

if (failures.length > 0) {
  throw new Error(`baolu_content_creator_sync_smoke_failed:\n${failures.join("\n")}`);
}

console.log("BAOLU_CONTENT_CREATOR_SYNC_SMOKE_OK");

function readRequired(filePath) {
  if (!existsSync(filePath)) throw new Error(`missing_required_asset:${filePath}`);
  return readFileSync(filePath, "utf8");
}

function section(text, startHeading, endHeading) {
  const start = text.indexOf(startHeading);
  const end = start < 0 ? -1 : text.indexOf(endHeading, start + startHeading.length);
  return start >= 0 ? text.slice(start, end >= 0 ? end : undefined) : "";
}

function verifyScenario(filePath, scenarioId, text, requiredStructures) {
  const missing = requiredStructures.filter((value) => !text.includes(value));
  if (missing.length > 0) {
    failures.push(`${filePath}: ${scenarioId} missing structured behaviors: ${missing.join(", ")}`);
  }
}

function verifyOrderedStructures(filePath, scenarioId, text, requiredStructures) {
  let previousIndex = -1;
  for (const value of requiredStructures) {
    const index = text.indexOf(value, previousIndex + 1);
    if (index < 0) {
      failures.push(`${filePath}: ${scenarioId} missing ordered structure: ${value}`);
      return;
    }
    previousIndex = index;
  }
}
