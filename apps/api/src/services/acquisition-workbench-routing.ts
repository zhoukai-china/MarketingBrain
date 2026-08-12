const WORKBENCH_MARKERS: Array<[RegExp, string]> = [
  [/【IP定位系统｜(?:知识库一键生成|资料生成定位|定位修改对话)】|IP定位全案修改/, "ip_positioning"],
  [/【选题系统｜|【Topic System｜/, "topic_inspiration"],
  [/【内容系统｜批量内容生成】|【Content System｜Refinement】/, "content_plan"],
  [/【内容系统｜拍剪优化】/, "shooting_editing"],
  [/【投流系统｜/, "paid_traffic"],
  [/【视频复盘系统｜/, "video_review"],
  [/【直播系统｜/, "live_script"],
  [/【直播复盘系统｜/, "live_review"]
];

/** Workbench buttons are an explicit contract, not a routing suggestion. */
export function resolveAcquisitionWorkbenchCapability(...inputs: Array<string | undefined>): string | undefined {
  const content = inputs.filter(Boolean).join("\n");
  return WORKBENCH_MARKERS.find(([pattern]) => pattern.test(content))?.[1];
}
