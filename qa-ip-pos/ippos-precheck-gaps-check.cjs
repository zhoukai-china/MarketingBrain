/* 本地验证：precheck 的「体检 issues + 运营缺口 gaps」在**长回答 + 多次调用**下是否稳定返回。
 * 背景（2026-10-02 用户实测「没看到 3-5 补问」）：precheck 的 JSON 现在同时出 issues + gaps，
 * 若被 maxTokens 截断 → JSON.parse 失败 → degraded → 前端拿不到 gaps。此脚本连跑 3 次看稳定性。
 * 2026-10-03（用户「这两个合并成一个，都按第二个填空的方式」）新增契约：
 *   issues[]（体检补强）每条也要带**填空句** sentence，否则前端合并面板里它就退回自由输入框。
 * 仅本地 dev（:3011 / dev-login）。跑法：
 *   node qa-ip-pos/ippos-precheck-gaps-check.cjs
 */
const API = "http://127.0.0.1:3011";
const SKU = "ipzone__ip-pos";
const ROUNDS = 3;

// 刻意写长（贴近真实用户：每项 60-140 字）——issues 命中越多、输出越长，越容易撞截断。
const ANSWERS = {
  role: "我是这家店的老板本人，之前一直在后厨和前厅盯运营，现在决定自己下场做 IP 出镜。业务形态是本地三家直营门店，暂时没做加盟，团队一共 21 个人。",
  project: "做的是广式现制烧腊，主打「每日现烤、晚市打折」，靠堂食 + 周边写字楼的外卖两头发力。目前处在 1 到 10 这个阶段，三家店的模型已经跑通，想验证第四家能不能复制。",
  competition: "三公里内有两家做了十几年的老牌烧腊店，还有一家连锁快餐抢写字楼客群。我们的差异是当天现烤不隔夜，每天晚市七点后七折清货，这个折扣是我们真实的做法，小程序上能看到销量记录。",
  user: "典型客户是周边 1.5 公里内的写字楼白领，25 到 40 岁，午饭预算 25 到 40 元，最痛的一件事是「排队久、怕不干净」；另一类是晚上不想做饭的家庭客群，客单价 60 到 90 元。",
  founder: "我本人是厨师出身，做了 12 年烧腊，性格直、不太会说漂亮话，但对火候和选料要求特别高，属于手上功夫强、镜头前会紧张那种。做 IP 的核心目标就是给门店拉新客，同时替第四家店开张提前养一批周边的熟客。",
  stage: "现在账号粉丝量大概 4300，主要发在抖音，偶尔同步小红书。出镜镜头感我自己打 6 分，能自然说话但不太会接梗，一周大概能挤出 6 到 8 小时拍内容，剪辑是店里小伙子帮忙。"
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const loginRes = await fetch(API + "/auth/dev-login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ productCode: "lanqi" })
  }).then((r) => r.json()).catch(() => ({}));
  const token = loginRes.token || "";
  if (!token) { console.log("✗ dev-login 失败", JSON.stringify(loginRes).slice(0, 200)); process.exit(1); }
  const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  console.log("✓ dev-login 成功\n");

  let pass = 0;
  const rows = [];
  for (let i = 1; i <= ROUNDS; i++) {
    const t0 = Date.now();
    const res = await fetch(`${API}/market/skus/${SKU}/precheck`, {
      method: "POST", headers: H, body: JSON.stringify({ answers: ANSWERS })
    });
    const json = await res.json().catch(() => ({}));
    const gaps = Array.isArray(json.gaps) ? json.gaps : [];
    const issues = Array.isArray(json.issues) ? json.issues : [];
    const text = (g) => String(g?.sentence || g?.question || "");
    const clean = gaps.every((g) => g && g.area && text(g) && !/[|｜]|不要编造|^[^【]*\?$/.test(text(g)));
    // 2026-10-02 新契约：每条应是**填空句**（含至少一个【空】）。
    const blanks = gaps.filter((g) => /【[^】]{1,24}】/.test(text(g))).length;
    const allFill = gaps.length > 0 && blanks === gaps.length;
    // 2026-10-03 新契约：体检 issues（若有）每条也要带填空句，且 slot 必须合法。
    const issFill = issues.filter((it) => it && it.slot && /【[^】]{1,24}】/.test(String(it.sentence || ""))).length;
    const issOk = issues.length === 0 || issFill === issues.length;
    const good = gaps.length >= 3 && !json.degraded && clean && allFill && issOk;
    if (good) pass += 1;
    rows.push({ 轮次: i, 耗时ms: Date.now() - t0, degraded: String(!!json.degraded), issues: issues.length, "issues填空": `${issFill}/${issues.length}`, gaps: gaps.length, 填空句: `${blanks}/${gaps.length}`, 结论: good ? "PASS" : "FAIL" });
    console.log(`[第 ${i} 轮] degraded=${!!json.degraded} issues=${issues.length}（填空句 ${issFill}/${issues.length}） gaps=${gaps.length} 填空句=${blanks}/${gaps.length} 耗时=${Date.now() - t0}ms`);
    for (const g of gaps) console.log(`   · ${g.area}：${text(g)}`);
    if (issues.length) console.log(`   issues 示例：${JSON.stringify(issues[0])}`);
    await wait(800);
  }
  console.log("\n=== 汇总 ===");
  console.table(rows);
  console.log(`\n${pass === ROUNDS ? "ALL PASS" : `FAILED ${ROUNDS - pass}/${ROUNDS}`}：${ROUNDS} 轮里 ${pass} 轮返回 ≥3 条 gaps 且未 degraded`);
  process.exit(pass === ROUNDS ? 0 : 1);
})();
