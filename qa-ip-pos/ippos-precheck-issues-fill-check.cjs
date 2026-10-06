/* 本地验证（真实 LLM）：precheck 的**体检 issues 也产出填空句**（2026-10-03 用户
 * 「这两个合并成一个，都按第二个填空的方式」的新契约）。
 * 做法：故意给一份「薄回答」（多个槽位一句话敷衍），逼模型判 weak/missing，然后断言：
 *   issues.length ≥ 1、每条都有合法 slot、每条 sentence 都含【空】（前端才能渲染成填空题）、
 *   并且 sentence 里不许出现「发一条/我看看」这类表演式要求（prompt 硬性边界 + 服务端兜底）。
 * 仅本地 dev（:3011 / dev-login）。跑法：
 *   node qa-ip-pos/ippos-precheck-issues-fill-check.cjs
 */
const API = "http://127.0.0.1:3011";
const SKU = "ipzone__ip-pos";

// 刻意写薄：competition / user / stage 都是一句话敷衍，founder 甚至带「不知道」。
const THIN = {
  role: "老板",
  project: "做餐饮的，开了三家店，还在摸索阶段，具体怎么赚钱还在想。",
  competition: "有几家竞品吧。",
  user: "就是附近的人。",
  founder: "不知道怎么说，反正我想做 IP。",
  stage: "抖音号粉丝不多，平时挺忙的。"
};

const fails = [];
const check = (cond, msg) => { console.log(`${cond ? "✓" : "✗"} ${msg}`); if (!cond) fails.push(msg); };

(async () => {
  const loginRes = await fetch(API + "/auth/dev-login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ productCode: "lanqi" })
  }).then((r) => r.json()).catch(() => ({}));
  const token = loginRes.token || "";
  if (!token) { console.log("✗ dev-login 失败"); process.exit(1); }
  console.log("✓ dev-login 成功\n");

  const res = await fetch(`${API}/market/skus/${SKU}/precheck`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ answers: THIN })
  });
  const json = await res.json().catch(() => ({}));
  const issues = Array.isArray(json.issues) ? json.issues : [];
  const SLOTS = ["role", "project", "competition", "user", "founder", "stage"];
  console.log("degraded =", !!json.degraded, " issues =", issues.length);
  for (const it of issues) console.log(`   · [${it.slot}/${it.verdict}] ${it.sentence || "(无填空句)"}  ← ${it.followup}`);

  check(!json.degraded, "薄回答下 precheck 未 degraded（JSON 可解析）");
  check(issues.length >= 1, `薄回答至少判出 1 条体检 issue（实测 ${issues.length}）`);
  check(issues.every((it) => SLOTS.includes(it.slot)), "每条 issue 的 slot 都在白名单内（不会串格）");
  check(issues.every((it) => /【[^】]{1,24}】/.test(String(it.sentence || ""))), "每条 issue 都带填空句【】（前端合并面板才渲染得出来）");
  check(issues.every((it) => String(it.followup || "").trim().length > 0), "每条 issue 仍保留 followup 兜底文案");
  check(!issues.some((it) => /我看看|发一条|拍一条|说一段|来一段|背一下|念一下|发给我|录一段|截图|发个视频/.test(`${it.sentence || ""}${it.followup || ""}`)), "填空句/追问里没有「发一条看看」这类表演式要求");

  console.log(fails.length === 0 ? "\nALL PASS ✅（仅本地验证，未部署）" : `\nFAILED ${fails.length} ❌`);
  process.exit(fails.length === 0 ? 0 : 1);
})();
