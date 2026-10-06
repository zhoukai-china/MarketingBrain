/* 本地验证：IP 定位工作台「预采集缺口 gaps」+「章节级补全 /ip-pos/complete」
 * 仅本地 dev（:3011 / dev-login），不触碰生产。
 * 跑法：node qa-ip-pos/ippos-patch-check.cjs
 */
const API = "http://127.0.0.1:3011";
const SKU = "ipzone__ip-pos";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function assert(cond, msg) {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) process.exitCode = 1;
  return cond;
}

(async () => {
  // 1) dev-login
  const loginRes = await fetch(API + "/auth/dev-login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ productCode: "lanqi" })
  }).then((r) => r.json()).catch(() => ({}));
  const token = loginRes.token || "";
  if (!token) { console.log("✗ dev-login 失败", JSON.stringify(loginRes).slice(0, 200)); process.exit(1); }
  console.log("✓ dev-login 成功，token 长度", token.length);
  const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  // 2) precheck：填满 6 槽位 → 走 LLM，应返回 issues + gaps（gaps 为可选补充数组）
  const answers = {
    role: "我是美妆品牌主理人，自己下场做 IP 内容。",
    project: "一个主打敏感肌修护的国货精华品牌，刚上线半年。",
    competition: "对标薇诺娜、玉泽，但尚未形成鲜明人设。",
    user: "25-35 岁都市女性，被泛红刺痛困扰，愿意为成分买单。",
    founder: "本人是配方师出身，说话偏理工直给，不玩虚的。",
    stage: "已上线在卖，月 GMV 约 80 万，想用内容把复购拉起来。"
  };
  const pre = await fetch(`${API}/market/skus/${SKU}/precheck`, {
    method: "POST", headers: H, body: JSON.stringify({ answers })
  });
  const preJson = await pre.json().catch(() => ({}));
  console.log(`\n[precheck] status=${pre.status}`);
  const gapsOk = assert(Array.isArray(preJson.gaps), `precheck 返回 gaps 数组（长度 ${Array.isArray(preJson.gaps) ? preJson.gaps.length : "非数组"}）`);
  if (gapsOk && preJson.gaps.length) {
    console.log("   首条 gap：", JSON.stringify(preJson.gaps[0]));
  }
  assert(Array.isArray(preJson.issues), `precheck 返回 issues 数组（长度 ${Array.isArray(preJson.issues) ? preJson.issues.length : "非数组"}）`);

  // 3) /ip-pos/complete：章节级补全（新端点）。构造带【待补】的草稿，看模型能否替换成真实内容。
  const patch = {
    answers,
    patches: [
      {
        sectionKey: "ads",
        title: "六、投流建议",
        draft: "六、投流建议\n\n当前以自然流为主，付费投流尚未系统铺开。\n【待补】需用户确认月投放预算与主要投放渠道。\n待补充：希望内容团队规模与分工也补一下。",
        items: [
          { instruction: "【待补】需用户确认月投放预算与主要投放渠道。", answer: "月投放预算 3 万元，主投抖音信息流 + 小红书搜索。" },
          { instruction: "待补充：希望内容团队规模与分工也补一下。", answer: "2 人内容小组，1 人负责脚本与拍摄，1 人负责剪辑与投放。" }
        ]
      }
    ]
  };
  const t0 = Date.now();
  const comp = await fetch(`${API}/market/skus/${SKU}/ip-pos/complete`, {
    method: "POST", headers: H, body: JSON.stringify(patch)
  });
  const compJson = await comp.json().catch(() => ({}));
  console.log(`\n[complete] status=${comp.status} 用时=${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (comp.status !== 200) {
    console.log("   响应：", JSON.stringify(compJson).slice(0, 400));
    assert(false, "/ip-pos/complete 返回 200");
  } else {
    assert(typeof compJson.sections === "object" && compJson.sections !== null, "complete 返回 sections 对象");
    const ads = compJson.sections && compJson.sections.ads;
    if (ads) {
      assert(ads.includes("六、投流建议"), "补全后保留章标题「六、投流建议」");
      assert(ads.includes("3 万元") && ads.includes("抖音信息流"), "补全把【待补】替换成了用户给的真实预算/渠道");
      assert(ads.includes("脚本与拍摄") && ads.includes("剪辑与投放"), "补全把「待补充：内容团队」也替换成了真实内容（2 人分工）");
      assert(!/【待补】/.test(ads) && !/待补充/.test(ads), "补全后章节内已无【待补】/待补充 标记");
      console.log("   ---- 补全后 ads 章节（前 240 字）----");
      console.log("   " + ads.replace(/\n/g, "\n   ").slice(0, 240));
    } else {
      assert(false, "complete 返回了 sections.ads");
    }
    console.log(`   消耗算力(返回字段 consumedCredits)=${compJson.consumedCredits} 余额=${compJson.balance}`);
  }

  console.log(`\n结论：${process.exitCode ? "HAS FAIL ❌" : "ALL PASS ✅"}（仅本地验证，未上线）`);
})().catch((e) => { console.error("脚本异常：", e); process.exit(1); });
