/**
 * IP+AI 说明书落地页 · 本地演示增强（2026-10-18）
 *
 * 1) 「立即开通」侧挂动图按钮：fixed 挂屏幕右侧中部，滚动常驻
 *    （动图 = 渐变呼吸 + 高光扫过 + 光圈脉冲，纯 CSS 动画）。
 * 2) 表单内「演示模式 · 一键自动填写并提交」：演示场景一键填单。
 * 3) 提交后模拟总部开通后台：受理 → 资料校验/资质审核/版本配置 → 审核通过
 *    → 开通账号权限（终端动画）→ 开通成功，出示体验账号，
 *    一键进入「业绩倍增系统」增长台工作台 UI（按版本分流 ipai-wb-local / ipai-wb-franchise）。
 *
 * 仅在含 #leadModal 的说明书页生效（版本选择页 index.html 自动跳过）。
 * 正式环境移除本脚本并还原 lead-form.js 的 fetch 提交即可。
 */
(function () {
  var modal = document.getElementById("leadModal");
  var form = document.getElementById("leadForm");
  if (!modal || !form) return; // index.html 无预约弹窗，跳过

  // 业绩倍增系统增长台工作台 UI（v4.41b：按表单选用版本分流，用户确认 ipai-wb 系列才是对的 UI；
  // ../ 前缀=说明书页在 ipai-brochure/ 子目录，增长台页在 prototypes 根）
  function workbenchUrl(version) {
    return version === "招商加盟版" ? "../ipai-wb-franchise.html?v=1" : "../ipai-wb-local.html?v=1";
  }
  var INV_KEY = "sitong_bro_inv_v1";
  var INV_TTL = 30 * 24 * 3600 * 1000;

  /* ================= 样式注入 ================= */
  var css = [
    "/* ===== demo-flow.js：侧挂 CTA + 审核开通模拟 ===== */",
    "#broFloatCta{position:fixed;right:10px;top:50%;transform:translateY(-50%);z-index:950;",
    " display:flex;flex-direction:column;align-items:center;gap:7px;padding:16px 9px 14px;",
    " border-radius:999px;border:2px solid rgba(255,255,255,.6);color:#fff;cursor:pointer;",
    " background:linear-gradient(165deg,#f9b04d,#E8651A 48%,#cf4a10);background-size:100% 220%;",
    " box-shadow:0 12px 30px rgba(232,101,26,.5),0 4px 10px rgba(0,0,0,.18);overflow:hidden;",
    " font-family:inherit;-webkit-tap-highlight-color:transparent;",
    " animation:broGrad 3.2s ease-in-out infinite,broPulse 2.2s ease-in-out infinite}",
    "#broFloatCta .ico{font-size:17px;line-height:1}",
    "#broFloatCta .txt{writing-mode:vertical-rl;font-size:14px;font-weight:800;letter-spacing:5px}",
    "#broFloatCta::after{content:'';position:absolute;top:0;bottom:0;left:-80%;width:55%;",
    " background:linear-gradient(100deg,transparent,rgba(255,255,255,.5),transparent);",
    " transform:skewX(-18deg);animation:broShine 2.8s ease-in-out infinite}",
    "#broFloatCta:active{transform:translateY(-50%) scale(.94)}",
    "@keyframes broShine{0%,50%{left:-80%}72%,100%{left:135%}}",
    "@keyframes broGrad{0%,100%{background-position:0 0}50%{background-position:0 100%}}",
    "@keyframes broPulse{0%,100%{box-shadow:0 12px 30px rgba(232,101,26,.5),0 4px 10px rgba(0,0,0,.18)}",
    " 50%{box-shadow:0 12px 34px rgba(232,101,26,.85),0 0 0 9px rgba(232,101,26,.15)}}",
    "@media print{#broFloatCta{display:none!important}}",
    "",
    ".bro-demo-pill{width:100%;margin:2px 0 10px;padding:9px 12px;border-radius:10px;",
    " border:1px dashed rgba(232,101,26,.55);background:rgba(232,101,26,.10);color:#ffb37a;",
    " font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;text-align:center}",
    ".bro-demo-pill:active{background:rgba(232,101,26,.22)}",
    "",
    ".bro-review{position:fixed;inset:0;z-index:10000;display:none;align-items:center;justify-content:center;",
    " padding:18px;background:rgba(8,20,28,.9);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}",
    ".bro-review.open{display:flex}",
    ".bro-review-card{position:relative;width:100%;max-width:470px;max-height:92vh;overflow-y:auto;",
    " background:linear-gradient(145deg,#1b3a4b,#132b39);border:1px solid rgba(255,255,255,.12);",
    " border-radius:18px;padding:26px 22px 24px;color:#fff;animation:broIn .25s ease}",
    "@keyframes broIn{from{opacity:0;transform:translateY(18px) scale(.98)}to{opacity:1;transform:none}}",
    ".bro-review-close{position:absolute;top:12px;right:14px;background:none;border:0;color:#9fb6c7;",
    " font-size:26px;line-height:1;cursor:pointer}",
    ".bro-review h4{font-size:18px;font-weight:800;margin-bottom:4px;color:#fff}",
    ".bro-review .rv-sub{font-size:12.5px;color:#b0c4d4;margin-bottom:16px}",
    ".bro-tl{list-style:none;margin:0;padding:0;position:relative}",
    ".bro-tl::before{content:'';position:absolute;left:13px;top:10px;bottom:12px;width:2px;background:rgba(255,255,255,.12)}",
    ".bro-tl li{position:relative;display:none;padding:0 0 18px 40px}",
    ".bro-tl li.show{display:block;animation:broFade .3s ease}",
    ".bro-tl li:last-child{padding-bottom:6px}",
    "@keyframes broFade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}",
    ".bro-tl .dot{position:absolute;left:2px;top:1px;width:24px;height:24px;border-radius:50%;",
    " background:#22384a;border:2px solid rgba(255,255,255,.22);display:flex;align-items:center;",
    " justify-content:center;font-size:12px;font-weight:800;color:#8ea9bd;box-sizing:border-box}",
    ".bro-tl li.done .dot{background:#E8651A;border-color:#E8651A;color:#fff}",
    ".bro-tl .tl-t{font-size:14.5px;font-weight:800;color:#e7eef4}",
    ".bro-tl .tl-d{font-size:12.5px;color:#9fb6c7;margin-top:3px;line-height:1.7}",
    ".bro-tl .tl-d b{color:#ffd9ae;font-weight:700}",
    ".bro-spin{display:inline-block;width:13px;height:13px;border:2px solid rgba(255,255,255,.25);",
    " border-top-color:#E8651A;border-radius:50%;vertical-align:-2px;animation:broSpin .7s linear infinite;margin-right:6px}",
    "@keyframes broSpin{to{transform:rotate(360deg)}}",
    ".bro-sub{margin-top:8px;display:none}",
    ".bro-sub.show{display:block}",
    ".bro-sub div{font-size:12.5px;color:#9fb6c7;padding:3px 0;visibility:hidden}",
    ".bro-sub div.show{visibility:visible}",
    ".bro-term{display:none;margin-top:9px;background:rgba(0,0,0,.34);border:1px solid rgba(255,255,255,.1);",
    " border-radius:10px;padding:11px 13px;font:12.5px/2 Consolas,'Courier New',monospace;color:#9fe3b9}",
    ".bro-term.show{display:block}",
    ".bro-term div{display:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".bro-term div.show{display:block}",
    ".bro-term .ok{color:#ffd28a;font-weight:700}",
    ".bro-final{display:none;text-align:center;margin-top:4px}",
    ".bro-final.show{display:block;animation:broFade .35s ease}",
    ".bro-final .big{font-size:34px;line-height:1.2}",
    ".bro-final h5{font-size:19px;font-weight:800;margin:8px 0 4px;color:#fff}",
    ".bro-final p{font-size:12.5px;color:#b0c4d4;margin-bottom:12px}",
    ".bro-acct{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-bottom:16px}",
    ".bro-acct span{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);",
    " border-radius:10px;padding:8px 13px;font-size:13px;color:#ffe9d2}",
    ".bro-acct b{color:#fff;font-weight:700}",
    ".bro-go{width:100%;display:block;text-align:center;font-size:15.5px;font-weight:800;padding:13px 10px;",
    " border-radius:12px;border:0;cursor:pointer;font-family:inherit}",
    ".bro-ghost{width:100%;margin-top:10px;background:none;border:1px solid rgba(255,255,255,.25);color:#c8dce9;",
    " font-size:13px;padding:9px;border-radius:10px;cursor:pointer;font-family:inherit}",
    ".bro-note{font-size:11px;color:#7d93a4;text-align:center;margin-top:12px;line-height:1.7}"
  ].join("");
  var st = document.createElement("style");
  st.id = "bro-demo-style";
  st.textContent = css;
  document.head.appendChild(st);

  /* ================= 1. 侧挂「立即开通」动图按钮 ================= */
  var floatBtn = document.createElement("button");
  floatBtn.type = "button";
  floatBtn.id = "broFloatCta";
  floatBtn.title = "立即开通体验";
  floatBtn.innerHTML = '<span class="ico">⚡</span><span class="txt">立即开通</span>';
  floatBtn.addEventListener("click", function () {
    modal.classList.add("open");
    document.body.style.overflow = "hidden";
  });
  document.body.appendChild(floatBtn);

  /* ================= 2. 演示模式 · 一键自动填写 ================= */
  function syncDDText() {
    var vs = form.querySelector('select[name="version"]');
    var txt = document.querySelector("#bro-dd .txt");
    if (vs && txt && vs.selectedOptions[0]) txt.textContent = vs.selectedOptions[0].textContent;
  }

  var demoPill = document.createElement("button");
  demoPill.type = "button";
  demoPill.className = "bro-demo-pill";
  demoPill.textContent = "🚀 演示模式 · 一键自动填写并提交";
  demoPill.addEventListener("click", function () {
    function set(name, val) {
      var el = form.querySelector('[name="' + name + '"]');
      if (el) el.value = val;
    }
    set("surname", "王");
    set("phone", "13941138888");
    set("company", "星海鲜果·连锁旗舰店");
    set("city", "大连");
    set("industry", "餐饮");
    set("scale", "3-10家");
    set("painpoint", "想做创始人IP，门店获客难、老客复购低");
    syncDDText();
    setTimeout(function () {
      if (form.requestSubmit) form.requestSubmit();
      else {
        var sb = form.querySelector(".modal-submit");
        if (sb) sb.click();
      }
    }, 350);
  });
  var submitBtn = form.querySelector(".modal-submit");
  if (submitBtn) submitBtn.parentNode.insertBefore(demoPill, submitBtn);

  /* ================= 3. 后台审核 → 开通权限 模拟流程 ================= */
  var ov = document.createElement("div");
  ov.className = "bro-review";
  ov.innerHTML = [
    '<div class="bro-review-card">',
    '  <button type="button" class="bro-review-close" aria-label="关闭">&times;</button>',
    '  <h4>🛰️ 思潼总部 · 开通后台</h4>',
    '  <p class="rv-sub">IP+AI 业绩倍增系统 · 开通流程模拟演示</p>',
    '  <ul class="bro-tl">',
    '    <li id="broSt1"><span class="dot">1</span><div class="tl-t">提交申请</div><div class="tl-d" id="broSt1D">受理编号 —</div></li>',
    '    <li id="broSt2"><span class="dot">2</span><div class="tl-t">后台审核</div>',
    '      <div class="bro-sub" id="broSub">',
    '        <div id="broChk1">资料校验（门店 / 联系人 / 行业）</div>',
    '        <div id="broChk2">商户资质审核</div>',
    '        <div id="broChk3">版本与席位配置</div>',
    '      </div>',
    '    </li>',
    '    <li id="broSt3"><span class="dot">3</span><div class="tl-t">审核通过</div><div class="tl-d">模拟即时通过 · 正式流程 1 个工作日内</div></li>',
    '    <li id="broSt4"><span class="dot">4</span><div class="tl-t">开通账号权限</div>',
    '      <div class="bro-term" id="broTerm">',
    '        <div id="broLn1">创建商户空间…</div>',
    '        <div id="broLn2">绑定版本…</div>',
    '        <div id="broLn3">生成体验账号…</div>',
    '        <div id="broLn4">设置初始密码…</div>',
    '        <div id="broLn5">分配数字高管团队（9 位数字高管）…</div>',
    '        <div id="broLn6" class="ok">✅ 账号权限开通完成</div>',
    '      </div>',
    '    </li>',
    '  </ul>',
    '  <div class="bro-final" id="broFinal">',
    '    <div class="big">🎉</div>',
    '    <h5>开通成功！业绩倍增系统账号已开放</h5>',
    '    <p>体验账号已生成，权限已绑定你的商户空间</p>',
    '    <div class="bro-acct"><span>账号 <b id="broAcc">—</b></span><span>初始密码 <b id="broPwd">—</b></span></div>',
    '    <button type="button" class="bro-go btn primary" id="broGo">进入业绩倍增系统 →</button>',
    '    <button type="button" class="bro-ghost" id="broBack">返回说明书</button>',
    '  </div>',
    '  <p class="bro-note">本页面为内部演示环境，审核与开通过程为模拟动画；<br>正式环境审核时长 1 个工作日内，由专属顾问电话协助开通。</p>',
    '</div>'
  ].join("");
  document.body.appendChild(ov);

  var STEP_IDS = ["broSt1", "broSt2", "broSt3", "broSt4"];
  var TERM_IDS = ["broLn1", "broLn2", "broLn3", "broLn4", "broLn5", "broLn6"];

  function $(id) { return document.getElementById(id); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function esc(s) {
    return String(s || "").replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function showStep(id) {
    var li = $(id);
    li.classList.add("show");
    return li;
  }
  function doneStep(id) {
    var li = $(id);
    li.classList.add("done");
    var d = li.querySelector(".dot");
    if (d) d.textContent = "✓";
  }
  function resetSteps() {
    STEP_IDS.forEach(function (id) {
      var li = $(id);
      li.classList.remove("show", "done");
      li.querySelector(".dot").textContent = id.replace("broSt", "");
    });
    $("broSub").classList.remove("show");
    ["broChk1", "broChk2", "broChk3"].forEach(function (id) { $(id).classList.remove("show"); });
    $("broTerm").classList.remove("show");
    TERM_IDS.forEach(function (id) { $(id).classList.remove("show"); });
    $("broFinal").classList.remove("show");
  }
  function chk(el, txt) { el.innerHTML = '<span class="bro-spin"></span>' + esc(txt); el.classList.add("show"); }
  function chkOk(el, txt) { el.innerHTML = "✓ " + esc(txt); }
  function ln(el, txt, ok) { el.innerHTML = (ok ? "" : '<span class="bro-spin"></span>') + esc(txt); el.classList.add("show"); }
  function termOk(el, txt) { el.innerHTML = '<span class="bro-spin"></span>' + esc(txt); el.classList.add("show"); }
  function termLine(el, txt) { el.textContent = txt; el.classList.add("show"); }

  function restoreSubmit() {
    if (__lastBtn) {
      __lastBtn.textContent = __lastBtnText;
      __lastBtn.disabled = false;
      __lastBtn = null;
    }
  }

  var __lastBtn = null, __lastBtnText = "", __lastVer = "";
  var runSeq = 0; // 取消令牌：关闭弹层后旧时序全部失效

  function closeReview() {
    runSeq++;
    ov.classList.remove("open");
    restoreSubmit();
  }

  function closeAll() {
    runSeq++;
    ov.classList.remove("open");
    modal.classList.remove("open");
    document.body.style.overflow = "";
    form.reset();
    form.style.display = "block";
    var s = $("leadSuccess");
    if (s) { s.style.display = "none"; s.classList.remove("show"); }
    // 还原版本默认值 + 代理商邀请码（对齐 lead-form.js applyDefaults 口径）
    var pv = location.pathname.indexOf("franchise") > -1 ? "招商加盟版" : "本地商家版";
    var vs = form.querySelector('select[name="version"]');
    if (vs) {
      var has = false;
      Array.prototype.slice.call(vs.options).forEach(function (o) { if (o.value === pv && !o.hidden) has = true; });
      vs.value = has ? pv : vs.options[0].value;
    }
    try {
      var raw = JSON.parse(localStorage.getItem(INV_KEY) || "null");
      var code = raw && raw.code && Date.now() - (raw.t || 0) < INV_TTL ? String(raw.code) : "";
      var ag = form.querySelector('input[name="agent_code"]');
      if (ag && code && !ag.value) ag.value = code;
    } catch (e) {}
    syncDDText();
    restoreSubmit();
  }

  ov.querySelector(".bro-review-close").addEventListener("click", closeReview);
  $("broBack").addEventListener("click", closeAll);
  $("broGo").addEventListener("click", function () {
    location.href = workbenchUrl(__lastVer);
  });

  // lead-form.js 提交时调用（本地演示版）：data=表单数据，btn=提交按钮
  window.__broDemo = {
    submit: function (data, btnEl, oldText) {
      var my = ++runSeq;
      __lastBtn = btnEl || null;
      __lastVer = data.version || "本地商家版";
      __lastBtnText = oldText || "提交申请";

      var acc = "sitong_" + String(data.phone || "8888").slice(-4);
      var pwd = "st#" + Math.random().toString(36).slice(2, 8);
      var no = "ST-IPAI-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") +
               "-" + String(Math.floor(Math.random() * 900) + 100);

      resetSteps();
      ov.classList.add("open");
      document.body.style.overflow = "hidden";

      $("broAcc").textContent = acc;
      $("broPwd").textContent = pwd;
      $("broSt1D").innerHTML = "受理编号 <b>" + no + "</b>" +
        (data.company ? " · " + esc(data.company) : "") +
        (data.city ? " · " + esc(data.city) : "");

      // 第 1 步：提交申请
      showStep("broSt1");
      sleep(900).then(function () {
        if (!alive(my)) return;
        doneStep("broSt1");

        // 第 2 步：后台审核（三项子检查）
        showStep("broSt2");
        $("broSub").classList.add("show");
        var c1 = $("broChk1"), c2 = $("broChk2"), c3 = $("broChk3");
        chk(c1, "资料校验中…");
        return sleep(1200).then(function () {
          if (!alive(my)) return;
          chkOk(c1, "资料校验通过");
          chk(c2, "商户资质审核中…");
          return sleep(1200);
        }).then(function () {
          if (!alive(my)) return;
          chkOk(c2, "商户资质审核通过");
          chk(c3, "版本与席位配置中…");
          return sleep(1200);
        }).then(function () {
          if (!alive(my)) return;
          chkOk(c3, "已配置：" + (data.version || "本地商家版") + " · 基础席位 3 个");
          doneStep("broSt2");

          // 第 3 步：审核通过
          showStep("broSt3");
          return sleep(900);
        }).then(function () {
          if (!alive(my)) return;
          doneStep("broSt3");

          // 第 4 步：开通账号权限（终端动画）
          showStep("broSt4");
          $("broTerm").classList.add("show");
          termOk($("broLn1"), "创建商户空间…");
          return sleep(800).then(function () {
            if (!alive(my)) return;
            termLine($("broLn1"), "$ 创建商户空间 … 完成");
            termLine($("broLn2"), "$ 绑定版本：" + (data.version || "本地商家版") + " · 基础席位 3 个");
            return sleep(650);
          }).then(function () {
            if (!alive(my)) return;
            termLine($("broLn3"), "$ 生成体验账号：" + acc);
            return sleep(650);
          }).then(function () {
            if (!alive(my)) return;
            termLine($("broLn4"), "$ 设置初始密码：" + pwd);
            return sleep(650);
          }).then(function () {
            if (!alive(my)) return;
            termOk($("broLn5"), "分配数字高管团队…");
            return sleep(900);
          }).then(function () {
            if (!alive(my)) return;
            termLine($("broLn5"), "$ 分配数字高管团队（9 位数字高管）… 完成");
            termLine($("broLn6"), "✅ 账号权限开通完成");
            doneStep("broSt4");

            // 终态：开通成功 + 进入业绩倍增系统
            return sleep(450).then(function () {
              if (!alive(my)) return;
              $("broFinal").classList.add("show");
              restoreSubmit();
            });
          });
        });
      }).catch(function () {});
    }
  };

  function alive(id) { return id === runSeq; }
})();
