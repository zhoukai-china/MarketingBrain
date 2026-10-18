/**
 * 产品说明书落地页 · 「预约开通体验账号」表单（2026-10-11）
 *
 * 承接流程图 §2 第 05 步「提交申请」：用户在说明书落地页填表提交，
 * 后端 `POST /market/ipai-franchise/apply` 落库并按邀请码做**来源归因**
 * （`?inv=` → ShareLink.code → 代理商；表单「推荐人/代理商代码」同理；都解析不到 → 总部直发）。
 *
 * 接口地址口径（与 SPA `lib/api.ts` 一致）：
 *   - 本地 dev（localhost / 127.0.0.1）→ 直连本地 API（默认 :3011，可用 `?apiBase=http://host:port` 覆盖）
 *   - 线上 → 同域 API：页面在 `/os-v2/ipai-brochure/` 下走 `/os-v2/api`，根域走 `/api`
 *
 * 邀请码兜底（2026-10-11 用户投诉「页面区分不出是哪个代理商分享的」）：
 *   客户首次经 `?inv=` 进入后，把邀请码记入 localStorage（30 天有效）；
 *   之后直接打开 / 回访 / 站内跳转丢了 `?inv=` 的访问，仍用记忆码回填价格与代理商标识、
 *   并随申请提交归因。客户再点其他代理商的新链接时以最新一次为准。
 */
(function () {
  function resolveApiBase() {
    var host = location.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
      var q = new URLSearchParams(location.search).get("apiBase");
      if (q && /^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(q)) return q.replace(/\/+$/, "");
      return "http://localhost:3011";
    }
    var m = location.pathname.match(/^(.*?)\/ipai-brochure\//);
    var prefix = m && m[1] ? m[1] : "";
    return prefix + "/api";
  }

  var API_BASE = resolveApiBase();

  var INV_KEY = "sitong_bro_inv_v1";
  var INV_TTL = 30 * 24 * 3600 * 1000; // 30 天

  function invFromUrl() {
    try {
      return new URLSearchParams(location.search).get("inv") || "";
    } catch (e) {
      return "";
    }
  }

  // 带 inv 访问 → 记忆并返回；不带 → 回读记忆码（过期作废）。
  function resolveInv() {
    var fromUrl = invFromUrl();
    if (fromUrl) {
      try {
        localStorage.setItem(INV_KEY, JSON.stringify({ code: fromUrl, t: Date.now() }));
      } catch (e) {}
      return fromUrl;
    }
    try {
      var raw = JSON.parse(localStorage.getItem(INV_KEY) || "null");
      if (raw && raw.code && Date.now() - (raw.t || 0) < INV_TTL) return String(raw.code);
    } catch (e) {}
    return "";
  }

  function sessionToken() {
    try {
      return localStorage.getItem("store_os_token") || "";
    } catch (e) {
      return "";
    }
  }

  function pageVersion() {
    return location.pathname.indexOf("franchise") > -1 ? "招商加盟版" : "本地商家版";
  }

  var inv = resolveInv();
  var modal = document.getElementById("leadModal");
  var form = document.getElementById("leadForm");
  var success = document.getElementById("leadSuccess");
  var versionSelect = form ? form.querySelector('select[name="version"]') : null;
  var agentInput = form ? form.querySelector('input[name="agent_code"]') : null;

  // 价格位回填：[data-bro-price] / [data-bro-price-year]；可带 data-bro-ver="本地商家版|招商加盟版"
  // 指定归属版本（版本选择页两个卡片各归各版本），缺省=本页版本。
  function priceElVersion(el) {
    return el.getAttribute("data-bro-ver") || pageVersion();
  }

  function backfillPrice(price, version) {
    if (price == null || isNaN(price)) return;
    var yen = "¥" + Number(price).toLocaleString("en-US");
    document.querySelectorAll("[data-bro-price]").forEach(function (el) {
      if (priceElVersion(el) !== version) return;
      el.textContent = yen;
    });
    document.querySelectorAll("[data-bro-price-year]").forEach(function (el) {
      if (priceElVersion(el) !== version) return;
      el.textContent = yen + "/年";
    });
    if (version === pageVersion()) {
      var opt = document.querySelector('select[name="version"] option[data-bro-opt]');
      if (opt) opt.textContent = opt.getAttribute("value") + "（" + yen + "/年）";
      syncDD();
    }
  }

  // 经代理商分享链接（?inv= 或记忆码）进入时，页面显著位置显示「本页由 XX 代理商专属提供」，
  // 让客户知道归属、也让归属对客户透明（用户 2026-10-11 口径）。
  function renderAgentBadge(name, kind) {
    var badge = document.getElementById("agentBadge");
    var nameEl = document.getElementById("agentBadgeName");
    if (nameEl) nameEl.textContent = name;
    if (badge) badge.classList.add("show");
    var sub = document.getElementById("leadModalSub");
    if (sub) {
      var who = kind === "referrer" ? "该推荐人" : "该代理商";
      sub.textContent = "本页由「" + name + "」专属提供 · 提交后" + who + "将尽快与您联系开通体验";
    }
  }

  // 需要取价版本集合：本页版本 + 页面上 data-bro-ver 出现过的版本（版本选择页=两版本各一次）。
  function versionsToFetch() {
    var set = {};
    set[pageVersion()] = true;
    document.querySelectorAll("[data-bro-ver]").forEach(function (el) {
      var v = el.getAttribute("data-bro-ver");
      if (v) set[v] = true;
    });
    return Object.keys(set);
  }

  function fetchMeta() {
    versionsToFetch().forEach(function (version) {
      var url =
        API_BASE +
        "/market/ipai-franchise/brochure-meta?inv=" +
        encodeURIComponent(inv || "") +
        "&version=" +
        encodeURIComponent(version);
      fetch(url, { headers: { Accept: "application/json" } })
        .then(function (r) {
          return r.ok ? r.json() : null;
        })
        .then(function (j) {
          if (!j) return;
          if (typeof j.recommendedPrice === "number") backfillPrice(j.recommendedPrice, version);
          if (version === pageVersion()) {
            if ((j.sourceKind === "agent" || j.sourceKind === "referrer") && j.agentName) {
              renderAgentBadge(j.agentName, j.sourceKind);
              // 带归因进入：版本只保留该链接对应的那一版（用户 2026-10-11「项目对应不上」）。
              filterVersions();
            }
          }
        })
        .catch(function () {
          if (window.console && console.warn)
            console.warn("[brochure] brochure-meta 获取失败，价格保持默认（API=" + API_BASE + "）");
        });
    });
  }

  function applyDefaults() {
    if (versionSelect) versionSelect.value = pageVersion();
    // 邀请码自动带出到「推荐人/代理商代码」，用户仍可改
    if (agentInput && inv && !agentInput.value) agentInput.value = inv;
    syncDD();
  }

  /* ============ 「感兴趣版本」自定义下拉（2026-10-11 用户点名：不用原生样式） ============ */
  var ddWrap = null, ddBtn = null, ddPanel = null;

  function injectDDStyle() {
    if (document.getElementById("bro-dd-style")) return;
    var s = document.createElement("style");
    s.id = "bro-dd-style";
    s.textContent = [
      ".bro-dd{position:relative}",
      ".bro-dd-btn{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;",
      "padding:11px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.16);",
      "background:rgba(255,255,255,.05);color:#e7eef4;font-size:14px;font-weight:600;cursor:pointer;text-align:left;font-family:inherit}",
      ".bro-dd-btn .car{flex:none;font-size:11px;opacity:.7;transition:transform .15s ease}",
      ".bro-dd.open .bro-dd-btn .car{transform:rotate(180deg)}",
      ".bro-dd-panel{display:none;position:absolute;left:0;right:0;top:calc(100% + 6px);z-index:30;overflow:hidden;padding:6px;",
      "background:#22384a;border:1px solid rgba(255,255,255,.14);border-radius:12px;box-shadow:0 18px 44px rgba(6,18,28,.5)}",
      ".bro-dd.open .bro-dd-panel{display:block}",
      ".bro-dd-opt{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;",
      "border-radius:8px;font-size:14px;color:#c6d5e0;cursor:pointer;white-space:nowrap}",
      ".bro-dd-opt:hover{background:rgba(255,255,255,.07);color:#fff}",
      ".bro-dd-opt.on{color:#fff;background:rgba(232,101,26,.18)}",
      ".bro-dd-opt.on::after{content:'✓';color:#E8651A;font-weight:800}"
    ].join("");
    document.head.appendChild(s);
  }

  // 用自定义组件替换原生 select 的外观；select 本体隐藏保留，提交/校验口径不变。
  function buildVersionDD() {
    if (!versionSelect || document.getElementById("bro-dd")) return;
    injectDDStyle();
    ddWrap = document.createElement("div");
    ddWrap.className = "bro-dd";
    ddWrap.id = "bro-dd";
    ddBtn = document.createElement("button");
    ddBtn.type = "button";
    ddBtn.className = "bro-dd-btn";
    ddBtn.innerHTML = '<span class="txt"></span><span class="car">▾</span>';
    ddPanel = document.createElement("div");
    ddPanel.className = "bro-dd-panel";
    ddWrap.appendChild(ddBtn);
    ddWrap.appendChild(ddPanel);
    versionSelect.parentNode.insertBefore(ddWrap, versionSelect);
    versionSelect.style.display = "none";
    ddBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      var willOpen = !ddWrap.classList.contains("open");
      ddWrap.classList.toggle("open", willOpen);
      if (willOpen) renderDDOptions();
    });
    // 收起用 capture 阶段监听（2026-10-11 用户实测：普通冒泡监听点「所属行业」等原生控件时
    // 收不到 click，面板收不回去）。capture 在一切 stopPropagation 之前触发，任何点击必经；
    // 再配 focusin（原生 select 展开/切换焦点不产生 click）+ Esc 三重兜底。
    function ddOutside(e) {
      if (ddWrap && ddWrap.classList.contains("open") && !ddWrap.contains(e.target))
        ddWrap.classList.remove("open");
    }
    document.addEventListener("click", ddOutside, true);
    document.addEventListener("focusin", ddOutside, true);
    // 焦点已停在某个原生 select 上时（如刚选完行业再点开面板又直接选值），选值只发 change
    // 不产生焦点转移——change 也收起（2026-10-12 无头场景③抓到的残留 bug）。
    document.addEventListener("change", function (e) {
      if (
        ddWrap &&
        ddWrap.classList.contains("open") &&
        e.target !== versionSelect &&
        !ddWrap.contains(e.target)
      )
        ddWrap.classList.remove("open");
    }, true);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && ddWrap) ddWrap.classList.remove("open");
    }, true);
    syncDD();
  }

  function renderDDOptions() {
    if (!ddPanel || !versionSelect) return;
    ddPanel.innerHTML = "";
    Array.prototype.slice.call(versionSelect.options).forEach(function (opt) {
      if (opt.hidden) return;
      var item = document.createElement("div");
      item.className = "bro-dd-opt" + (opt.value === versionSelect.value ? " on" : "");
      item.textContent = opt.textContent;
      item.addEventListener("click", function () {
        versionSelect.value = opt.value;
        ddWrap.classList.remove("open");
        syncDD();
      });
      ddPanel.appendChild(item);
    });
  }

  function syncDD() {
    if (!ddBtn || !versionSelect) return;
    var cur = versionSelect.selectedOptions[0];
    ddBtn.querySelector(".txt").textContent = cur ? cur.textContent : "";
    ddWrap.classList.remove("open");
  }

  // 带归因（代理商/推荐官链接）进入：隐藏非本页版本项，客户选不出与链接不符的版本。
  function filterVersions() {
    if (!versionSelect) return;
    Array.prototype.slice.call(versionSelect.options).forEach(function (opt) {
      opt.hidden = opt.value !== pageVersion();
    });
    if (versionSelect.value !== pageVersion()) versionSelect.value = pageVersion();
    syncDD();
  }

  applyDefaults();
  fetchMeta();
  buildVersionDD();

  // 版本选择页（index.html）没有预约弹窗，只做价格回填 + 邀请码透传，到此为止。
  if (!modal || !form) return;

  function openModal() {
    modal.classList.add("open");
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    modal.classList.remove("open");
    document.body.style.overflow = "";
    form.reset();
    success.style.display = "none";
    success.classList.remove("show");
    form.style.display = "block";
    applyDefaults();
  }

  document.querySelectorAll('a[href="#"], a[href="#open-lead"], .cta .btn.primary').forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      openModal();
    });
  });

  modal.querySelector(".modal-backdrop").addEventListener("click", closeModal);
  modal.querySelector(".modal-close").addEventListener("click", closeModal);
  modal.querySelector(".modal-close-btn").addEventListener("click", closeModal);

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!form.checkValidity()) return;

    var data = {};
    new FormData(form).forEach(function (v, k) {
      data[k] = v;
    });
    data.inv = inv;
    data.page_version = pageVersion();
    data.submit_time = new Date().toISOString();
    data.source_url = location.href;

    var btn = form.querySelector(".modal-submit");
    var oldText = btn.textContent;
    btn.textContent = "提交中...";
    btn.disabled = true;

    // 本地演示版（2026-10-18）：不走真实 API，改走「后台审核 → 开通账号权限」模拟流程，
    // 审核通过后由 demo-flow.js 出示体验账号并开放业绩倍增系统入口。
    // 正式环境：还原下方 fetch 提交（POST /market/ipai-franchise/apply），
    // 开通仍走后台线索行「一键开通体验」（2026-10-12 口径：开通一律由代理商手动发起）。
    if (window.__broDemo && window.__broDemo.submit) {
      window.__broDemo.submit(data, btn, oldText);
    } else {
      btn.textContent = oldText;
      btn.disabled = false;
      alert("演示脚本未加载：请通过本地预览服务访问 ipai-brochure 目录。");
    }
  });
})();
