/**
 * AI 案例数据（照原型 agents-home-tech-demo v3.28 CASE_DATA 全量 12 条逐字提取，含详情字段）。
 * 封面图 public/mall/case0..11.jpg 同样提取自原型。演示数据虚构口径与原型一致。
 */
export type EcoCaseNav =
  | { kind: "agent"; path: string }
  | { kind: "product"; path: string }
  | { kind: "floor"; path: string };

export type EcoCase = {
  cat: string;
  tag: string;
  gain: string;
  gainSub: string;
  title: string;
  sub: string;
  before: string;
  steps: string[];
  cost: string;
  cycle: string;
  metrics: Array<[string, string, string]>;
  inspire: string;
  refName: string;
  cover: string;
  nav: EcoCaseNav;
};

export const ECO_CASE_CATS: Array<{ key: string; label: string }> = [{"key": "all", "label": "全部"}, {"key": "emp", "label": "内容获客"}, {"key": "emp2", "label": "私域营销"}, {"key": "hw", "label": "AI 硬件"}, {"key": "course", "label": "AI 课程"}, {"key": "opc", "label": "OPC"}, {"key": "ind", "label": "行业工作台"}];

export const ECO_CASES: EcoCase[] = [
  {
    "cat": "emp",
    "tag": "法律服务 · IP 定位",
    "gain": "+80%",
    "gainSub": "案源咨询",
    "title": "律师用 AI 定位 IP，3 个月案源咨询 +80%",
    "sub": "律师事务所创始人 · 1 人运营 · 二线城市",
    "before": "账号做了半年 800 粉，今天普法明天追热点，粉丝记不住他是谁，评论区问了也不委托。",
    "steps": [
      "AI 定位全案先定「一句话人设」：只讲劳动仲裁",
      "内容矩阵收成 3 条主线，每条都往「专业靠谱」上堆",
      "选题只选有客户原话支撑的问题，热点一律让位"
    ],
    "cost": "99 算力/份",
    "cycle": "快速出全案",
    "metrics": [
      [
        "月案源咨询",
        "25 通",
        "45 通"
      ],
      [
        "粉丝",
        "800",
        "2.6 万"
      ]
    ],
    "inspire": "个人 IP 不是发得多，是让人记住「你专门解决什么」。",
    "refName": "沈定",
    "cover": "/mall/case0.jpg",
    "nav": {
      "kind": "agent",
      "path": "/agent/ipzone__ip-pos/detail"
    }
  },
  {
    "cat": "emp",
    "tag": "宠物门店 · 团购文案",
    "gain": "+210%",
    "gainSub": "团购核销",
    "title": "宠物店让 AI 写团购文案，核销单 +210%",
    "sub": "单店 · 4 人 · 美团+抖音团购",
    "before": "老板娘下班自己憋文案，一周憋出 2 条，卖点写成了说明书，团购上线没人点。",
    "steps": [
      "把洗护卖点甩给 AI，直接出「能直发」的稿",
      "一条卖点出 3 版钩子，跑数据挑最好的",
      "好钩子沉淀成模板，反复套用"
    ],
    "cost": "15 算力/次 起",
    "cycle": "3 分钟一条",
    "metrics": [
      [
        "月内容产能",
        "8 条",
        "40 条"
      ],
      [
        "月核销",
        "92 单",
        "285 单"
      ]
    ],
    "inspire": "文案不用憋——把卖点给 AI，让它用顾客的话写出来，你只挑钩子。",
    "refName": "秦文",
    "cover": "/mall/case1.jpg",
    "nav": {
      "kind": "agent",
      "path": "/agent/ipzone__copy/detail"
    }
  },
  {
    "cat": "emp",
    "tag": "知识付费 · 视频复盘",
    "gain": "23%",
    "gainSub": "爆款率",
    "title": "知识博主 AI 复盘 30 条视频，爆款率 8% → 23%",
    "sub": "个人博主 · 5.7 万粉 · B站+抖音",
    "before": "视频火不火全看命，播完就播完了，不知道哪条为什么火、哪条为什么扑。",
    "steps": [
      "每条视频的后台数据丢给 AI 复盘",
      "归因到完播 / 互动 / 转化具体环节",
      "下一条只改复盘指出的 1 个最大问题"
    ],
    "cost": "50 算力/次",
    "cycle": "5 分钟一条",
    "metrics": [
      [
        "爆款率（>5万播放）",
        "8%",
        "23%"
      ],
      [
        "月均播放",
        "1.8 万",
        "6.4 万"
      ]
    ],
    "inspire": "别整条重做——每条只改复盘指出的一个问题，30 条后爆款率翻 3 倍。",
    "refName": "江流",
    "cover": "/mall/case2.jpg",
    "nav": {
      "kind": "agent",
      "path": "/agent/ipzone__vidrev/detail"
    }
  },
  {
    "cat": "emp",
    "tag": "服装门店 · 直播",
    "gain": "+34%",
    "gainSub": "场均 GMV",
    "title": "服装店用 AI 逐字稿开播，场均 GMV +34%",
    "sub": "单店 · 6 人 · 抖音直播每周 3 场",
    "before": "主播全靠临场发挥，复盘全凭印象；新人上播冷场，老主播一走，话术也跟着走了。",
    "steps": [
      "开播前 AI 出整场逐字稿，按分钟排节奏",
      "留人 / 逼单关键节点照稿执行",
      "场后按稿对齐执行偏差，下场只改一处"
    ],
    "cost": "50 算力/场",
    "cycle": "开播前 20 分钟出稿",
    "metrics": [
      [
        "场均 GMV",
        "¥8,200",
        "¥11,000"
      ],
      [
        "场观停留",
        "42 秒",
        "78 秒"
      ]
    ],
    "inspire": "直播别再「跟着感觉播」——逐字稿把节奏钉死，新人也能照稿接客。",
    "refName": "罗盘",
    "cover": "/mall/case3.jpg",
    "nav": {
      "kind": "agent",
      "path": "/agent/ipzone__livescript/detail"
    }
  },
  {
    "cat": "hw",
    "tag": "连锁门店 · 巡店管理",
    "gain": "100%",
    "gainSub": "督查覆盖",
    "title": "连锁门店 AI 录音卡巡店，督查覆盖 30% → 100%",
    "sub": "22 家连锁 · 督导 3 人 · 跨 4 城",
    "before": "3 个督导跑 22 家店，一家店两个月才轮到一次，总部拿到的都是「汇报」，不是现场。",
    "steps": [
      "录音卡进店，客户沟通自动归档",
      "话术要点自动提炼，总部远程抽查",
      "问题门店按录音回放做整改"
    ],
    "cost": "¥199/台（上架价）",
    "cycle": "7 天铺完",
    "metrics": [
      [
        "月督查覆盖",
        "30%",
        "100%"
      ],
      [
        "督导差旅",
        "¥1.8 万/月",
        "¥0.4 万/月"
      ]
    ],
    "inspire": "管连锁先管「现场」——录音卡把每家店的现场搬回总部，省下的差旅就够回本。",
    "refName": "AI 录音卡",
    "cover": "/mall/case4.jpg",
    "nav": {
      "kind": "product",
      "path": "/product/hwRec/detail"
    }
  },
  {
    "cat": "course",
    "tag": "企业财务 · 效率工具",
    "gain": "×3",
    "gainSub": "审核人效",
    "title": "财务学了智能体课，自建报销审核智能体，人效 ×3",
    "sub": "120 人公司 · 财务 4 人 · 报销单 600 张/月",
    "before": "4 个财务一半时间耗在核对发票和标准上，月底加班成常态，员工报销平均等 5 天。",
    "steps": [
      "按课程流程搭「报销审核」智能体",
      "发票识别 + 标准校验自动跑",
      "人工只处理异常单"
    ],
    "cost": "¥199/门 · 人民币直购",
    "cycle": "2 周上线",
    "metrics": [
      [
        "单张审核耗时",
        "8 分钟",
        "2.5 分钟"
      ],
      [
        "报销周期",
        "5 天",
        "1.5 天"
      ]
    ],
    "inspire": "最懂流程的是你自己——学会搭智能体，每个重复劳动都能变你的 AI 员工。",
    "refName": "智能体开发课",
    "cover": "/mall/case5.jpg",
    "nav": {
      "kind": "product",
      "path": "/product/courseAgent/detail"
    }
  },
  {
    "cat": "ind",
    "tag": "美业门店 · 经营大脑",
    "gain": "34%",
    "gainSub": "到店转化",
    "title": "美容院上线 AI 经营大脑，到店转化 21% → 34%",
    "sub": "单店 · 6 人 · 月营收 31 万 · 二线城市",
    "before": "顾客档案记在本子上，换人接待就断片；顾客每次来都要重讲一遍情况，体验差、续卡难。",
    "steps": [
      "客户记忆底座建档，偏好禁忌全留痕",
      "AI 按「七柱内容」排朋友圈",
      "每次接待前 AI 出预判方案"
    ],
    "cost": "行业工作台 · 按年",
    "cycle": "5 天建库",
    "metrics": [
      [
        "到店转化率",
        "21%",
        "34%"
      ],
      [
        "客单价",
        "¥680",
        "¥920"
      ]
    ],
    "inspire": "门店的资产不是流量，是「记得住每个顾客」——记忆底座一建，转化和客单一起涨。",
    "refName": "美业门店AI经营大脑",
    "cover": "/mall/case6.jpg",
    "nav": {
      "kind": "floor",
      "path": "#floor-industry"
    }
  },
  {
    "cat": "opc",
    "tag": "MCN · 内容量产",
    "gain": "-91%",
    "gainSub": "单集成本",
    "title": "MCN 用折扣 API 批量产漫剧脚本，单集成本 2,000 → 180",
    "sub": "12 人 MCN · 漫剧账号 8 个 · 日更压力",
    "before": "脚本外包 2,000/集，一天要 6 集，成本压不住；爆款还得靠量堆，量又上不去。",
    "steps": [
      "模型 API 额度走折扣仓直充",
      "批量生成分镜脚本初稿",
      "人工只做终审和人设校准"
    ],
    "cost": "50 算力/份 起",
    "cycle": "当天跑通",
    "metrics": [
      [
        "单集成本",
        "¥2,000",
        "¥180"
      ],
      [
        "日产能",
        "6 集",
        "40 集"
      ]
    ],
    "inspire": "用量大的活儿先算 token 成本——同样的模型走仓价，省下来的都是利润。",
    "refName": "大模型折扣仓",
    "cover": "/mall/case7.jpg",
    "nav": {
      "kind": "product",
      "path": "#floor-opc"
    }
  },
  {
    "cat": "emp2",
    "tag": "烘焙门店 · 私域复购",
    "gain": "63 人",
    "gainSub": "老客月回流",
    "title": "烘焙店 AI 排朋友圈内容，老客月回流 21 → 63 人",
    "sub": "单店 · 5 人 · 企微好友 1,800 人",
    "before": "朋友圈全是「今日出炉」和价格，发一条掉一批粉；老客做完就不见，全靠店长手工记谁该回来了。",
    "steps": [
      "AI 按信任 / 价值 / 软引导排内容日历",
      "每天一条「能直接粘贴」的朋友圈",
      "到点提醒该唤醒哪些沉睡客"
    ],
    "cost": "5 算力/条",
    "cycle": "当天可发",
    "metrics": [
      [
        "老客月回流",
        "21 人",
        "63 人"
      ],
      [
        "朋友圈互动",
        "3%",
        "11%"
      ]
    ],
    "inspire": "朋友圈别只发广告——信任、价值、软引导按节奏排，老客自己会回来。",
    "refName": "周域",
    "cover": "/mall/case8.jpg",
    "nav": {
      "kind": "agent",
      "path": "/agent/ipzone__moments/detail"
    }
  },
  {
    "cat": "emp2",
    "tag": "健身房 · 成交训练",
    "gain": "26 天",
    "gainSub": "新人首单",
    "title": "健身房用 AI 模拟成交训练，新人首单周期 45 → 26 天",
    "sub": "3 家连锁 · 会籍顾问 11 人 · 高客单",
    "before": "新顾问话术背得熟，坐到顾客面前就卡壳；老人带教没标准，新人 2 个月开不了单就走人。",
    "steps": [
      "AI 扮演难缠顾客做模拟对练",
      "卡单场景话术逐条过",
      "每周按录音回放定位卡点"
    ],
    "cost": "25 算力/次",
    "cycle": "30 天跑通",
    "metrics": [
      [
        "新人首单周期",
        "45 天",
        "26 天"
      ],
      [
        "新人 6 月留存",
        "40%",
        "72%"
      ]
    ],
    "inspire": "成交能力是练出来的——让 AI 扮演难缠顾客，上岗前先过 100 轮对练。",
    "refName": "易成",
    "cover": "/mall/case9.jpg",
    "nav": {
      "kind": "agent",
      "path": "/agent/ipzone__sales/detail"
    }
  },
  {
    "cat": "hw",
    "tag": "连锁前台 · 智能接待",
    "gain": "-40%",
    "gainSub": "前台人力",
    "title": "连锁茶饮前台换 AI 机器人，接待响应 0 延迟",
    "sub": "8 家门店 · 高峰排队严重 · 一线城市",
    "before": "高峰期前台 2 个人都接不过来，常见问题反复答，会员活动讲了八百遍，忙起来还答错。",
    "steps": [
      "常见话术与活动知识灌入机器人",
      "迎宾 + 导购问答全接住",
      "复杂问题一键转人工"
    ],
    "cost": "¥1,999/台（上架价）",
    "cycle": "3 天部署",
    "metrics": [
      [
        "前台人力",
        "2 人/店",
        "1 人/店"
      ],
      [
        "咨询响应",
        "30 秒",
        "即时"
      ]
    ],
    "inspire": "重复答了一年的问题就该交给机器人——前台腾出来的人去干转化。",
    "refName": "门店 AI 机器人",
    "cover": "/mall/case10.jpg",
    "nav": {
      "kind": "product",
      "path": "/product/hwRobot/detail"
    }
  },
  {
    "cat": "emp",
    "tag": "美业门店 · 短视频起号",
    "gain": "1.2 万粉",
    "gainSub": "45 天起号",
    "title": "美业小店靠「AI 每天出选题」，45 天 0 → 1.2 万粉",
    "sub": "单店 · 3 人 · 抖音同城",
    "before": "凭感觉拍了 38 条，最高 2,000 播放；不知道客户到底想看什么，越拍越没信心。",
    "steps": [
      "私有知识库同步 30 天客户问题",
      "每天 AI 出 5 条带理由的选题",
      "三关筛选：有证据 / 有流量 / 合阶段"
    ],
    "cost": "99 算力/次",
    "cycle": "当天出选题",
    "metrics": [
      [
        "月均播放",
        "1.2 万",
        "38 万"
      ],
      [
        "爆款率（>5万）",
        "0%",
        "17%"
      ]
    ],
    "inspire": "别再凭感觉拍——把「客户真在问什么」变成选题清单，起号快一倍。",
    "refName": "何策",
    "cover": "/mall/case11.jpg",
    "nav": {
      "kind": "agent",
      "path": "/agent/ipzone__topic/detail"
    }
  }
];
