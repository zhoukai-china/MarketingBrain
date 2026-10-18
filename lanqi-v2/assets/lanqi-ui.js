/* ============================================================
   兰琪AI·经营大脑 v2 · 全站共享 JS（2026-09-24）
   提供：门店数据 + 顶栏/底部Tab注入 + 门店切换 + toast/sheet
   用法：页面引入本文件后调用 LQ.init({ tab: 'home' })
   ============================================================ */
(function () {
"use strict";

/* ---------- 门店数据（与线上 demo 同源的精简内嵌版） ---------- */
var STORES = [
  {
    id: "s1", short: "大连总店", tag: "旗舰", city: "大连", addr: "中山区人民路 8 号",
    project: "不破皮肩颈护理", staff: 12, members: 486,
    targets: { rev: [300000, 182000], new: [40, 26], up: [20, 11], wake: [30, 14] },
    today: [
      { label: "今日营收", value: 8600, prefix: "¥", delta: "环比 +12%", cls: "up" },
      { label: "今日到店", value: 12, suffix: " 人", delta: "环比 +2", cls: "up" },
      { label: "客单价", value: 717, prefix: "¥", delta: "环比 -3%", cls: "dn" },
      { label: "卡耗率", value: 63, suffix: "%", delta: "达标线 60%", cls: "up" },
      { label: "沉睡率", value: 37, suffix: "%", delta: "需重点关注", cls: "dn" }
    ],
    sleep: [
      { key: "m1", stock: 86, goal: 18, cur: 9, rate: 75 },
      { key: "m2", stock: 54, goal: 8, cur: 4, rate: 67 },
      { key: "m3", stock: 41, goal: 4, cur: 1, rate: 20 }
    ],
    radar: { newGrow: 65, rebuy: 42, sleep: 37, churn: 2.4, aov: 717, kahao: 63, debt: 36, wake: 47, block: 3 },
    forecast: { pct: 61, month: 303332, gap: 3332, ok: true },
    health: 94, healthLv: "健康"
  },
  {
    id: "s2", short: "开发区店", tag: "", city: "大连", addr: "开发区金马路 126 号",
    project: "不破皮肩颈护理", staff: 7, members: 302,
    targets: { rev: [180000, 121000], new: [28, 19], up: [12, 8], wake: [20, 11] },
    today: [
      { label: "今日营收", value: 5200, prefix: "¥", delta: "环比 +8%", cls: "up" },
      { label: "今日到店", value: 8, suffix: " 人", delta: "环比 +1", cls: "up" },
      { label: "客单价", value: 650, prefix: "¥", delta: "环比 +2%", cls: "up" },
      { label: "卡耗率", value: 58, suffix: "%", delta: "达标线 60%", cls: "dn" },
      { label: "沉睡率", value: 35, suffix: "%", delta: "需关注", cls: "dn" }
    ],
    sleep: [
      { key: "m1", stock: 52, goal: 12, cur: 7, rate: 72 },
      { key: "m2", stock: 33, goal: 6, cur: 3, rate: 61 },
      { key: "m3", stock: 22, goal: 2, cur: 1, rate: 18 }
    ],
    radar: { newGrow: 68, rebuy: 38, sleep: 35, churn: 2.9, aov: 650, kahao: 58, debt: 33, wake: 55, block: 4 },
    forecast: { pct: 67, month: 201600, gap: 21600, ok: true },
    health: 98, healthLv: "健康"
  },
  {
    id: "s3", short: "高新万达店", tag: "新店", city: "大连", addr: "高新区万达广场 3F",
    project: "不破皮肩颈护理", staff: 5, members: 260,
    targets: { rev: [120000, 58000], new: [35, 24], up: [8, 3], wake: [12, 4] },
    today: [
      { label: "今日营收", value: 2600, prefix: "¥", delta: "环比 -5%", cls: "dn" },
      { label: "今日到店", value: 5, suffix: " 人", delta: "环比 -1", cls: "dn" },
      { label: "客单价", value: 520, prefix: "¥", delta: "环比 +6%", cls: "up" },
      { label: "卡耗率", value: 41, suffix: "%", delta: "低于达标线", cls: "dn" },
      { label: "沉睡率", value: 42, suffix: "%", delta: "需重点关注", cls: "dn" }
    ],
    sleep: [
      { key: "m1", stock: 68, goal: 7, cur: 2, rate: 55 },
      { key: "m2", stock: 29, goal: 3, cur: 1, rate: 42 },
      { key: "m3", stock: 12, goal: 2, cur: 0, rate: 12 }
    ],
    radar: { newGrow: 69, rebuy: 27, sleep: 42, churn: 4.2, aov: 520, kahao: 41, debt: 47, wake: 33, block: 7 },
    forecast: { pct: 48, month: 96000, gap: -24000, ok: false },
    health: 73, healthLv: "要救"
  },
  {
    id: "all", short: "全部门店", tag: "汇总", city: "大连", addr: "3 家门店合并视图",
    project: "不破皮肩颈护理", staff: 24, members: 1048,
    targets: { rev: [600000, 361000], new: [103, 69], up: [40, 22], wake: [62, 29] },
    today: [
      { label: "今日营收", value: 16400, prefix: "¥", delta: "环比 +8%", cls: "up" },
      { label: "今日到店", value: 25, suffix: " 人", delta: "环比 +2", cls: "up" },
      { label: "客单价", value: 656, prefix: "¥", delta: "环比 -1%", cls: "dn" },
      { label: "卡耗率", value: 58, suffix: "%", delta: "达标线 60%", cls: "dn" },
      { label: "沉睡率", value: 38, suffix: "%", delta: "需重点关注", cls: "dn" }
    ],
    sleep: [
      { key: "m1", stock: 206, goal: 37, cur: 18, rate: 73 },
      { key: "m2", stock: 116, goal: 17, cur: 8, rate: 63 },
      { key: "m3", stock: 75, goal: 8, cur: 2, rate: 19 }
    ],
    radar: { newGrow: 67, rebuy: 36, sleep: 38, churn: 3.4, aov: 656, kahao: 58, debt: 36, wake: 47, block: 5 },
    forecast: { pct: 60, month: 601600, gap: 1600, ok: true },
    health: 90, healthLv: "健康"
  }
];

/* ---------- 常量 ---------- */
var MONTH = { name: "2026年9月", totalDays: 30, passedDays: 18, leftDays: 12 };
var STORE_KEY = "lq_v2_store";
var PAGES = { /* 全站页面映射：key → [文件名, 页面名] */
  home: ["home.html", "经营驾驶舱"],
  cases: ["cases.html", "门店AI案例"],
  acquire: ["acquire.html", "公域获客"],
  moments: ["moments.html", "私域营销"],
  crm: ["crm.html", "客户管理"],
  salesSim: ["sales-sim.html", "AI模拟销售"],
  ops: ["store-ops.html", "门店后台"],
  wake: ["wake.html", "沉睡唤醒引擎"],
  liability: ["liability.html", "预收负债看板"],
  revenue: ["revenue.html", "收入结构"],
  goal: ["goal-detail.html", "目标明细"],
  record: ["record.html", "AI录音分析"],
  daily: ["daily-tasks.html", "每日清单"],
  mine: ["mine.html", "我的"],
  points: ["points-recharge.html", "积分中心"]
};
var TABS = [ /* 底部 5 Tab */
  { k: "home", ic: "🏠", nm: "首页" },
  { k: "daily", ic: "📅", nm: "清单" },
  { k: "acquire", ic: "📣", nm: "获客" },
  { k: "crm", ic: "👤", nm: "客户" },
  { k: "mine", ic: "🧑", nm: "我的" }
];
var DTOP = [ /* 桌面顶部导航 */
  { k: "home", nm: "🏠 经营驾驶舱" },
  { k: "cases", nm: "🏬 门店AI案例" },
  { k: "acquire", nm: "📣 公域获客" },
  { k: "moments", nm: "💬 私域营销" },
  { k: "crm", nm: "👤 客户管理" },
  { k: "salesSim", nm: "🤝 AI模拟销售" },
  { k: "record", nm: "📈 AI客户分析" },
  { k: "ops", nm: "🖥️ 门店后台" }
];

/* ---------- 工具 ---------- */
function $(s, r) { return (r || document).querySelector(s); }
function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function fmt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function pct(a, b) { return b > 0 ? Math.round(a / b * 100) : 0; }
function q(name) {
  var m = new RegExp("[?&]" + name + "=([^&]*)").exec(location.search);
  return m ? decodeURIComponent(m[1]) : "";
}
function storeById(id) { for (var i = 0; i < STORES.length; i++) if (STORES[i].id === id) return STORES[i]; return STORES[0]; }
function currentId() {
  try {
    var v = localStorage.getItem(STORE_KEY);
    if (v && storeById(v)) return v;
  } catch (e) {}
  return "s1";
}

/* ---------- toast ---------- */
var toastTimer = null;
function toast(msg, ms) {
  var el = $("#lqToast");
  if (!el) { el = document.createElement("div"); el.id = "lqToast"; el.className = "toast"; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.classList.remove("show"); }, ms || 1700);
}

/* ---------- 门店切换 sheet ---------- */
function openStoreSheet() {
  var sheet = $("#lqSheet"), mask = $("#lqSheetMask"), cur = currentId();
  if (!sheet) return;
  var h = '<div class="grap"></div><h3>选择门店</h3><div class="sub">全站数据随门店切换 · 共 24 名员工 · 1048 位会员</div>';
  STORES.forEach(function (x) {
    h += '<button class="opt' + (x.id === cur ? " on" : "") + '" data-lq-store="' + x.id + '">';
    h += '  <span class="ic">' + (x.id === "all" ? "🏬" : x.id === "s1" ? "⭐" : x.id === "s2" ? "🌿" : "🔥") + "</span>";
    h += '  <span><span class="nm">' + esc(x.short) + (x.tag ? '<span class="tg">' + esc(x.tag) + "</span>" : "") + '</span><span class="ds">' + esc(x.city) + " · " + x.staff + " 人 · " + x.members + " 会员</span></span>";
    h += '  <span class="ck">' + (x.id === cur ? "✓" : "") + "</span></button>";
  });
  h += '<div class="sub" style="margin-top:6px">📍 当前：' + esc(storeById(cur).addr) + "</div>";
  sheet.innerHTML = h;
  sheet.classList.add("show");
  mask.classList.add("show");
}
function closeStoreSheet() {
  var sheet = $("#lqSheet"), mask = $("#lqSheetMask");
  if (sheet) sheet.classList.remove("show");
  if (mask) mask.classList.remove("show");
}
function setStore(id) {
  if (!id || id === currentId()) { closeStoreSheet(); return; }
  try { localStorage.setItem(STORE_KEY, id); } catch (e) {}
  toast("已切换到 " + storeById(id).short);
  setTimeout(function () { location.reload(); }, 420);
}

/* ---------- 顶栏 + 底部 Tab 注入 ---------- */
function renderHeader(active) {
  var host = $("#lqHeader");
  if (!host) return;
  var cur = currentId();
  var h = '<header class="topbar"><div class="tb-row">';
  h += '  <div class="tb-logo" id="lqLogo">兰</div>';
  h += '  <div class="tb-name"><b>兰琪AI·<em>经营大脑</em></b><span>BEAUTY STORE AI BRAIN</span></div>';
  h += '  <div class="tb-spacer"></div>';
  h += '  <a class="tb-pts" href="points-recharge.html">💎 1280</a>';
  h += "</div>";
  h += '<div class="store-bar" id="lqStoreBar">';
  STORES.forEach(function (s) {
    h += '<button class="store-pill' + (s.id === cur ? " on" : "") + '" data-lq-store="' + s.id + '">🏬 ' + esc(s.short) + (s.tag ? ' <span class="tag">' + esc(s.tag) + "</span>" : "") + "</button>";
  });
  h += "</div>";
  h += '<nav class="dtop-nav">';
  DTOP.forEach(function (n) {
    h += '<a href="' + PAGES[n.k][0] + '" class="' + (n.k === active ? "on" : "") + '">' + n.nm + "</a>";
  });
  h += "</nav></header>";
  host.innerHTML = h;
}
function renderTabbar(tab) {
  var host = $("#lqTabbar");
  if (!host) return;
  var h = '<nav class="tabbar">';
  TABS.forEach(function (t) {
    h += '<a href="' + PAGES[t.k][0] + '" class="' + (t.k === tab ? "on" : "") + '"><span class="ti">' + t.ic + "</span>" + t.nm + "</a>";
  });
  h += "</nav>";
  host.innerHTML = h;
}

/* ---------- 入场动画 ---------- */
function riseIn(scope) {
  var els = $$(".rise", scope || document);
  els.forEach(function (el, i) { setTimeout(function () { el.classList.add("in"); }, 60 * i); });
  /* data-w 进度条动画 */
  setTimeout(function () {
    $$("[data-w]", scope || document).forEach(function (el) { el.style.width = el.getAttribute("data-w") + "%"; });
  }, 350);
}

/* ---------- 全局事件委托 ---------- */
document.addEventListener("click", function (e) {
  var st = e.target.closest("[data-lq-store]");
  if (st) { setStore(st.getAttribute("data-lq-store")); return; }
  if (e.target.closest("#lqLogo") || (e.target.closest(".store-pill") && e.target.closest(".store-pill").classList.contains("on"))) {
    e.preventDefault(); openStoreSheet(); return;
  }
  var mask = $("#lqSheetMask");
  if (mask && e.target === mask) closeStoreSheet();
});

/* ---------- 对外 API ---------- */
window.LQ = {
  STORES: STORES, MONTH: MONTH, PAGES: PAGES,
  $: $, $$: $$, esc: esc, fmt: fmt, pct: pct, q: q,
  store: function () { return storeById(currentId()); },
  storeId: currentId,
  toast: toast,
  riseIn: riseIn,
  init: function (opt) {
    opt = opt || {};
    if (!$("#lqSheetMask")) {
      var m = document.createElement("div"); m.id = "lqSheetMask"; m.className = "sheet-mask"; document.body.appendChild(m);
    }
    if (!$("#lqSheet")) {
      var s = document.createElement("div"); s.id = "lqSheet"; s.className = "sheet"; document.body.appendChild(s);
    }
    renderHeader(opt.nav || opt.tab);
    renderTabbar(opt.tab);
    riseIn();
    document.title = "兰琪AI·经营大脑 · " + (opt.title || PAGES[(opt.nav || opt.tab)][1]);
  }
};
})();
