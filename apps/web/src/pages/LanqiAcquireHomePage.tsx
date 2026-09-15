// 兰琪美业门店 AI 经营大脑 · 公域获客（板块3）枢纽页
// 严格对齐 demo `acquire.html`：5 个子入口卡片（标签 新增/已开放 + 名称 + 说明 + 进入文案）。

import { getAppPath } from "../lib/api.js";
import { LanqiBrainShell } from "../components/lanqi-brain/LanqiBrainShell.js";

interface AcquireEntry {
  key: string;
  tag: "新增" | "已开放";
  /** 新增 = 橙色实底标签，与 demo 一致 */
  accent: boolean;
  name: string;
  desc: string;
  enter: string;
  href: string;
}

const ENTRIES: AcquireEntry[] = [
  {
    key: "copy-kit",
    tag: "新增",
    accent: true,
    name: "美业文案十件套",
    desc: "说清主推项目和想吸引的人，一次拿整套可直接发布的内容：选题 → 口播稿 → 访谈问答 → 拍摄脚本 → 剪辑 EDL → 标题话题 → 发布时间 → 评论引导 → 投流建议。",
    enter: "生成十件套 →",
    href: getAppPath("/lanqi/acquire/copy-kit")
  },
  {
    key: "copywriter",
    tag: "新增",
    accent: true,
    name: "短视频文案改稿",
    desc: "把已有口播稿改得更抓人、更顺口：诊断 → 选开头 → 编辑成稿 → 标题与封面建议，含拍摄剪辑参考。",
    enter: "开始改稿 →",
    href: getAppPath("/lanqi/acquire/copywriter")
  },
  {
    key: "video",
    tag: "新增",
    accent: true,
    name: "爆款复刻",
    desc: "粘贴你刷到的抖音链接，或直接上传你自己的原片 → 换成你的脸 / 人，保留原片画面与节奏出成片。",
    enter: "去复刻 →",
    href: getAppPath("/lanqi/acquire/video")
  },
  {
    key: "script",
    tag: "新增",
    accent: true,
    name: "一键成片",
    desc: "不用自己写文案：一句话说需求 → AI 写 3 版文案 → 自动出分镜脚本 → 传人物卡 / 场景卡 / 道具卡 → 确认积分预算 → 出成片。",
    enter: "进入一键成片 →",
    href: getAppPath("/lanqi/acquire/video-copy")
  },
  {
    key: "live",
    tag: "已开放",
    accent: false,
    name: "直播话术",
    desc: "主播单人 2 小时带货直播逐字稿，含节奏提示，无运营配合，一个人一部手机就能播。",
    enter: "进入直播话术 →",
    href: getAppPath("/lanqi/acquire/live")
  },
  {
    key: "advisor",
    tag: "新增",
    accent: true,
    name: "AI 运营顾问",
    desc: "抖音 / 视频号 / 美团上的运营问题直接问：说清门店情况，给排好优先级的第一周动作清单。",
    enter: "问运营问题 →",
    href: getAppPath("/lanqi/acquire/methods")
  }
];

export function LanqiAcquireHomePage() {
  // demo acquire.html：主标题=品牌名，副标题=公域获客
  return (
    <LanqiBrainShell active="acquire" subtitle="公域获客" crumb="/ 公域获客">
      <div className="lq-aq">
        <div className="lq-aq__intro">
          <h2>公域获客</h2>
        </div>
        <div className="lq-aq__grid">
          {ENTRIES.map((entry) => (
            <a key={entry.key} className="lq-aq__card" href={entry.href}>
              <span className={`lq-aq__tag${entry.accent ? " on" : ""}`}>{entry.tag}</span>
              <h3>{entry.name}</h3>
              <p>{entry.desc}</p>
              <span className="lq-aq__enter">{entry.enter}</span>
            </a>
          ))}
        </div>
      </div>
    </LanqiBrainShell>
  );
}
