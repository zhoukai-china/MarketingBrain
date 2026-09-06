export const BEAUTY_CONTENT_WORKFLOW_VERSION = "content_workflow_v1" as const;

export interface BeautyContentWorkflowInput {
  version: typeof BEAUTY_CONTENT_WORKFLOW_VERSION;
  topic: string;
  objective: string;
  targetAudience: string;
  platform: string;
  format?: string;
  duration?: string;
  presenter?: string;
  projectFacts?: string;
  shootingConstraints?: string;
  sourceTopic?: {
    topic: string;
    audience: string;
    sourceEvidence: string;
    factBoundary: string;
    goalRelation: string;
  };
}

export function buildBeautyContentWorkflowDirective(input: BeautyContentWorkflowInput): string {
  return [
    `【内容任务结构化简报｜${BEAUTY_CONTENT_WORKFLOW_VERSION}】`,
    `选题：${input.topic}`,
    `本轮目标：${input.objective}`,
    `目标顾客：${input.targetAudience}`,
    `发布平台：${input.platform}`,
    `内容形式：${input.format || "待补；根据已确认目标给出可执行建议"}`,
    `建议时长：${input.duration || "待补；不得自行写成门店已确认事实"}`,
    `出镜/表达主体：${input.presenter || "待补"}`,
    `已确认项目与服务事实：${input.projectFacts || "待补；禁止编造价格、疗效、案例或顾客经历"}`,
    `拍摄与素材约束：${input.shootingConstraints || "待补；默认不得使用未授权顾客肖像或门店场景"}`,
    input.sourceTopic
      ? [
          "【从选题系统承接的已选条目】",
          `选题：${input.sourceTopic.topic}`,
          `目标顾客：${input.sourceTopic.audience}`,
          `来源证据：${input.sourceTopic.sourceEvidence}`,
          `事实边界：${input.sourceTopic.factBoundary}`,
          `与获客目标关系：${input.sourceTopic.goalRelation}`,
          "仅承接这一条已选选题；不得重新生成 TOP10，不得把其他候选或模型推断晋升为门店事实。"
        ].join("\n")
      : "【直接进入】用户没有从选题系统承接；只围绕上面的本次任务生成，不得声称已运行选题系统。",
    "未确认的可选事实只进入末尾“质量与合规检查”，不得把【待补】、核验、回执或内部流程词写进十件正式交付；不得用模板、跨产品示例或其他客户数据补齐。"
  ].join("\n");
}

export function buildBeautyContentSourceSummary(input: BeautyContentWorkflowInput): string {
  if (!input.sourceTopic) return "";
  return [
    `已选选题：${input.sourceTopic.topic}`,
    `目标顾客：${input.sourceTopic.audience}`,
    `来源证据：${input.sourceTopic.sourceEvidence}`,
    `事实边界：${input.sourceTopic.factBoundary}`,
    `与获客目标关系：${input.sourceTopic.goalRelation}`
  ].join("\n");
}
