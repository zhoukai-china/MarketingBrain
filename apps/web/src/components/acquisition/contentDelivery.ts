// 内容系统的结果分段规则：以 WorkBuddy 的 content-create-standard-output 为唯一交付合同。
// “主选题：”“标题：”属于正文；只有带中文序号的九个栏目才能开启新卡片。
const DELIVERY_SECTIONS = [
  { title: "选题策划", pattern: /^一[、.．]\s*(?:选题(?:策划)?|主题)(?:\s.*|[：:].*)?$/ },
  { title: "口播逐字稿", pattern: /^二[、.．]\s*(?:可直接发布的文案|口播(?:逐字稿|文案)?|文案)(?:\s.*|[：:].*|[（(].*)?$/ },
  { title: "拍摄脚本", pattern: /^三[、.．]\s*(?:可直接拍摄的脚本[：:]?\s*)?拍摄脚本(?:\s.*|[：:].*)?$/ },
  { title: "拍摄注意事项", pattern: /^四[、.．]\s*拍摄注意事项(?:\s.*|[：:].*)?$/ },
  { title: "剪辑EDL文件", pattern: /^五[、.．]\s*剪辑\s*EDL(?:文件)?(?:\s.*|[：:].*)?$/i },
  { title: "发布标题与话题标签", pattern: /^六[、.．]\s*发布标题(?:与话题(?:标签)?|话题(?:标签)?)?(?:\s.*|[：:].*)?$/ },
  { title: "最佳发布时间", pattern: /^七[、.．]\s*(?:最佳)?发布时间(?:\s.*|[：:].*)?$/ },
  { title: "评论区引导话术", pattern: /^八[、.．]\s*评论区(?:引导)?话术(?:\s.*|[：:].*)?$/ },
  { title: "投流建议", pattern: /^九[、.．]\s*投流建议(?:\s.*|[：:].*)?$/ }
];

function normalizeDeliveryHeadingContent(content: string): string {
  // 模型偶尔会把“。六、发布标题...”接在 EDL 行尾；先只在句末切开，避免误切正文中的“标题”。
  const inlineFixed = content.replace(
    /(。|；|;)\s*(?=[一二三四五六七八九][、.．]\s*(?:选题|主题|可直接发布的文案|口播|文案|可直接拍摄的脚本|拍摄脚本|拍摄注意事项|剪辑\s*EDL|发布标题|发布时间|评论区|投流建议))/g,
    "$1\n"
  );
  return inlineFixed.split(/\r?\n/).flatMap((rawLine) => {
    const clean = rawLine.trim().replace(/^#{1,6}\s*/, "").replace(/\*\*/g, "");
    const definition = DELIVERY_SECTIONS.find((item) => item.pattern.test(clean));
    if (!definition) return [rawLine];
    const ordinal = ["一", "二", "三", "四", "五", "六", "七", "八", "九"][DELIVERY_SECTIONS.indexOf(definition)];
    const canonicalHeading = `${ordinal}、${definition.title}`;
    const headingMatch = clean.match(/^([一二三四五六七八九][、.．][^：:]*)(?:[：:]\s*(.*))?$/);
    const inlineBody = headingMatch?.[2]?.trim();
    return inlineBody ? [canonicalHeading, inlineBody] : [canonicalHeading];
  }).join("\n");
}

export type DeliverySection = { title: string; lines: string[] };

export function splitContentDelivery(content: string): { preface: string[]; sections: DeliverySection[] } {
  const preface: string[] = [];
  const sections: DeliverySection[] = [];
  let current: DeliverySection | undefined;
  for (const rawLine of normalizeDeliveryHeadingContent(content).split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^#{1,6}\s*/, "").replace(/\*\*/g, "");
    if (!line || /^(?:完整内容执行包|短视频脚本完整版)$/.test(line)) continue;
    const definition = DELIVERY_SECTIONS.find((item) => item.pattern.test(line));
    if (definition) {
      current = { title: definition.title, lines: [] };
      sections.push(current);
      continue;
    }
    if (current) current.lines.push(rawLine);
    else preface.push(rawLine);
  }
  return { preface, sections };
}
