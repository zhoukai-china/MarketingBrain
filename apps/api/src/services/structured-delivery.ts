import type {
  AgentReasoningProfile,
  StableAgentDelivery,
  StableDeliveryBlock,
  StableDeliveryCapabilityId
} from "@baolu/shared";

const stableCapabilities = new Set<StableDeliveryCapabilityId>([
  "topic_inspiration",
  "content_plan",
  "paid_traffic",
  "video_review"
]);

const capabilityContracts: Record<StableDeliveryCapabilityId, {
  required: RegExp[];
  forbidden: RegExp[];
}> = {
  topic_inspiration: {
    required: [/来源|证据/, /TOP\s*10|10\s*条|十条/, /选题/, /待验证|待核验|证据边界/],
    forbidden: [/完整内容执行包/, /口播逐字稿/, /拍摄脚本/, /剪辑EDL/]
  },
  content_plan: {
    required: [/选题/, /口播|文案/, /拍摄|分镜/, /发布|标题/, /评论|私信|承接/],
    forbidden: [/数据质量审计/, /视频分层/, /执行草案[\s\S]{0,80}止损条件/]
  },
  paid_traffic: {
    required: [/投流判断|是否建议投/, /投放目标/, /素材\s*A\s*\/\s*B|素材测试/, /预算/, /监控指标/, /止损/, /复盘/, /执行草案/],
    forbidden: [/完整内容执行包/, /口播逐字稿/, /拍摄脚本/, /剪辑EDL/]
  },
  video_review: {
    required: [/数据质量审计/, /数据总览/, /视频分层|作品分层/, /趋势|样本不足/, /证据|待验证/, /下周期|下一轮/],
    forbidden: [/完整内容执行包/, /口播逐字稿/, /拍摄脚本/, /剪辑EDL/]
  }
};

export function isStableDeliveryCapability(value: string | undefined): value is StableDeliveryCapabilityId {
  return Boolean(value && stableCapabilities.has(value as StableDeliveryCapabilityId));
}

export function resolveReasoningProfile(
  capabilityId: string | undefined,
  skillId?: string
): AgentReasoningProfile {
  if (capabilityId === "image_prompt_preview" || skillId === "lanqi-image-prompt-enhancer") return "standard";
  if (capabilityId === "xiaohongshu_copy" || skillId === "xiaohongshu_ops") return "deep";
  if (capabilityId === "paid_traffic" || capabilityId === "video_review") return "deep";
  if (capabilityId === "topic_inspiration" || capabilityId === "content_plan") return "standard";
  return skillId === "baolu_review_engine" ? "deep" : "standard";
}

export function buildStableAgentDelivery(params: {
  capabilityId?: string;
  answerText: string;
}): StableAgentDelivery | undefined {
  if (!isStableDeliveryCapability(params.capabilityId)) return undefined;
  const capabilityId = params.capabilityId;
  const answerText = params.answerText.trim();
  const parsed = parseDocument(answerText);
  const issues = validateDocument(capabilityId, answerText, parsed.blocks);
  return {
    version: "1.0",
    capabilityId,
    title: parsed.title || defaultTitle(capabilityId),
    intro: parsed.intro,
    blocks: parsed.blocks.length > 0
      ? parsed.blocks
      : [{ id: "summary-1", type: "summary", title: "交付结果", content: answerText, marker: "结论" }],
    fallbackMarkdown: answerText,
    validation: {
      status: issues.length === 0 ? "valid" : "degraded",
      issues
    }
  };
}

function parseDocument(content: string): { title: string; intro: string; blocks: StableDeliveryBlock[] } {
  const lines = content.split(/\r?\n/);
  const firstNonEmptyIndex = lines.findIndex((line) => line.trim());
  let title = "";
  if (firstNonEmptyIndex >= 0 && !parseHeading(lines[firstNonEmptyIndex])) {
    title = cleanLine(lines[firstNonEmptyIndex]);
    lines.splice(firstNonEmptyIndex, 1);
  }

  const introLines: string[] = [];
  const blocks: StableDeliveryBlock[] = [];
  let current: StableDeliveryBlock | undefined;
  for (const line of lines) {
    const heading = parseHeading(line);
    if (heading) {
      current = {
        id: `block-${blocks.length + 1}`,
        type: heading.type,
        title: heading.title,
        marker: heading.marker,
        content: ""
      };
      blocks.push(current);
      continue;
    }
    if (current) current.content = joinLine(current.content, line);
    else introLines.push(line);
  }

  return {
    title,
    intro: introLines.join("\n").trim(),
    blocks: blocks
      .map((block) => ({ ...block, content: block.content.trim() }))
      .filter((block) => block.content.length > 0)
  };
}

function parseHeading(line: string): Pick<StableDeliveryBlock, "type" | "title" | "marker"> | undefined {
  const cleaned = cleanLine(line);
  if (!cleaned) return undefined;
  if (/^(?:短结论|核心结论|综合诊断结论)$/.test(cleaned)) {
    return { type: "summary", title: cleaned, marker: "结论" };
  }
  if (/^(?:合规提醒|风险提醒|风险与边界|证据边界)$/.test(cleaned)) {
    return { type: "warning", title: cleaned, marker: "!" };
  }
  if (/^(?:下一步|今日动作|待验证动作与证据边界|下周期选题建议|继续执行)$/.test(cleaned)) {
    return { type: "next_steps", title: cleaned, marker: "→" };
  }
  // Bare Arabic numbers are usually list items inside a delivery (for example
  // TOP 10), so only accept Chinese section numbers or an explicit "第 N".
  const numbered = cleaned.match(/^(?:([一二三四五六七八九十零]+)|第\s*(\d+)(?:章|部分)?)[、.）):：]\s*(.{2,64})$/);
  if (numbered) return { type: "section", title: numbered[3], marker: numbered[1] ?? numbered[2] };
  const markdownHeading = line.trim().match(/^#{2,4}\s+(.{2,64})$/);
  if (markdownHeading) return { type: "section", title: cleanLine(markdownHeading[1]), marker: "§" };
  return undefined;
}

function validateDocument(
  capabilityId: StableDeliveryCapabilityId,
  content: string,
  blocks: StableDeliveryBlock[]
): string[] {
  const contract = capabilityContracts[capabilityId];
  const issues: string[] = [];
  const missing = contract.required.filter((pattern) => !pattern.test(content));
  if (missing.length > 0) issues.push(`missing_required_content:${missing.length}`);
  if (contract.forbidden.some((pattern) => pattern.test(content))) issues.push("cross_capability_content");
  if (blocks.length === 0) issues.push("unstructured_answer");
  if (blocks.some((block) => block.content.length > 12_000)) issues.push("oversized_section");
  return issues;
}

function cleanLine(value: string): string {
  return value
    .trim()
    .replace(/^#{1,6}\s*/, "")
    .replace(/^\*\*(.+)\*\*$/, "$1")
    .replace(/^[>\-]\s+/, "")
    .trim();
}

function joinLine(current: string, next: string): string {
  return current ? `${current}\n${next}` : next;
}

function defaultTitle(capabilityId: StableDeliveryCapabilityId): string {
  if (capabilityId === "topic_inspiration") return "选题系统交付";
  if (capabilityId === "content_plan") return "内容系统交付";
  if (capabilityId === "paid_traffic") return "投流系统交付";
  return "复盘系统交付";
}
