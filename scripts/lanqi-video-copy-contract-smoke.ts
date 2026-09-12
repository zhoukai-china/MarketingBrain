// 视频获客一期（0912 口径）契约冒烟：一键成片 3 版文案候选 + 两页拆分。
// 不联网、不调模型；只覆盖确定性门禁与页面结构契约。
import {
  VIDEO_COPY_CANDIDATE_COUNT,
  VIDEO_COPY_STYLES,
  collectFactWarnings,
  estimateDuration,
  parseVideoCopyCandidates,
  pickVideoCopyCandidates,
  validateVideoCopyBrief,
  type RawVideoCopyCandidate,
  type VideoCopyStyle
} from "../apps/api/src/products/beauty-industry/video-copy-service.js";

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`ok - ${name}`);
  } else {
    fail++;
    console.error(`FAIL - ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}

function raw(style: VideoCopyStyle, suffix = ""): RawVideoCopyCandidate {
  return {
    style,
    title: `${style} 版${suffix}`,
    hook: `${style} 钩子：脸上的痘别乱挤，越挤越留印。`,
    body: `${style} 主体：先说清我们怎么做皮肤检测，再决定要不要做项目，全程不推卡。`,
    cta: `${style} 结尾：想看的在评论区留言，我先帮你看是哪种情况。`
  };
}

const ALL: RawVideoCopyCandidate[] = VIDEO_COPY_STYLES.map(item => raw(item.k));

// ── ① 需求门禁 ──
assert("空需求被拒", validateVideoCopyBrief({ storeId: "s1", need: "   " }).ok === false);
assert("缺门店被拒", validateVideoCopyBrief({ need: "推广祛痘" }).ok === false);
const tooLong = validateVideoCopyBrief({ storeId: "s1", need: "皮".repeat(121) });
assert("需求超 120 字被拒", tooLong.ok === false && tooLong.message.includes("太长"));
const banned = validateVideoCopyBrief({ storeId: "s1", need: "加微信私聊领优惠" });
assert("需求含违规引导词被拒", banned.ok === false && banned.message.includes("违规引导词"));
const okBrief = validateVideoCopyBrief({ storeId: "s1", need: "  推广祛痘体验课  ", style: "story", dur: 45, sell: "先做肤质检测", plat: "dy", round: 2 });
assert("合法需求通过并归一化", okBrief.ok === true && okBrief.brief.need === "推广祛痘体验课");
assert(
  "默认值：风格 hook / 30 秒 / 全平台 / 第 0 批",
  (() => {
    const d = validateVideoCopyBrief({ storeId: "s1", need: "推广祛痘" });
    return d.ok && d.brief.style === "hook" && d.brief.dur === 30 && d.brief.plat === "all" && d.brief.round === 0;
  })()
);
assert("非法枚举值回落默认（不报错也不放大）", (() => {
  const d = validateVideoCopyBrief({ storeId: "s1", need: "推广祛痘", style: "hack", dur: 999, plat: "tk", round: -5 });
  return d.ok && d.brief.style === "hook" && d.brief.dur === 30 && d.brief.plat === "all" && d.brief.round === 0;
})());

// ── ② 固定 3 版：选的风格排第 1 + 换一批只轮换后两版 ──
const picked = pickVideoCopyCandidates(ALL, { style: "dry", round: 0 });
assert("固定返回 3 版", picked.length === VIDEO_COPY_CANDIDATE_COUNT, `got ${picked.length}`);
assert("第 1 版 = 用户选的风格", picked[0].style === "dry" && picked[0].chosen === true);
assert("其余两版不是同一风格", new Set(picked.map(item => item.style)).size === 3);
const round1 = pickVideoCopyCandidates(ALL, { style: "dry", round: 1 });
const round2 = pickVideoCopyCandidates(ALL, { style: "dry", round: 2 });
assert("换一批保留第 1 版不变", round1[0].style === "dry" && round2[0].style === "dry");
assert("换一批确实轮换了后面的版本", round1[1].style !== round2[1].style);
assert("字数与预估时长由后端算", picked.every(item => item.chars > 0 && item.durEst >= 15));
assert("时长估算 = max(15, 字/4.5)", estimateDuration(45) === 15 && estimateDuration(450) === 100);
let missingStyle = "";
try {
  pickVideoCopyCandidates([raw("hook")], { style: "hook", round: 0 });
} catch (error) {
  missingStyle = (error as Error).message;
}
assert("模型少给风格 → llm_output_invalid_structure", missingStyle === "llm_output_invalid_structure", missingStyle);

// ── ③ 解析模型输出 ──
const goodJson = JSON.stringify({ candidates: ALL });
const parsed = parseVideoCopyCandidates(`\`\`\`json\n${goodJson}\n\`\`\``, { style: "promo", round: 0 });
assert("能解析带代码块围栏的 JSON", parsed.length === 3 && parsed[0].style === "promo");
assert("每版都有完整 hook/body/cta", parsed.every(item => item.hook && item.body && item.cta && item.fullText));
for (const [name, text] of [
  ["非 JSON", "抱歉我不能"],
  ["缺风格", JSON.stringify({ candidates: [raw("hook")] })],
  ["正文太短", JSON.stringify({ candidates: ALL.map((item, index) => (index === 0 ? { ...item, hook: "短", body: "短", cta: "短" } : item)) })],
  ["含违规引导词", JSON.stringify({ candidates: ALL.map((item, index) => (index === 0 ? { ...item, cta: "想做的加微信我发你链接" } : item)) })]
] as const) {
  let message = "";
  try {
    parseVideoCopyCandidates(text, { style: "hook", round: 0 });
  } catch (error) {
    message = (error as Error).message;
  }
  assert(`${name} → 失败关闭`, message === "llm_output_invalid_structure" || message.includes("违规引导词"), message);
}

// ── ④ 事实门禁：需求里没有的数字要提示核对 ──
const withNumber = pickVideoCopyCandidates(
  ALL.map((item, index) => (index === 0 ? { ...item, body: `${item.body}我们开了16年，做了3000例。` } : item)),
  { style: "hook", round: 0 }
);
const warns = collectFactWarnings(withNumber, { need: "推广祛痘体验课", sell: "" });
assert("需求里没有的数字 → 提示核对", warns.length === 1 && warns[0].includes("16"), JSON.stringify(warns));
const noWarn = collectFactWarnings(pickVideoCopyCandidates(ALL, { style: "hook", round: 0 }), { need: "推广祛痘体验课", sell: "" });
assert("没有数字就不提示", noWarn.length === 0, JSON.stringify(noWarn));

// ── ⑤ 页面与路由契约（0912 一期：两页、无手动贴文案、无门店素材成片/AI 剪辑入口）──
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8");
}

const pageSource = read("apps/web/src/pages/LanqiAcquireVideoPage.tsx");
const mainSource = read("apps/web/src/main.tsx");
const homeSource = read("apps/web/src/pages/LanqiAcquireHomePage.tsx");
const routeSource = read("apps/api/src/routes/acquire.ts");

assert("一键成片有独立路由", mainSource.includes("/lanqi/acquire/video-copy") && mainSource.includes("LanqiAcquireVideoCopyPage"));
assert(
  "视频页不再渲染页签（爆款复刻单模式）",
  !/lq-vd__tabs/.test(pageSource) && !/role="tablist"/.test(pageSource) && !/setMode\(/.test(pageSource)
);
assert("爆款复刻页不挂门店素材成片 / AI 剪辑（代码保留但未渲染）", !/<AssetsMode|<ClipMode/.test(pageSource));
assert("一键成片无「手动贴文案」入口", !/📋 填入示例文案/.test(pageSource) && !/把你写好的口播稿原样贴进来/.test(pageSource));
assert("一键成片 6 步齐全", ["说需求", "AI 生成文案", "AI 分镜脚本", "传素材卡", "积分预算", "成片"].every(label => pageSource.includes(label)));
assert("文案候选走后端接口（前端不拼模板）", pageSource.includes("/lanqi/acquire/video/copy-candidates") && routeSource.includes("/acquire/video/copy-candidates"));
assert("枢纽页两张视频卡指向两个路由", homeSource.includes("/lanqi/acquire/video-copy") && homeSource.includes("一键成片") && homeSource.includes("爆款复刻"));
assert("旧深链 ?mode=script 跳转到一键成片", /===\s*"script"/.test(mainSource) && mainSource.includes("video-copy"));
assert("页面文案不出现厂商与模型名", !/(百炼|通义|qwen|Qwen|DashScope|Seedance|豆包|可灵|MiniMax|海螺|Hailuo|即梦)/.test(pageSource));

console.log(`\nlanqi video copy contract smoke: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
