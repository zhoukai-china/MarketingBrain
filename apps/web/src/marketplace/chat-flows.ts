// 对话式使用 · 信息收集轮次（来源：WorkBuddy 原型 CHAT_FLOW，做精简版）
export interface ChatSlot {
  key: string;
  label: string;
  q: string;
  /** 有选项的槽位在前端渲染成快捷按钮，避免用户自由输入被误判（如复盘模式 / 平台）。 */
  choices?: string[];
}

export interface ChatFlow {
  name: string;
  welcome: string;
  slots: ChatSlot[];
}

export const CHAT_FLOWS: Record<string, ChatFlow> = {
  "ip-pos": {
    name: "IP 定位",
    welcome: "你好，我是思潼 · IP 定位智能体。我会按 IP 定位七步法，分几轮收集你的项目、用户、创始人信息，最后产出 IP 定位全案。",
    slots: [
      { key: "project", label: "项目基础", q: "你的项目叫什么？做什么的？赚谁的钱、怎么赚？现在什么阶段（0-1 / 1-10 / 10-100）？" },
      { key: "user", label: "目标用户", q: "你最典型的客户是谁（年龄 / 职业 / 城市 / 收入）？找你之前最痛的一件事是什么？" },
      { key: "founder", label: "创始人 + 目标", q: "你的背景、最擅长什么、身上 3 个性格关键词？做 IP 的核心目标（获客 / 招商 / 品牌）？" },
      { key: "stage", label: "IP 现状", q: "现有账号 / 平台 / 粉丝？团队 / 一周可投入时间？拍过最满意的一条是什么？" }
    ]
  },
  topic: {
    name: "选题",
    welcome: "你好，我是思潼 · 选题智能体。我会一次给 10 条选题。先确认你的行业与账号阶段，再按四个来源（录音卡 / 行业热点 / 数据复盘 / 同行爆款）逐项收集你的真实素材，最后按三关筛选框架生成。",
    slots: [
      { key: "ind", label: "行业 / 账号阶段", q: "① 你的行业 / 品牌是什么？账号在起号（0-5000粉）、增长（5000-5万）、还是变现期（5万+）？" },
      { key: "note", label: "🎙 录音卡", q: "② 把你最近的录音卡 / 语音里讲的内容贴进来（或直接给近期想法、关键词、灵感）。可选：若你有 Get笔记 API Key，在答案里带上「API_KEY=xxx」，我会用于拉取你的笔记（未接实时拉取时仅按你的录音卡内容处理）。没有就写「无」。" },
      { key: "hot", label: "🔥 行业热点", q: "③ 想追的行业热点 / 新闻 / 平台是什么？（没有就写「无」）" },
      { key: "data", label: "📊 数据复盘", q: "④ 账号后台数据：播放 / 完播 / 互动 / 涨粉大概多少？（没有就写「无」，我会把该来源配额并入①②）" },
      { key: "bench", label: "🔍 同行爆款", q: "⑤ 对标账号或看到的同行爆款：标题 / 方向 / 账号名？（没有就写「无」）" }
    ]
  },
  copy: {
    name: "文案",
    welcome: "你好，我是思潼 · 文案智能体。我会一次交付一套完整「内容十件套」（选题→口播→访谈→脚本→注意事项→剪辑EDL→标题话题→发布时间→评论引导→投流）。先确认 5 项输入。",
    slots: [
      { key: "ind", label: "① 行业 / 产品卖点", q: "① 你的行业 / 品牌，以及这次主推的产品 / 服务是什么？核心卖点？" },
      { key: "audience", label: "② 目标人群", q: "② 目标人群是谁？（年龄 / 身份 / 痛点，如：想加盟的创业者 / 爱美的上班族）" },
      { key: "platform", label: "③ 平台", q: "③ 主要发在哪个平台？抖音 / 视频号 / 小红书 / 朋友圈？" },
      { key: "duration", label: "④ 口播时长", q: "④ 口播大概多久？默认 60 秒（可填：30 / 45 / 60 / 90 秒）" },
      { key: "ctype", label: "⑤ 内容类型", q: "⑤ 内容类型：获客型（引流到店/咨询）/ 人设型（立信任）/ 流量型（涨粉曝光）？" }
    ]
  },
  vidrev: {
    name: "视频复盘",
    welcome:
      "你好，我是思潼 · 视频复盘智能体。给你交付 **1 份完整深度复盘报告**（第零章数据质量审计 + 一模十章归因 + 下周期选题建议）。\n\n开始前请先从平台后台导出近 30 天数据表格（CSV / Excel），再直接拖到对话框上传；不确定从哪导出，看上方「📥 视频数据导出指南」。",
    slots: [
      {
        key: "platform",
        label: "平台",
        q: "这批视频发在哪个平台？（一次只复盘一个平台，跨平台请分开出报告）",
        choices: ["抖音", "视频号", "小红书", "快手", "B站"]
      },
      {
        key: "data",
        label: "数据",
        q: "把导出的表格（CSV / Excel）拖进对话框上传，然后跟我说「复盘」就行。"
      }
    ]
  },
  livescript: {
    name: "直播话术",
    welcome: "你好，我是思潼 · 直播话术智能体。给我场次和产品信息，我出可开播的逐字稿。",
    slots: [
      { key: "type", label: "场次类型", q: "这场是带货还是招商？大概播多久？" },
      { key: "prod", label: "产品 / 卖点", q: "主推什么？核心卖点、价格或加盟政策是？" },
      { key: "goal", label: "主打动作", q: "最想让观众做什么？下单、留资、领券、加微？" }
    ]
  },
  liverev: {
    name: "直播复盘",
    welcome: "你好，我是思潼 · 直播复盘智能体。给我直播数据，我做定量 + 定性双维复盘。",
    slots: [
      { key: "type", label: "场次类型", q: "这场是带货还是招商？核心目标是什么？" },
      { key: "data", label: "数据", q: "观看 / 平均停留 / 转化 / GMV 大概多少？" },
      { key: "rec", label: "录音", q: "有没有直播录音卡 / 回放？有的话我能精确定位话术问题。" }
    ]
  },
  sales: {
    name: "销售话术",
    welcome: "你好，我是思潼 · 销售话术智能体。把客户卡点和异议给我，我出成交话术。",
    slots: [
      { key: "scene", label: "客户 / 卡点", q: "客户大概什么样？现在卡在哪一步？" },
      { key: "obj", label: "异议 / 顾虑", q: "客户说过或最可能的顾虑是什么？" },
      { key: "val", label: "成交点", q: "你要卖什么？最大价值和能给到的保障是什么？" }
    ]
  },
  moments: {
    name: "朋友圈文案",
    welcome: "你好，我是思潼 · 朋友圈文案智能体。把今天真实发生的事给我，我按七柱给你可直发文案。",
    slots: [
      { key: "who", label: "身份 / 人设", q: "你是做什么的？想在朋友圈立什么人设？" },
      { key: "topic", label: "话题 / 素材", q: "今天想发什么？一件工作小事、客户反馈、方法论，还是生活片段？" },
      { key: "aim", label: "目标", q: "这条更想干嘛？立信任、带一点业务，还是约见 / 推进客户？" }
    ]
  },
  "ip-pack": {
    name: "IP 增长套装",
    welcome: "你好，我是思潼 · IP 增长套装。这是 7 大能力的全链路入口，先了解你的现状，再告诉你先打哪一环。",
    slots: [
      { key: "status", label: "现状 / 目标", q: "你是谁、做什么的？IP 做到哪一步？核心目标（获客 / 招商 / 品牌）？" },
      { key: "res", label: "现有资源", q: "现有账号、团队、内容能力、可投入时间各是什么水平？" },
      { key: "gap", label: "最卡的一环", q: "定位 / 选题 / 文案 / 视频直播 / 销售，哪一环现在最卡？" }
    ]
  },
};

export function chatFlowFor(coreSkillId: string): ChatFlow | undefined {
  return CHAT_FLOWS[coreSkillId];
}

export function buildRunPrompt(flow: ChatFlow, answers: Record<string, string>): string {
  const items = flow.slots.map((slot) => `- ${slot.label}：${answers[slot.key] || "（待补充）"}`).join("\n");
  const supplement = (answers.__supplement ?? "").trim();
  const extra = supplement ? `\n- 补充说明：${supplement}` : "";
  return `请按「${flow.name}」方法论，基于下面业务信息生成最终交付。\n${items}${extra}`;
}

/** /market/skus/:sku/run 的请求体；视频复盘会额外带结构化参数。 */
export interface RunRequestBody {
  input: string;
  platform?: string | null;
  period?: { start: string | null; end: string | null } | null;
  has_revenue_data?: boolean;
}

/** 从「2026-08-12 ~ 2026-09-07」「近30天」这类文本里抽出可用的起止日期。 */
function parsePeriod(text: string): { start: string | null; end: string | null } | null {
  const dates = text.match(/\d{4}-\d{1,2}(?:-\d{1,2})?/g) ?? [];
  if (dates.length === 0) return null;
  return { start: dates[0] ?? null, end: dates[1] ?? dates[0] ?? null };
}

/**
 * 视频复盘：平台 / 周期单独作为结构化入参发给后端，避免后端从自由文本里猜；
 * 数据表保持原样、独占成行，后端 parseVidrevRowsFromText 才能按表头解析出每一列。
 * 2026-09-14 工单 2.2：只保留「深度复盘」，不再传 mode。
 */
export function buildVidrevRunBody(flow: ChatFlow, answers: Record<string, string>): RunRequestBody {
  const platform = (answers.platform ?? "").trim();
  const periodText = (answers.period ?? "").trim();
  const data = (answers.data ?? "").trim();
  const supplement = (answers.__supplement ?? "").trim();

  const head = [
    "- 复盘模式：深度复盘（唯一模式）",
    `- 平台：${platform || "抖音"}`,
    `- 统计周期：${periodText || "未提供"}`,
    "- 数据 / 描述："
  ].join("\n");
  const tail = supplement ? `\n- 补充说明：${supplement}` : "";
  const input = `请按「${flow.name}」方法论生成最终交付。\n${head}\n${data || "（待补充）"}${tail}`;

  return {
    input,
    platform: platform || null,
    period: parsePeriod(periodText),
    // 有成交口径字段时后端才允许出 ROI 数值；否则只给留资成本口径。
    has_revenue_data: /成交金额|成交额|营业额|销售额|GMV|收入/i.test(data)
  };
}

/** 统一组装 run 请求体：视频复盘走结构化入参，其余技能维持原有文本需求单。 */
export function buildRunBody(coreSkillId: string, flow: ChatFlow, answers: Record<string, string>): RunRequestBody {
  if (coreSkillId === "vidrev") return buildVidrevRunBody(flow, answers);
  return { input: buildRunPrompt(flow, answers) };
}
