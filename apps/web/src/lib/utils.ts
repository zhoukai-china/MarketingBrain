import type { MemoryState, BusinessRole } from "../types";
import { memoryDefaults, roleOptions, initialDiagnosisDoneKey } from "../data/constants";

export function getStoredMemory(): MemoryState {
  const saved = localStorage.getItem("store_os_memory");
  if (!saved) return memoryDefaults;
  try {
    return { ...memoryDefaults, ...JSON.parse(saved) };
  } catch {
    return memoryDefaults;
  }
}

export function saveStoredMemory(memory: Partial<MemoryState>) {
  const current = getStoredMemory();
  localStorage.setItem("store_os_memory", JSON.stringify({ ...current, ...memory }));
}

export function isInitialDiagnosisDone(): boolean {
  return localStorage.getItem(initialDiagnosisDoneKey) === "1";
}

export function markInitialDiagnosisDone() {
  localStorage.setItem(initialDiagnosisDoneKey, "1");
}

export function isWechatClient(): boolean {
  return /MicroMessenger/i.test(window.navigator.userAgent);
}

export function isMobileClient(): boolean {
  return /Android|iPhone|iPad|iPod|Mobile|Windows Phone|MicroMessenger/i.test(window.navigator.userAgent) || window.innerWidth <= 768;
}

export function planCodeForRole(role: BusinessRole) {
  if (role === "personal_ip") return "ip_standard" as const;
  if (role === "chain_brand") return "chain_standard" as const;
  return "local_standard" as const;
}

export function roleForPlanCode(planCode: string): BusinessRole {
  if (planCode === "ip_standard") return "personal_ip";
  if (planCode === "chain_standard") return "chain_brand";
  return "local_business";
}

export function cleanAdvisorOutput(content: string): string {
  return content
    .replace(/【[^】]*】/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatReportParagraphs(content: string): string {
  const cleaned = cleanAdvisorOutput(content);
  if (!cleaned) return "<p>暂无内容。</p>";
  return cleaned
    .split(/\n{1,}/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");
}

export function normalizeFilenamePart(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 28) || "consulting";
}

export function shouldCreateAnswerArtifact(content: string, skillId?: string): boolean {
  const cleaned = cleanAdvisorOutput(content);
  if (cleaned.length < 620) return false;
  const artifactSkills = new Set<string>([
    "baolu_topics",
    "baolu_content_creator",
    "baolu_dreamina_video",
    "baolu_finance_advisor",
    "baolu_live_review_engine",
    "baolu_review_engine",
    "baolu_shangxueyuan",
    "delivery_standardization",
    "hr_director_consultant",
    "ip_positioning",
    "live_script_planner",
    "moments_generator",
    "sales_growth_advisor"
  ]);
  return artifactSkills.has(skillId ?? "") || cleaned.length > 900;
}

export function buildBriefAdvisorReply(fullContent: string): string {
  const cleaned = cleanAdvisorOutput(fullContent);
  const paragraphs = cleaned
    .split(/\n{1,}/)
    .map((line) => line.trim())
    .filter(Boolean);
  let brief = "";
  for (const paragraph of paragraphs) {
    if (!brief) {
      brief = paragraph;
    } else if (brief.length < 360) {
      brief = `${brief}\n\n${paragraph}`;
    }
    if (brief.length >= 360) break;
  }
  if (brief.length > 520) brief = `${brief.slice(0, 500)}...`;
  return brief;
}
