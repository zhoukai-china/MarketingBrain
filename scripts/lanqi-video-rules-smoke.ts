// 公域获客 · 视频获客/文案转片 分镜规则层冒烟（确定性，不调用真实 Provider）
// 契约来源：demo `video.html`（活规范）
import {
  VIDEO_CAST_ANGLES,
  VIDEO_MAX_IMG,
  VIDEO_MAX_SEC,
  VIDEO_MIN_SEC,
  VIDEO_NEGATIVE_PROMPT,
  VIDEO_SCRIPT_SERVICE_VERSION,
  VIDEO_SPLIT_MODES,
  VIDEO_STYLES,
  VIDEO_TIERS,
  buildShotPrompt,
  buildStoryboard,
  describeShot,
  kindOf,
  shotSeconds,
  splitScript,
  validateVideoScriptInput
} from "../apps/api/src/products/beauty-industry/video-script-service.js";

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`ok - ${name}`);
  } else {
    fail++;
    console.error(`FAIL - ${name}`);
  }
}

const SCRIPT =
  "很多人问我，开了十六年的美业店，到底靠什么活下来。其实没什么秘诀，就是把每一次护理都做扎实。我们的手法讲究先看肤质再上产品，一次护理四十分钟，全程不推销。店里用的精华套盒，都是我自己先试过三个月的。如果你也在为皮肤状态发愁，欢迎来店里坐坐，我们免费给你做一次肤质检测。";

// ── 常量契约 ──
assert("画质档位只有三档", VIDEO_TIERS.length === 3);
assert("画质档位顺序 = 草稿/标准/高清", VIDEO_TIERS.map((t) => t.k).join(",") === "draft,std,final");
assert("画质档位 = 480p/720p/1080p", VIDEO_TIERS.map((t) => t.res).join(",") === "480p,720p,1080p");
assert("画质档位文案不含价格与积分", VIDEO_TIERS.every((t) => !/[¥￥]|积分|元\s*\/\s*秒/.test(`${t.n}${t.out}${t.d}`)));
assert("单次生成上限 15 秒", VIDEO_MAX_SEC === 15);
assert("单镜下限 4 秒", VIDEO_MIN_SEC === 4);
assert("单次参考图上限 9 张", VIDEO_MAX_IMG === 9);
assert("五档画面风格齐全", VIDEO_STYLES.map((s) => s.k).join(",") === "cinema,comm,warm,guo,tech");
assert("三种切分规则齐全", VIDEO_SPLIT_MODES.map((s) => s.k).join(",") === "auto,s10,s5");
assert("切分单镜字数上限 = 67/45/22", VIDEO_SPLIT_MODES.map((s) => s.cap).join(",") === "67,45,22");
assert("人物卡三视图 = 正/侧/背", VIDEO_CAST_ANGLES.map((a) => a.n).join(",") === "正面,侧面,背面");
assert("正面图是首帧图", VIDEO_CAST_ANGLES[0].role === "首帧图");
assert("负面提示词禁文字水印", VIDEO_NEGATIVE_PROMPT.includes("不要出现任何文字、字幕、水印、LOGO"));
assert("负面提示词禁换脸漂移", VIDEO_NEGATIVE_PROMPT.includes("不要更换人物长相与服装"));

// ── 模型中立铁律（界面、文案、契约里都不能出现厂商/模型名）──
const FORBIDDEN = [
  "Seedance",
  "seedance",
  "豆包",
  "百炼",
  "DeepSeek",
  "deepseek",
  "可灵",
  "通义",
  "wan2.2",
  "minimax",
  "MiniMax",
  "即梦",
  "火山",
  "方舟",
  "Kling",
  "Bailian"
];
const surface = JSON.stringify({
  styles: VIDEO_STYLES,
  tiers: VIDEO_TIERS,
  splits: VIDEO_SPLIT_MODES,
  angles: VIDEO_CAST_ANGLES,
  neg: VIDEO_NEGATIVE_PROMPT,
  board: buildStoryboard({ script: SCRIPT, styleKey: "cinema", castName: "老板本人", sceneNames: ["门店前台"] })
});
for (const word of FORBIDDEN) {
  assert(`文案与契约不含「${word}」`, !surface.includes(word));
}
assert("画质档位只出现三档分辨率词", !/4K|2K|1440p/.test(surface));

// ── 切分规则 ──
const autoParts = splitScript(SCRIPT);
assert("长文案切成多镜", autoParts.length >= 3);
assert("自动档每镜不超过 67 字", autoParts.every((p) => p.length <= 67));
assert("切分保留语义标点", autoParts.some((p) => /[。！？]/.test(p)));
assert("空文案切出 0 镜", splitScript("").length === 0);
assert("无句末标点也成镜", splitScript("欢迎来店里坐坐").length === 1);

const s5Parts = splitScript(SCRIPT, "s5");
const s10Parts = splitScript(SCRIPT, "s10");
// 切分只在句末标点处合并，绝不把一句话拦腰切断 —— 单句本身超长时允许超出上限（与 demo 一致）。
// 切分只在句末标点处合并，绝不把一句话拦腰切断 —— 单句本身超长时允许超出字数上限（与 demo 一致）。
// 判据：除最后一镜外，每镜都以句末标点收尾（说明它是整句拼接出来的）。
const wholeSentences = (parts: string[]) => parts.slice(0, -1).every((p) => /[。！？；]$/.test(p));
assert("自动档只在句末切", wholeSentences(autoParts));
assert("10 秒档只在句末切", wholeSentences(s10Parts));
assert("5 秒档只在句末切", wholeSentences(s5Parts));
assert("自动档超 67 字的镜数为 0", autoParts.filter((p) => p.length > 67).length === 0);
assert("越碎的档位镜数越多", s5Parts.length >= s10Parts.length && s10Parts.length >= autoParts.length);
assert("未知切分档回退自动档", splitScript(SCRIPT, "nope").length === autoParts.length);

// ── 单镜时长 ──
assert("单镜时长下限 4 秒", shotSeconds("短") === 4);
assert("单镜时长上限 15 秒", shotSeconds("啊".repeat(400)) === 15);
assert("30 字约为 7 秒", shotSeconds("啊".repeat(30)) === 7);
assert("每镜时长都在 4–15 秒内", autoParts.every((p) => shotSeconds(p) >= 4 && shotSeconds(p) <= 15));

// ── 镜头类型判定（优先级：物件 > 手法 > 体验 > 空间 > 口播兜底）──
assert("产品词判成产品特写", kindOf("我们的精华套盒").tag === "产品特写");
assert("手法词判成手法特写", kindOf("先做一次手法按摩再敷面膜").tag === "手法特写");
assert("体验词判成体验中景", kindOf("顾客做完效果很明显").tag === "体验中景");
assert("空间词判成定场镜头", kindOf("先看看我们店里的环境").tag === "定场镜头");
assert("兜底判成人物讲述", kindOf("其实我想说一件事情").tag === "人物讲述");
assert("产品优先于手法", kindOf("用精华做手法").tag === "产品特写");

// ── 画面描述 ──
const first = describeShot(autoParts[0], 0, autoParts.length);
assert("第一镜带开场提示", first.desc.startsWith("开场先定住注意力，"));
const last = describeShot(autoParts[autoParts.length - 1], autoParts.length - 1, autoParts.length);
assert("最后一镜带收尾提示", last.desc.startsWith("收尾落到行动号召，"));
assert("画面描述不超过 90 字", first.desc.length <= 90);

// ── 生视频提示词 ──
const style = VIDEO_STYLES[0];
const prompt = buildShotPrompt(
  { desc: first.desc, cam: first.kind.cam, move: first.kind.move, text: autoParts[0] },
  { index: 0, total: autoParts.length, style, castName: "老板本人", sceneName: "门店前台", propName: "精华套盒" }
);
assert("提示词带景别", prompt.includes(first.kind.cam));
assert("提示词带人物名", prompt.includes("人物老板本人"));
assert("提示词带场景名", prompt.includes("场景为门店前台"));
assert("提示词带道具名", prompt.includes("精华套盒"));
assert("提示词带风格光影", prompt.includes(style.light));
assert("提示词带风格色调", prompt.includes(style.tone));
assert("提示词带质感词", prompt.includes(style.q));
assert("第一镜提示词带推进开场", prompt.includes("镜头从景深处缓慢向前推进开场"));
const tailPrompt = buildShotPrompt(
  { desc: last.desc, cam: last.kind.cam, move: last.kind.move, text: autoParts[autoParts.length - 1] },
  { index: autoParts.length - 1, total: autoParts.length, style }
);
assert("末镜提示词带拉远收尾", tailPrompt.includes("镜头缓缓向后拉远"));
assert("缺人物/场景/道具也能出提示词", !tailPrompt.includes("undefined") && !tailPrompt.includes("null"));

// ── 组装整份分镜 ──
const board = buildStoryboard({
  script: SCRIPT,
  styleKey: "comm",
  splitMode: "auto",
  castName: "老板本人",
  sceneNames: ["门店前台", "护理间"],
  propNames: ["精华套盒"]
});
assert("服务版本已声明", board.serviceVersion === VIDEO_SCRIPT_SERVICE_VERSION);
assert("分镜号从 1 连续", board.shots.every((shot, index) => shot.no === index + 1));
assert("镜数 = 切分段数", board.shotCount === autoParts.length && board.shots.length === autoParts.length);
assert("总时长 = 各镜之和", board.totalSeconds === board.shots.reduce((sum, shot) => sum + shot.seconds, 0));
assert("总时长均为正整数秒", Number.isInteger(board.totalSeconds) && board.totalSeconds > 0);
assert("每镜都有提示词", board.shots.every((shot) => shot.prompt.length > 40));
assert("每镜都带负面提示词", board.shots.every((shot) => shot.negative === VIDEO_NEGATIVE_PROMPT));
assert("原文去空白字数", board.sourceChars === SCRIPT.replace(/\s/g, "").length);
assert("选定风格回显", board.style.k === "comm");
assert("选定切分档回显", board.splitMode.k === "auto");
assert("单次上限回显", board.maxSeconds === 15 && board.maxImages === 9);
assert("场景按顺序轮转分配", board.shots[0].prompt.includes("门店前台") && board.shots[1].prompt.includes("护理间"));
assert("未知风格回退第一档", buildStoryboard({ script: SCRIPT, styleKey: "nope" }).style.k === "cinema");

// ── 必填校验 ──
assert("空文案报缺口播文案", validateVideoScriptInput({ script: "   " }).join(",") === "口播文案");
assert("有文案则不报缺", validateVideoScriptInput({ script: SCRIPT }).length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
