import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { apiPath, getAppPath, getPublicAssetPath } from "../lib/api.js";
import { MallTopbar } from "./MallTopbar.js";
import { IconGlyph } from "./IconGlyph.js";
import { RechargeDrawer } from "./RechargeDrawer.js";
import { BookingModal } from "./BookingModal.js";
import { DrawerPager, useIsMobile } from "./DrawerPager.js";
import { InvitePoster } from "./InvitePoster.js";
import { AppsDrawer } from "./AppsDrawer.js";
import { fmtCredits } from "../lib/fmt.js";
import { useScrollLock } from "../lib/use-scroll-lock.js";
import { fetchMarketMe, readJson, authHeaders, guestToLogin, handleStaleSession } from "./shell.js";
import { clearStoredSession } from "../lib/session.js";
import { loginPathWithPendingReferral } from "../lib/pending-referral.js";
import { employeePersonaLabel } from "./employee-names.js";
import {
  ECO_CONSULTANTS,
  ECO_EMPLOYEES,
  ECO_SKIN_ORDER,
  employeeSkuCode,
  employeeDetailPath,
  employeeImagePath,
  consultantImagePath,
  type EcoConsultant,
  type EcoEmployee,
  type EcoSkinKey
} from "./eco-mall-data.js";
import { ECO_CASES, ECO_CASE_CATS, type EcoCase, type EcoCaseNav } from "./eco-cases-data.js";

/** 「我的」页退出登录：清本地会话后回到登录页。 */
function handleMineLogout() {
  clearStoredSession();
  window.location.href = getAppPath(loginPathWithPendingReferral("/login"));
}

/**
 * 「已开通」态本地缓存（2026-09-30）。
 *
 * 起因：hero 主按钮文案由 `/market/me` 的 `activated` 决定，而请求是异步的——
 * 首帧先按「免费开通 · 立送 100 算力」渲染，请求回来后当场变成「开始今日任务」，
 * 用户看到的就是「按钮闪一下 / 文案闪变」，体验很差。
 * 做法：把服务端确认过的开通态缓存下来，回到商城时首帧就渲染对的文案；
 * 只有服务端**明确回答**过才写缓存（未登录不写），避免把游客态写成永久结论。
 */
const ACTIVATED_CACHE_KEY = "store_os_mall_activated";
function readActivatedCache(): boolean | null {
  try {
    const raw = localStorage.getItem(ACTIVATED_CACHE_KEY);
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch { /* 隐私模式：退化成「未知」 */ }
  return null;
}
function writeActivatedCache(value: boolean) {
  try { localStorage.setItem(ACTIVATED_CACHE_KEY, value ? "1" : "0"); } catch { /* ignore */ }
}

/** 算力明细分类（与后端 LEDGER_CATEGORY_LABELS 同口径；数字从服务端回来再补）。 */
const LEDGER_CATEGORIES: Array<{ key: string; label: string }> = [
  { key: "all", label: "全部" },
  { key: "recharge", label: "充值" },
  { key: "gift", label: "赠送" },
  { key: "consume", label: "消耗" },
  { key: "refund", label: "退回" }
];

type FloorId = "floor-acquire" | "floor-private" | "floor-consultants" | "floor-hardware" | "floor-courses" | "floor-opc" | "floor-industry" | "floor-cases";

/** 金刚区七格（原型 v3.28，tint 照原型 data-tint）。 */
const KINGKONG: Array<{ floor: FloorId; label: string; icon: string; tint: string; glyph: string; deep: string }> = [
  { floor: "floor-acquire", label: "内容获客", icon: "✍️", tint: "#FF7A1A", glyph: "pen", deep: "#C24A00" },
  { floor: "floor-private", label: "私域营销", icon: "💬", tint: "#F2538A", glyph: "chat", deep: "#B01E56" },
  { floor: "floor-consultants", label: "数字咨询师", icon: "🧭", tint: "#F5A623", glyph: "compass", deep: "#9C6410" },
  { floor: "floor-hardware", label: "AI硬件", icon: "🔌", tint: "#0E9F6E", glyph: "chip", deep: "#066B49" },
  { floor: "floor-courses", label: "AI课程", icon: "🎓", tint: "#FF5C4D", glyph: "cap", deep: "#5F2B9C" },
  { floor: "floor-opc", label: "OPC专区", icon: "🏭", tint: "#D96A00", glyph: "factory", deep: "#8F4200" },
  { floor: "floor-industry", label: "行业工作台", icon: "🏪", tint: "#E8A33D", glyph: "store", deep: "#8E1249" }
];

/** 交付单位（照原型 emp-price：定位=份 / 直播=场 / 文案·诊断·选题=次 / 私域=条）。 */
const UNIT_BY_KEY: Record<string, string> = {
  "ip-position": "份",
  copywriter: "次",
  "video-diag": "次",
  "live-host": "场",
  topic: "次",
  "live-coach": "场",
  private: "条",
  "sales-coach": "次"
};

/** Hero 打字机台词（原型 heroType 演示口径）。 */
const TYPE_LINES = [
  "今天要发内容？让秦文给你一条能念的稿",
  "周一起号？让沈定先给你定人设",
  "刚播完一场？让罗盘把话术复盘一遍"
];

/** 楼层分组（原型 v3.28：F1 内容获客 / F2 私域营销，按 employeeKey 归组）。 */
const ACQUIRE_OK_KEYS = ["ip-position", "copywriter", "live-host", "video-diag", "topic"];
const ACQUIRE_DEV_KEYS = ["live-coach"];
const PRIVATE_DEV_KEYS = ["private", "sales-coach"];

const TODAY_ITEMS: Array<{ title: string; hint: string; employeeKey: string }> = [
  { title: "今天要发内容", hint: "让金牌文案主笔直接给你一条能念的稿", employeeKey: "copywriter" },
  { title: "周一起号 / 定方向", hint: "让首席定位官先定人设，再排内容", employeeKey: "ip-position" },
  { title: "刚直播完 / 发了视频", hint: "让流量诊断官或直播复盘导师帮你复盘", employeeKey: "video-diag" }
];

/** AI 案例（原型 v3.12 信息流；演示数据虚构，口径照原型）。 */
const AI_CASES: Array<{ tag: string; title: string; metric: string; point: string; agents: string }> = [
  { tag: "美容门店", title: "美容院上线 AI 经营大脑", metric: "到店转化 21% → 34%", point: "门店的资产不是流量，是「记得住每个顾客」——记忆底座一建，转化和客单一起涨。", agents: "经营大脑 · 数字员工" },
  { tag: "前台提效", title: "重复答一年的问题交给机器人", metric: "前台腾出 0.5 人力去干转化", point: "重复答了一年的问题就该交给机器人——前台腾出来的人去干转化。", agents: "数字咨询师" },
  { tag: "短视频", title: "视频没流量，先复盘再拍", metric: "1 条视频复盘 + 下一条迭代动作", point: "从播放、完播、互动、转化里找毛病，给出下一条怎么改的动作。", agents: "江流 · 视频复盘官" },
  { tag: "直播", title: "开播前要话术，播后要复盘", metric: "1 场复盘（流量/转化/话术）+ 迭代动作", point: "开播前找罗盘要话术，播后找许复拉数据，下场照着改。", agents: "罗盘 · 许复" }
];

/**
 * 交付物短标签：从完整交付描述里截出核心名词。
 * 「1 份 IP 定位全案：一句话定位 / …」→「IP 定位全案」；「1 个场景成交话术 + 异议处理脚本」→「成交话术」。
 */
function shortDeliver(deliver: string): string {
  let text = deliver
    .replace(/^\s*\d+(?:[–—-]\d+)?\s*(?:个场景|个|份|条|套|场)\s*/, "")
    .trim();
  const cut = text.search(/[：（+，]/);
  if (cut > 0) text = text.slice(0, cut).trim();
  return text;
}

function EcoAvatar({
  icon,
  img,
  className
}: {
  icon: string;
  img: string;
  className?: string;
}) {
  return (
    <div className={`eco-ava ${className ?? ""}`} aria-hidden="true">
      <span className="eco-emoji">{icon}</span>
      {img ? (
        <img
          src={img}
          alt=""
          loading="lazy"
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      ) : null}
    </div>
  );
}

/** 京东式竖版商品卡：方图 + 标题 + 店铺行 + 卖点 + 标签 + 价格行 + 购买按钮。 */
function EmployeeProduct({
  employee,
  status,
  index,
  ppu,
  onOpen
}: {
  employee: EcoEmployee;
  status: "ok" | "dev";
  index: number;
  ppu: number | undefined;
  onOpen: () => void;
}) {
  const ok = status === "ok";
  const current = employee.skins["通用"];
  const hook = current?.hook ?? employee.hookBase;
  const deliver = shortDeliver(current?.deliver ?? "");

  const unit = UNIT_BY_KEY[employee.key] ?? "次";
  const cny = ppu != null ? (ppu / 10).toFixed(ppu % 10 === 0 ? 0 : 1) : "—";
  return (
    <article
      className={`eco-product ${ok ? "is-ok" : "is-dev"}`}
      style={{ animationDelay: `${Math.min(index, 9) * 40}ms` }}
      onClick={onOpen}
    >
      <div className="eco-p-img">
        <EcoAvatar icon={employee.icon} img={employeeImagePath(employee)} />
        <i className={`eco-p-dot ${ok ? "ok" : "dev"}`} />
      </div>
      <div className="eco-p-body">
        <div className="eco-p-top">
          <b className="eco-p-name">{employeePersonaLabel(employee.capability)}</b>
          <span className="eco-p-role">{employee.role} · AI 智能体</span>
        </div>
        <span className="eco-p-desc">{hook}</span>
        {deliver ? <span className="eco-p-tag">{deliver}</span> : null}
        <span className="eco-p-price">
          <IconGlyph name="bolt" size={12} style={{ display: "inline", verticalAlign: "-1px" }} /> {fmtCredits(ppu)} 算力/{unit} <i>≈ ¥{cny} · 0元开通 · 用后扣费</i>
        </span>
      </div>
    </article>
  );
}

/** 占位商品卡：AI 硬件 / AI 课程等还没上架的货架位。 */
function ConsultantModal({ consultant, onClose }: { consultant: EcoConsultant; onClose: () => void }) {
  return (
    <div className="eco-mask show" role="dialog" aria-modal="true" onClick={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="eco-modal">
        <button className="eco-modal-x" type="button" onClick={onClose} aria-label="关闭">×</button>
        <div className="eco-modal-top">
          <EcoAvatar icon={consultant.icon} img={consultantImagePath(consultant)} className="eco-m-ava" />
          <div>
            <div className="eco-m-role">{consultant.name}</div>
            <div className="eco-m-tag">{consultant.face}</div>
          </div>
        </div>
        <div className="eco-m-hook">{consultant.meta}</div>
        <div className="eco-note">
          <b>说明：</b>数字咨询师是「这个人方法论」的数字分身。当前分身能力还在接入中，先把保禄数字分身请进商城，正式可对话后会在卡片上点亮「可对话」。
        </div>
        <button className="eco-primary" type="button" disabled>数字分身接入中 · 敬请期待</button>
      </div>
    </div>
  );
}

function FloorHead({ no, title, sub, live }: { no: string; title: string; sub?: string; live?: string }) {
  return (
    <div className="eco-floor-head">
      <div className="eco-floor-title">
        <span className="eco-floor-no">{no}</span>
        <h2>{title}</h2>
      </div>
      {sub ? <div className="eco-floor-sub">{sub}</div> : null}
      {live ? <span className="eh-floor-live"><i></i>{live}</span> : null}
    </div>
  );
}

/* 首页内联视图（不是路由）。2026-09-30 用户：商城内部页顶栏的「我的」原先把人送到旧版独立页
   `/mine`（MinePage），要收口到新版内联视图——所以对外暴露 `?tab=mine` 之类的入口，
   任何页面只要指向 `/agents?tab=mine` 就能落在新版的「我的」上。 */
const MALL_VIEWS = ["home", "cases", "cart", "mine"] as const;
type MallView = (typeof MALL_VIEWS)[number];

/** 从地址栏读初始视图（`?tab=mine`）；非法或缺省一律回首页。 */
function readInitialMallView(): MallView {
  if (typeof window === "undefined") return "home";
  const tab = new URLSearchParams(window.location.search).get("tab");
  return (MALL_VIEWS as readonly string[]).includes(tab ?? "") ? (tab as MallView) : "home";
}

/**
 * 新客礼（0 元开通送的 100 算力）的有效期天数。
 *
 * 必须与后端 `apps/api/src/services/sitong-wallet.ts` 的 `SIGNUP_GIFT_VALIDITY_DAYS`
 * 保持一致——**新客礼是 30 天，不跟签到 / 邀请的 90 天共用**（用户 2026-09-30 明确）。
 * 这里只是「领取前」的展示兜底；领取后的实际天数以 `/market/activate` 返回的
 * `gift.validDays` 为准（见 activateGift.validDays）。
 */
const SIGNUP_GIFT_VALID_DAYS = 30;

export function EcoMallHomePage() {
  const [query, setQuery] = useState("");
  const [activeFloor, setActiveFloor] = useState<FloorId>("floor-acquire");
  const [balance, setBalance] = useState<number | null>(null);
  const [skuPpu, setSkuPpu] = useState<Map<string, number> | null>(null);
  // view 是首页的内联状态机（不是路由）：「购物车」是 2026-09-30 按原型补齐的第 4 个视图。
  const [view, setView] = useState<MallView>(readInitialMallView);

  /* 统一切换内联视图：同步地址栏（replaceState，不产生历史记录），
     这样刷新或从别的页面用 `/agents?tab=xxx` 回跳都能落在同一视图。 */
  const goView = useCallback((next: MallView) => {
    setView(next);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (next === "home") url.searchParams.delete("tab");
      else url.searchParams.set("tab", next);
      window.history.replaceState(null, "", url.toString());
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, []);

  const [showRecharge, setShowRecharge] = useState(false);
  const [booking, setBooking] = useState<{ name: string; key: string } | null>(null);
  const [caseCat, setCaseCat] = useState("all");
  const [openCase, setOpenCase] = useState<EcoCase | null>(null);
  const [openConsultant, setOpenConsultant] = useState<EcoConsultant | null>(null);
  // B 线新增（agents-home-tech-demo v3.28 对齐，2026-09-28）：签到 / 邀请 / 新手词典弹层。
  // 签到已接后端（/market/signin）：按账号维度记账、赠送算力 90 天有效、限自营文字类智能体。
  const [showSignIn, setShowSignIn] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showDict, setShowDict] = useState(false);

  /* 「邀请有礼」抽屉数据：海报（二维码/链接）+ 邀请码 + 被邀请客户列表。
     来源两个接口：/me/referral-link（链接/码/二维码，明文只在签发时回一次）与 /me/referrals（打码客户列表）。 */
  interface ReferralLinkView {
    state: "none" | "existing" | "created";
    campaignActive: boolean;
    link: string | null;
    code: string | null;
    codePreview: string | null;
    qrSvg: string | null;
    codesCount: number;
    hint: string;
  }
  interface InviteeItem {
    id: string;
    name: string;
    phone: string | null;
    boundAt: string;
    hasWechat: boolean;
    firstUseRewarded: boolean;
    firstRechargeRewarded: boolean;
    creditsEarned: number;
  }
  interface InviteesView {
    total: number;
    creditsEarned: number;
    page: number;
    pageSize: number;
    totalPages: number;
    invitees: InviteeItem[];
  }
  const [inviteLink, setInviteLink] = useState<ReferralLinkView | null>(null);
  const [invitees, setInvitees] = useState<InviteesView | null>(null);
  /** 被邀请客户行（手机端翻页流 append / PC 整页替换），同算力明细一套交互。 */
  const [inviteeItems, setInviteeItems] = useState<InviteeItem[]>([]);
  const [inviteePage, setInviteePage] = useState(1);
  const INVITEE_PAGE_SIZE = 8;
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  /* ---- 全部订单 / 历史交付物 / 关联应用：统一右侧抽屉 + 分页（2026-09-30 用户） ---- */
  interface OrderDetailView { label: string; value: string }
  interface OrderItemView {
    id: string;
    kind: "recharge" | "subscription" | "booking";
    kindLabel: string;
    orderNo: string;
    title: string;
    amountCny: number | null;
    credits: number | null;
    status: string;
    statusLabel: string;
    createdAt: string;
    paidAt: string | null;
    detail: OrderDetailView[];
  }
  interface OrdersView { page: number; pageSize: number; total: number; totalPages: number; orders: OrderItemView[] }
  const ORDERS_PAGE_SIZE = 10;
  const [showOrders, setShowOrders] = useState(false);
  const [orders, setOrders] = useState<OrdersView | null>(null);
  const [orderItems, setOrderItems] = useState<OrderItemView[]>([]);
  const [ordersPage, setOrdersPage] = useState(1);
  const [ordersBusy, setOrdersBusy] = useState(false);
  /** 展开详情的订单 id（手风琴，同抽屉内看详情不跳页）。 */
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);

  interface DelivItemView { id: string; skuName?: string | null; answer: string; credits: number; createdAt: string; expiresAt: string }
  interface DelivView { page: number; pageSize: number; total: number; totalPages: number }
  const DELIV_PAGE_SIZE = 8;
  const [showDeliv, setShowDeliv] = useState(false);
  const [deliv, setDeliv] = useState<DelivView | null>(null);
  const [delivItems, setDelivItems] = useState<DelivItemView[]>([]);
  const [delivPage, setDelivPage] = useState(1);
  const [delivBusy, setDelivBusy] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  /* 关联应用抽屉已抽成共享组件 AppsDrawer.tsx（商城「我的」与选题工作台共用），
     此处只保留开关；目录/连接/配置逻辑见组件内。 */
  const [showApps, setShowApps] = useState(false);

  /** 签到状态视图（后端 /market/signin 返回，与 daily-signin.ts 对齐）。 */
  interface SigninDayView {
    day: number;
    label: string;
    credits: number;
    signed: boolean;
    current: boolean;
  }
  interface SigninStatusView {
    signedToday: boolean;
    streak: number;
    cycleDay: number;
    nextCredits: number;
    earnedInCycle: number;
    weeklyCap: number;
    validDays: number;
    expiresAt: string | null;
    totalSignedDays: number;
    days: SigninDayView[];
  }
  const [signinStatus, setSigninStatus] = useState<SigninStatusView | null>(null);
  const [signinBusy, setSigninBusy] = useState(false);
  const [signinError, setSigninError] = useState<string | null>(null);

  // 「免费开通」注册礼：弹层状态 + 后端返回的礼包 + 从 /market/me 读的已开通态。
  const [showActivate, setShowActivate] = useState(false);
  const [activateStep, setActivateStep] = useState<"form" | "success">("form");
  const [activateGift, setActivateGift] = useState<{ amount: number; expiresAt: string | null; scope: string; validDays?: number } | null>(null);
  /**
   * 已开通态：初值取本地缓存（首帧文案就是对的），服务端回来后以服务端为准。
   * 已登录但还没有缓存时，CTA 先留空占位、拿到真实态再淡入——不再有文案闪变。
   */
  const [meActivated, setMeActivated] = useState<boolean | null>(readActivatedCache);
  const mountedWithToken = useRef<boolean | null>(null);
  if (mountedWithToken.current === null) {
    try { mountedWithToken.current = Boolean(localStorage.getItem("store_os_token")); } catch { mountedWithToken.current = false; }
  }
  /**
   * 「我的」页要显示的真实账号信息。
   *
   * 2026-09-30（用户）：这里原来摆的是写死的「体验访客 / 演示账号 / 首次登入 2026-09-25」——
   * 用户在同一微信号下扫码注册后，看到这个假身份以为系统另开了个「新账号」。
   * 现在改为读后端 `/market/me` 下发的真实账号（租户名 + 注册时间 + userId），
   * 让用户能自己判断 PC 与微信两端登录的是不是同一个号；未取到后端数据时回退本地租户名。
   */
  const [accountInfo, setAccountInfo] = useState<{ userId: string; createdAt: string; tenantName: string | null } | null>(null);
  const [localAccountName, setLocalAccountName] = useState("");
  useEffect(() => {
    try { setLocalAccountName(localStorage.getItem("store_os_tenant_name") ?? ""); } catch { setLocalAccountName(""); }
  }, []);
  /** CTA 文案是否已知：未知就先不显示文字（保留按钮位置），避免「先错后对」的闪烁。 */
  const ctaReady = meActivated !== null || !mountedWithToken.current;
  /** 服务端确认过的开通态统一入口：同时更新缓存，下次首帧直接用。 */
  function applyActivated(value: boolean) {
    setMeActivated(value);
    writeActivatedCache(value);
  }
  const [meToast, setMeToast] = useState<string | null>(null);
  const meNote = (msg: string) => { setMeToast(msg); window.setTimeout(() => setMeToast(null), 1800); };

  /**
   * 算力明细（后端 /credits/ledger）：与余额同源，登录后才有数据。
   * 2026-09-30（用户）：改成**右侧抽屉** + 分类 / 搜索 / 分页，与充值抽屉同一套骨架。
   */
  interface LedgerEntryView {
    id: string;
    createdAt: string;
    type: string;
    bucket: "paid" | "bonus";
    direction: "in" | "out" | "flat";
    amount: number;
    label: string;
    detail: string;
    expiresAt: string | null;
    expired: boolean;
    category: string;
  }
  interface LedgerView {
    /* 后端 /credits/ledger 返回的是 WalletSnapshot 原字段（paidBalance/bonusBalance），
       2026-09-30 修正：之前错读 wallet.paid → 恒为 undefined → 抽屉顶部「实付余额 0」，
       用户充值到账后仍显示 0 的假象即源于此。 */
    wallet: { paidBalance: number; bonusBalance: number; balance: number };
    entries: LedgerEntryView[];
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    category: string;
    query: string;
    categories: Array<{ key: string; label: string; count: number }>;
    bonusExpiringAt: string | null;
    usableBonus: number;
    expiredBonus: number;
  }
  const LEDGER_PAGE_SIZE = 8;
  const isMobile = useIsMobile();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showLedger, setShowLedger] = useState(false);
  const [ledger, setLedger] = useState<LedgerView | null>(null);
  /** 明细行（手机端翻页流：滚动到底 append 下一页；PC 端整页替换）。 */
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntryView[]>([]);
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledgerCategory, setLedgerCategory] = useState("all");
  /** 输入框即时值 → 300ms 防抖后进 `ledgerQuery` 再请求（打字不刷屏）。 */
  const [ledgerInput, setLedgerInput] = useState("");
  const [ledgerQuery, setLedgerQuery] = useState("");
  const [ledgerBusy, setLedgerBusy] = useState(false);
  const [ledgerError, setLedgerError] = useState<string | null>(null);

  // 2026-09-29（用户）：任何弹窗打开后，背景固定、不可滚动。
  useScrollLock(Boolean(showRecharge || booking || openCase || openConsultant || showSignIn || showInvite || showDict || showActivate || showLedger || showOrders || showDeliv || showLogoutConfirm));

  /** 读签到状态（不写库）；未登录收口到登录页，回来后重开弹层。 */
  async function loadSignin(): Promise<void> {
    setSigninBusy(true);
    setSigninError(null);
    try {
      const res = await fetch(apiPath("/market/signin"), { headers: authHeaders(), cache: "no-store" });
      if (res.status === 401) {
        try { localStorage.setItem("store_os_open_signin_after_login", "1"); } catch { /* ignore */ }
        guestToLogin("/agents");
        return;
      }
      if (!res.ok) {
        setSigninError("签到状态加载失败，请稍后重试");
        return;
      }
      setSigninStatus((await res.json()) as SigninStatusView);
    } catch {
      setSigninError("网络异常，请稍后重试");
    } finally {
      setSigninBusy(false);
    }
  }

  /** 执行签到（幂等）：入账后更新状态与余额。 */
  async function doSignin(): Promise<void> {
    if (!signinStatus || signinStatus.signedToday || signinBusy) return;
    setSigninBusy(true);
    setSigninError(null);
    try {
      const res = await fetch(apiPath("/market/signin"), {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({})
      });
      if (res.status === 401) {
        try { localStorage.setItem("store_os_open_signin_after_login", "1"); } catch { /* ignore */ }
        guestToLogin("/agents");
        return;
      }
      if (!res.ok) {
        setSigninError("签到失败，请稍后重试");
        return;
      }
      const data = (await res.json()) as SigninStatusView & {
        granted: boolean;
        grantedCredits: number;
        wallet: { paid: number; bonus: number };
      };
      setSigninStatus(data);
      setBalance(data.wallet.paid + data.wallet.bonus);
      if (data.granted && data.grantedCredits > 0) meNote(`签到成功 · +${data.grantedCredits} 算力`);
    } catch {
      setSigninError("网络异常，请稍后重试");
    } finally {
      setSigninBusy(false);
    }
  }

  /** 读算力明细（后端 /credits/ledger，带分页 / 分类 / 搜索）；未登录收口到登录页。 */
  async function loadLedger(
    page = ledgerPage,
    category = ledgerCategory,
    keyword = ledgerQuery,
    append = false
  ): Promise<void> {
    setLedgerBusy(true);
    setLedgerError(null);
    try {
      const params = new URLSearchParams({
        page: String(Math.max(1, page)),
        pageSize: String(LEDGER_PAGE_SIZE),
        category
      });
      if (keyword.trim()) params.set("q", keyword.trim());
      const res = await fetch(apiPath(`/credits/ledger?${params.toString()}`), { headers: authHeaders(), cache: "no-store" });
      if (res.status === 401) {
        try { localStorage.setItem("store_os_open_ledger_after_login", "1"); } catch { /* ignore */ }
        guestToLogin("/agents");
        return;
      }
      if (!res.ok) {
        setLedgerError("明细加载失败，请稍后重试");
        return;
      }
      const view = (await res.json()) as LedgerView;
      setLedger(view);
      // 手机端翻页流：下一页 append 到已看列表后面；PC/换页/换分类整页替换。
      setLedgerEntries((prev) => (append ? [...prev, ...view.entries] : view.entries));
      setLedgerPage(Math.max(1, view.page));
    } catch {
      setLedgerError("网络异常，请稍后重试");
    } finally {
      setLedgerBusy(false);
    }
  }

  /** 读一页「被邀请的客户」（打码列表，分页交互同算力明细）。 */
  async function loadInviteePage(page: number, append: boolean): Promise<void> {
    const params = new URLSearchParams({ page: String(Math.max(1, page)), pageSize: String(INVITEE_PAGE_SIZE) });
    const res = await fetch(apiPath(`/market/me/referrals?${params.toString()}`), { headers: authHeaders(), cache: "no-store" });
    if (res.status === 401) {
      try { localStorage.setItem("store_os_open_invite_after_login", "1"); } catch { /* ignore */ }
      guestToLogin("/agents");
      return;
    }
    if (!res.ok) return;
    const view = (await res.json()) as InviteesView;
    setInvitees(view);
    setInviteeItems((prev) => (append ? [...prev, ...view.invitees] : view.invitees));
    setInviteePage(Math.max(1, view.page));
  }

  /** 读「邀请有礼」数据：海报（链接/码/二维码）+ 被邀请客户列表（打码、分页）。 */
  async function loadInvite(): Promise<void> {
    setInviteBusy(true);
    setInviteError(null);
    try {
      const linkRes = await fetch(apiPath("/market/me/referral-link"), { headers: authHeaders(), cache: "no-store" });
      if (linkRes.status === 401) {
        try { localStorage.setItem("store_os_open_invite_after_login", "1"); } catch { /* ignore */ }
        guestToLogin("/agents");
        return;
      }
      if (!linkRes.ok) {
        setInviteError("邀请信息加载失败，请稍后重试");
        return;
      }
      const linkView = (await linkRes.json()) as ReferralLinkView;
      setInviteLink(linkView);
      await loadInviteePage(1, false);
      // 2026-09-30：抽屉里海报/邀请码/链接不能空着——万一账号还没有可回显的自助码，自动签一条。
      if (linkView.state === "none" || !linkView.link) {
        await createInviteLink(false);
      }
    } catch {
      setInviteError("网络异常，请稍后重试");
    } finally {
      setInviteBusy(false);
    }
  }

  /** 生成（或换新）我的邀请链接：明文/二维码已由后端持久化，随时可回显。 */
  async function createInviteLink(regenerate: boolean): Promise<void> {
    setInviteBusy(true);
    setInviteError(null);
    try {
      const res = await fetch(apiPath("/market/me/referral-link"), {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ regenerate })
      });
      if (res.status === 401) {
        try { localStorage.setItem("store_os_open_invite_after_login", "1"); } catch { /* ignore */ }
        guestToLogin("/agents");
        return;
      }
      if (!res.ok) {
        setInviteError("生成邀请链接失败，请稍后重试");
        return;
      }
      setInviteLink((await res.json()) as ReferralLinkView);
    } catch {
      setInviteError("网络异常，请稍后重试");
    } finally {
      setInviteBusy(false);
    }
  }

  function copyInviteText(value: string | null, okMsg: string): void {
    if (!value) return;
    void navigator.clipboard?.writeText(value).then(
      () => meNote(okMsg),
      () => meNote("复制失败，请长按手动选择")
    );
  }

  /* ---- 全部订单：充值 / 商品 / 预约登记合一，分页交互与算力明细一致 ---- */
  async function loadOrderPage(page: number, append: boolean): Promise<void> {
    setOrdersBusy(true);
    try {
      const params = new URLSearchParams({ page: String(Math.max(1, page)), pageSize: String(ORDERS_PAGE_SIZE) });
      const res = await fetch(apiPath(`/market/me/orders?${params.toString()}`), { headers: authHeaders(), cache: "no-store" });
      if (res.status === 401) {
        try { localStorage.setItem("store_os_open_orders_after_login", "1"); } catch { /* ignore */ }
        guestToLogin("/agents");
        return;
      }
      if (!res.ok) return;
      const view = (await res.json()) as OrdersView;
      setOrders(view);
      setOrderItems((prev) => (append ? [...prev, ...view.orders] : view.orders));
      setOrdersPage(Math.max(1, view.page));
    } catch { /* 抽屉里给空态，不额外打扰 */ }
    finally { setOrdersBusy(false); }
  }

  /* ---- 历史交付物（原「我的」页逻辑平移：服务端留 7 天，可导出 Word） ---- */
  async function loadDelivPage(page: number, append: boolean): Promise<void> {
    setDelivBusy(true);
    try {
      const params = new URLSearchParams({ page: String(Math.max(1, page)), pageSize: String(DELIV_PAGE_SIZE) });
      const res = await fetch(apiPath(`/market/me/deliverables?${params.toString()}`), { headers: authHeaders(), cache: "no-store" });
      if (res.status === 401) {
        try { localStorage.setItem("store_os_open_deliv_after_login", "1"); } catch { /* ignore */ }
        guestToLogin("/agents");
        return;
      }
      if (!res.ok) return;
      const view = (await res.json()) as { page: number; total: number; totalPages: number; deliverables: DelivItemView[] };
      setDeliv({ page: view.page, pageSize: DELIV_PAGE_SIZE, total: view.total, totalPages: view.totalPages });
      setDelivItems((prev) => (append ? [...prev, ...view.deliverables] : view.deliverables));
      setDelivPage(Math.max(1, view.page));
    } catch { /* 同上 */ }
    finally { setDelivBusy(false); }
  }

  /** 下载交付物 Word（与 MinePage 同一口径：会话失效/欠费/被拒分开讲人话）。 */
  async function downloadDeliverable(item: { id: string; answer: string; skuName?: string | null }): Promise<void> {
    setDownloadingId(item.id);
    try {
      const response = await fetch(apiPath("/exports/docx"), {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ title: `历史交付物-${item.skuName ?? "AI员工"}`, content: item.answer })
      });
      const data = (await response.json().catch(() => ({}))) as { downloadUrl?: string; message?: string; required?: number; balance?: number };
      if (handleStaleSession(response.status)) {
        window.alert("登录状态已失效，请重新登录后再下载；本次不消耗算力。");
        return;
      }
      if (response.status === 402) {
        window.alert(`算力不足，本次导出需 ${data.required ?? "若干"} 算力（当前余额 ${data.balance ?? 0}），请先充值。`);
        return;
      }
      if (response.status === 415) {
        window.alert("下载请求被服务端拒绝，请刷新页面后重试；本次不消耗算力。");
        return;
      }
      if (!response.ok || !data.downloadUrl) throw new Error(data.message ?? "导出失败，请稍后重试。");
      window.location.assign(apiPath(data.downloadUrl));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "导出失败，请稍后重试。");
    } finally {
      setDownloadingId(null);
    }
  }

  /* ---- 关联应用：逻辑已移入共享组件 AppsDrawer.tsx ---- */

  function fmtInviteDate(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function fmtGiftDate(iso: string | null): string {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  async function activateAccount() {
    try {
      const res = await fetch(apiPath("/market/activate"), {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({})
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        if (res.status === 401) {
          // 未登录：记下「登录后自动重开免费开通弹层」，跳登录；登录成功回跳 /agents 时自动弹出。
          try { localStorage.setItem("store_os_open_activate_after_login", "1"); } catch { /* ignore */ }
          guestToLogin("/agents");
          return;
        }
        console.error("免费开通失败", err);
        return;
      }
      const data = (await res.json()) as {
        activated: boolean;
        gift: { amount: number; expiresAt: string | null; scope: string } | null;
        wallet: { paid: number; bonus: number };
      };
      setActivateGift(data.gift);
      applyActivated(true);
      setActivateStep("success");
      setBalance(data.wallet.paid + data.wallet.bonus);
    } catch (error) {
      console.error("免费开通请求异常", error);
    }
  }

  /* Hero 打字机（原型 heroType：逐字打出 → 停留 → 删除 → 下一句）。 */
  const [typeText, setTypeText] = useState("");
  useEffect(() => {
    let line = 0;
    let char = 0;
    let deleting = false;
    let timer = 0;
    function tick() {
      const current = TYPE_LINES[line];
      if (!deleting) {
        char += 1;
        setTypeText(current.slice(0, char));
        if (char >= current.length) {
          deleting = true;
          timer = window.setTimeout(tick, 1800);
          return;
        }
        timer = window.setTimeout(tick, 70);
      } else {
        char -= 1;
        setTypeText(current.slice(0, char));
        if (char <= 0) {
          deleting = false;
          line = (line + 1) % TYPE_LINES.length;
          timer = window.setTimeout(tick, 400);
          return;
        }
        timer = window.setTimeout(tick, 28);
      }
    }
    timer = window.setTimeout(tick, 500);
    return () => window.clearTimeout(timer);
  }, []);

  /* 背景鼠标光晕（原型 #cursor-glow）。 */
  const glowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    function move(event: MouseEvent) {
      const el = glowRef.current;
      if (!el) return;
      el.style.left = `${event.clientX}px`;
      el.style.top = `${event.clientY}px`;
      el.style.display = "block";
    }
    window.addEventListener("mousemove", move);
    return () => window.removeEventListener("mousemove", move);
  }, []);

  useEffect(() => {
    document.body.classList.add("eco-mall-body");
    document.title = "思潼AI生态商城 · 数字员工 / 数字咨询师";
    return () => {
      document.body.classList.remove("eco-mall-body");
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchMarketMe<{ creditBalance: number; activated?: boolean; gift?: { amount: number; expiresAt: string | null; scope: string } | null; account?: { userId: string; createdAt: string; tenantName: string | null } | null }>()
      .then((data) => {
        if (cancelled) return;
        setBalance(data ? data.creditBalance : null);
        // 拿到服务端明确回答才写缓存；未登录（data 为空）不写，别把游客态写成永久结论。
        if (data) applyActivated(Boolean(data.activated));
        else setMeActivated(false);
        if (data?.gift) setActivateGift(data.gift);
        if (data?.account) setAccountInfo(data.account);
      })
      .catch(() => {
        // 请求失败：按「未开通」渲染（点主按钮会走开通表单，已开通用户服务端会直接回到成功态），
        // 不能让 CTA 永远停在「未知」而空白。
        if (!cancelled) {
          setBalance(null);
          setMeActivated(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /* 「免费开通」弹层：未登录时点了确认开通 → 跳登录，登录回来后自动重开弹层。 */
  useEffect(() => {
    try {
      if (
        localStorage.getItem("store_os_open_activate_after_login") === "1" &&
        localStorage.getItem("store_os_token")
      ) {
        localStorage.removeItem("store_os_open_activate_after_login");
        setActivateStep("form");
        setShowActivate(true);
      }
    } catch { /* ignore */ }
  }, []);

  /* 签到 / 算力明细：未登录时点了 → 跳登录，登录回来后自动重开弹层并拉数据。 */
  useEffect(() => {
    try {
      if (
        localStorage.getItem("store_os_open_signin_after_login") === "1" &&
        localStorage.getItem("store_os_token")
      ) {
        localStorage.removeItem("store_os_open_signin_after_login");
        setShowSignIn(true);
      }
      if (
        localStorage.getItem("store_os_open_ledger_after_login") === "1" &&
        localStorage.getItem("store_os_token")
      ) {
        localStorage.removeItem("store_os_open_ledger_after_login");
        setShowLedger(true);
      }
    } catch { /* ignore */ }
  }, []);

  /* 签到弹层打开即拉状态（登录态也会因 token 变化需要刷新）。 */
  useEffect(() => {
    if (showSignIn) void loadSignin();
  }, [showSignIn]);

  /* 搜索输入 300ms 防抖后才落到请求参数（避免每敲一个字打一次接口）。 */
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLedgerQuery(ledgerInput.trim());
      setLedgerPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [ledgerInput]);

  /* 抽屉打开 / 切分类 / 改关键词 → 整页重拉第 1 页（翻页由按钮/滚动流直接调 loadLedger，不走这里）。 */
  useEffect(() => {
    if (!showLedger) return;
    const timer = window.setTimeout(
      () => void loadLedger(1, ledgerCategory, ledgerQuery, false),
      ledgerQuery ? 280 : 0
    );
    return () => window.clearTimeout(timer);
  }, [showLedger, ledgerCategory, ledgerQuery]);

  /* 打开「邀请有礼」抽屉时拉一次数据（海报 + 客户列表）；重开先清列表避免闪旧数据。 */
  useEffect(() => {
    if (showInvite) {
      setInviteeItems([]);
      void loadInvite();
    }
  }, [showInvite]);

  /* 打开 订单 / 交付物 / 关联应用 抽屉 → 重置到第 1 页整页拉取（翻页由按钮/滚动流直接调 loader）。 */
  useEffect(() => {
    if (showOrders) {
      setOrderItems([]);
      setOpenOrderId(null);
      void loadOrderPage(1, false);
    }
  }, [showOrders]);
  useEffect(() => {
    if (showDeliv) {
      setDelivItems([]);
      void loadDelivPage(1, false);
    }
  }, [showDeliv]);
  /* 关联应用抽屉打开时的数据加载已内聚在 AppsDrawer 组件里 */

  /* 登录回来自动重开抽屉（与签到/明细同一套约定）。 */
  useEffect(() => {
    try {
      const flags: Array<[string, () => void]> = [
        ["store_os_open_orders_after_login", () => setShowOrders(true)],
        ["store_os_open_deliv_after_login", () => setShowDeliv(true)],
        ["store_os_open_apps_after_login", () => setShowApps(true)]
      ];
      for (const [key, open] of flags) {
        if (localStorage.getItem(key) === "1" && localStorage.getItem("store_os_token")) {
          localStorage.removeItem(key);
          open();
        }
      }
    } catch { /* ignore */ }
  }, []);

  /* 货架价目表：/market/skus 的 ppu（算力/次），商品卡和详情弹窗都从这取真实价格。 */
  useEffect(() => {
    let cancelled = false;
    void fetch(apiPath("/market/skus"))
      .then((response) => readJson<{ skus: Array<{ skuCode: string; ppu: number }> }>(response))
      .then((data) => {
        if (!cancelled && data?.skus) {
          setSkuPpu(new Map(data.skus.map((sku) => [sku.skuCode, sku.ppu])));
        }
      })
      .catch(() => {
        if (!cancelled) setSkuPpu(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /* 金刚区点击高亮 + 平滑滚动到楼层；楼层进入视口时同步高亮。 */
  useEffect(() => {
    if (query.trim()) return;
    const floors = Array.from(document.querySelectorAll<HTMLElement>(".eco-floor"));
    if (floors.length === 0) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) setActiveFloor(entry.target.id as FloorId);
      }
    }, { rootMargin: "-40% 0px -55% 0px" });
    floors.forEach((floor) => observer.observe(floor));
    return () => observer.disconnect();
  }, [query]);

  const employeeByKey = useMemo(() => new Map(ECO_EMPLOYEES.map((item) => [item.key, item])), []);

  /** 楼层分组（照原型 v3.28：F1 内容获客 / F2 私域营销）。 */
  const byKey = useMemo(() => {
    const map = new Map(ECO_EMPLOYEES.map((employee) => [employee.key, employee]));
    const pick = (keys: string[]) => keys.map((key) => map.get(key)).filter((x): x is EcoEmployee => Boolean(x));
    return {
      acquireOk: pick(ACQUIRE_OK_KEYS),
      acquireDev: pick(ACQUIRE_DEV_KEYS),
      privateDev: pick(PRIVATE_DEV_KEYS)
    };
  }, []);
  const okEmployees = useMemo(
    () => ECO_EMPLOYEES.filter((employee) => employee.status === "ok"),
    []
  );
  const devEmployees = useMemo(
    () => ECO_EMPLOYEES.filter((employee) => employee.status !== "ok"),
    []
  );
  void okEmployees;
  void devEmployees;
  /* ------------------------------------------------------------------ *
   * 购物车（2026-09-30 用户：照原型 agents.html 的京东式购物车）
   * 结构对齐原型 `.cart-view` / `.cart-item` / `.ci-step` / `.cart-paybar`：
   * 商品行（封面 + 名称 + 单价 + 数量 −/+ + 删除）、底部合计条（算力 ≈ ¥ + 去结算）、空态。
   * 存 localStorage：刷新 / 切标签页回来后购物车还在（原型是内存态，这里做扎实一点）。
   * ------------------------------------------------------------------ */

  /** 一行商品：`unit` 是计价单位（台 / 门 / 份），`ppu` 是单价（算力）。 */
  interface CartLine {
    key: string;
    name: string;
    unit: string;
    ppu: number;
    qty: number;
    img?: string;
    /** cny = 人民币直购（硬件 / 课程），否则按算力计价。 */
    cur?: "cny";
  }

  const [cart, setCart] = useState<CartLine[]>(() => {
    try {
      const raw = localStorage.getItem("eco_mall_cart");
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item): item is CartLine => Boolean(item) && typeof item.key === "string")
          .map((item) => ({ ...item, qty: Math.max(1, Math.trunc(Number(item.qty) || 1)) }));
      }
    } catch { /* 坏数据当空车处理，不要让商城打不开 */ }
    return [];
  });

  function persistCart(next: CartLine[]) {
    setCart(next);
    try { localStorage.setItem("eco_mall_cart", JSON.stringify(next)); } catch { /* 隐私模式忽略 */ }
  }

  /** 加购（同 key 累加数量）。 */
  function addToCart(line: Omit<CartLine, "qty">, qty = 1) {
    const next = cart.map((item) => ({ ...item }));
    const hit = next.findIndex((item) => item.key === line.key);
    if (hit >= 0) next[hit].qty += qty;
    else next.push({ ...line, qty });
    persistCart(next);
    meNote(`🛒 已加入购物车 · ${line.name}`);
  }

  /** 数量 −/+（减到 0 即整行移除，与原型 `data-cdec` 一致）。 */
  function stepCart(key: string, delta: number) {
    const next = cart
      .map((item) => (item.key === key ? { ...item, qty: item.qty + delta } : { ...item }))
      .filter((item) => item.qty > 0);
    persistCart(next);
  }

  function removeCart(key: string) {
    persistCart(cart.filter((item) => item.key !== key));
  }

  function clearCart() {
    persistCart([]);
  }

  const cartCount = cart.reduce((sum, item) => sum + item.qty, 0);
  /** 合计：人民币直购与算力分两条轨（原型 cart-paybar 也是这么分的）。 */
  const cartCompute = cart.filter((item) => item.cur !== "cny").reduce((sum, item) => sum + item.ppu * item.qty, 0);
  const cartCny = cart.filter((item) => item.cur === "cny").reduce((sum, item) => sum + item.ppu * item.qty, 0);

  /* 搜索：职位 / 人名 / 能力介绍 / 交付物全文匹配。 */
  const results = useMemo(() => {
    const keyword = query.trim();
    if (!keyword) return [];
    return ECO_EMPLOYEES.filter((employee) => {
      const persona = employeePersonaLabel(employee.capability);
      const skin = employee.skins["通用"];
      const haystack = [employee.role, persona, employee.hookBase, skin?.hook ?? "", skin?.deliver ?? "", employee.capability].join(" ");
      return haystack.includes(keyword);
    });
  }, [query]);

  const searching = query.trim().length > 0;

  function goCaseNav(nav: EcoCaseNav) {
    if (nav.kind === "floor") {
      goView("home");
      window.setTimeout(() => scrollToFloor(nav.path.replace("#", "") as FloorId), 80);
      return;
    }
    window.location.href = getAppPath(nav.path);
  }

  function scrollToFloor(floor: FloorId) {
    setActiveFloor(floor);
    document.getElementById(floor)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderEmployeeProducts(list: EcoEmployee[], status: "ok" | "dev") {
    return list.map((employee, index) => {
      const skuCode = employeeSkuCode(employee, "通用");
      const ppu = skuCode && skuPpu ? skuPpu.get(skuCode) : undefined;
      return (
        <EmployeeProduct
          key={employee.key}
          employee={employee}
          status={status}
          index={index}
          ppu={ppu}
          onOpen={() => {
            // 点击卡片一律直达商品详情页（2026-09-29 用户要求：不要中间弹窗）
            const path = employeeDetailPath(employee, "通用");
            if (path) window.location.href = getAppPath(path);
          }}
        />
      );
    });
  }

  function renderTodayStrip() {
    return (
      <div className="eco-today-strip">
      <div className="eco-floor-head eh-today-head">
        <span className="eco-floor-no">TODAY</span>
        <h2 className="eh-today-title">今日任务 · 按场景直达</h2>
        <span className="eh-floor-live"><i></i>AI 派单中</span>
      </div>
        <div className="eco-today">
          {TODAY_ITEMS.map((item) => {
            const employee = employeeByKey.get(item.employeeKey);
            return (
              <button
                key={item.employeeKey}
                type="button"
                className="eco-today-item"
                onClick={() => {
                  if (!employee) return;
                  const path = employeeDetailPath(employee, "通用");
                  if (path) window.location.href = getAppPath(path);
                }}
              >
                <span className="eco-today-ico">
                  {employee ? <img src={employeeImagePath(employee)} alt={employeePersonaLabel(employee.capability)} onError={(e) => { e.currentTarget.style.display = "none"; }} /> : null}
                  <b>{employee?.icon}</b>
                </span>
                <span className="eco-today-text">
                  <span className="eco-today-title">{item.title}</span>
                  <strong className="eco-today-hint">{item.hint}</strong>
                </span>
                <span className="eco-today-go" aria-hidden="true">›</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  /**
   * 商品卡（照原型 .pcard：16:9 封面 + 扫描线 + 名称/标签 + 描述 + 价格 + 加购/立即购买）。
   * F4 硬件 / F5 课程 / F6 OPC 都用这一张。
   */
  function renderProductCard(opt: {
    icon: string;
    img?: string;
    glyph?: string;
    tint?: string;
    detail?: string;
    bookingName?: string;
    bookingKey?: string;
    name: string;
    tag: string;
    desc: string;
    price: string;
    cny?: string;
    buyNow?: boolean;
    demo?: boolean;
    /** 加购用的单价 / 单位 / 币种（照原型 data-ppu / data-unit / data-cur）。 */
    cartPpu?: number;
    cartUnit?: string;
    cartCur?: "cny";
  }) {
    /** 该商品能否加购：给了单价就能加（原型里 F4–F6 商品都有加购按钮）。 */
    const canCart = typeof opt.cartPpu === "number";
    const cartLine = () => ({
      key: opt.bookingKey ?? opt.name,
      name: opt.name,
      unit: opt.cartUnit ?? "份",
      ppu: opt.cartPpu ?? 0,
      img: opt.img,
      cur: opt.cartCur
    });
    return (
      <article
        className="eh-pcard"
        style={{ cursor: opt.detail ? "pointer" : undefined }}
        onClick={() => { if (opt.detail) window.location.href = getAppPath(opt.detail); }}
      >
        <div className="eh-pcover">
          {opt.img ? <img className="eh-cimg" src={opt.img} alt={opt.name} /> : null}
          {opt.glyph ? (
            <span className="eh-cover-glyph" style={{ color: opt.tint }}>
              <IconGlyph name={opt.glyph} size={64} />
            </span>
          ) : (
            <span className="eh-pcover-ico">{opt.icon}</span>
          )}
          <span className="eh-scanline" />
        </div>
        <div className="eh-pbody">
          <div className="eh-pname">{opt.name}<span className="eh-ptag">{opt.tag}</span></div>
          <p className="eh-pdesc">{opt.desc}</p>
          <div className="eh-pfoot">
            <span className="eh-pprice">
              {opt.price}
              {opt.cny ? <i className="eh-u-cny">≈ {opt.cny}</i> : null}
            </span>
            <span className="eh-buy-row">
              {/* 加购（原型 .cart-mini）：商品未上线也能先放进购物车，结算走预约登记。 */}
              {canCart ? (
                <button
                  type="button"
                  className="eh-cart-mini"
                  aria-label={`把${opt.name}加入购物车`}
                  onClick={(e) => { e.stopPropagation(); addToCart(cartLine()); }}
                >
                  <IconGlyph name="cart" size={14} style={{ display: "inline", verticalAlign: "-2px" }} /> 加购
                </button>
              ) : null}
              {opt.bookingName ? (
                <button type="button" className="eh-buy-now book" onClick={(e) => { e.stopPropagation(); setBooking({ name: opt.bookingName!, key: opt.bookingKey ?? opt.name }); }}>🔔 预约上线提醒</button>
              ) : opt.buyNow ? (
                <button type="button" className="eh-buy-now" onClick={(e) => { e.stopPropagation(); addToCart(cartLine()); goView("cart"); }}>立即购买</button>
              ) : null}
            </span>
          </div>
          {opt.demo ? <div className="eh-pdemo">演示商品 · 购买不入算力余额</div> : null}
        </div>
      </article>
    );
  }

  /** F7 行业工作台（照原型 .brand-hero：金色渐变大卡 + 可体验徽标）。 */
  function renderBrandFloor() {
    return (
      <section className="eco-floor" id="floor-industry">
        <FloorHead no="F7" title="行业工作台专区" sub="分行业的整套 AI 经营工作台，点进去直接体验" />
        <button
          type="button"
          className="eh-brand-hero"
          onClick={() => setBooking({ name: "行业工作台（美业门店AI经营大脑）", key: "industry-lanqi" })}
        >
          <span className="eh-bh-name"><IconGlyph name="sparkle" size={16} style={{ display: "inline", verticalAlign: "-3px" }} /> 美业门店AI经营大脑 demo <span className="eh-bh-live">● 可体验</span></span>
          <span className="eh-bh-desc">朋友圈 / 社群内容、经营驾驶舱、门店诊断、内容工作室、AI 绘图、公域获客——美业门店（美容 / 美甲 / 轻医美）正在用的完整 AI 工作台，进去就能点。</span>
          <span className="eh-bh-go">🔔 预约上线提醒</span>
        </button>
      </section>
    );
  }

  // AI 案例视图：只算一次，页头计数与列表共用同一份结果
  const caseList = ECO_CASES.filter((c) => caseCat === "all" || c.cat === caseCat);

  return (
    <main className="app-wrap eco-mall-page eco-light eh">
      <div className="eh-bg-grid" aria-hidden="true" />
      <div className="eh-orb eh-orb-1" aria-hidden="true" />
      <div className="eh-orb eh-orb-2" aria-hidden="true" />
      <div className="eh-glow" ref={glowRef} aria-hidden="true" />
      <MallTopbar onRecharge={() => setShowRecharge(true)} />

      {view === "cases" ? (
        <section className="eh-cases-view">
          <header className="eh-ph">
            <div className="eh-ph-in">
              <div className="eh-ph-top">
                <span className="eh-ph-ico"><IconGlyph name="book" size={17} /></span>
                <div className="eh-ph-tt">
                  <div className="eh-ph-t">AI 案例</div>
                  <p className="eh-ph-d">看别人怎么用 AI 降本增效 · 演示数据虚构</p>
                </div>
                <div className="eh-ph-stat"><b>{caseList.length}</b><span>个案例</span></div>
              </div>
              <div className="eh-ph-tabs">
                {ECO_CASE_CATS.map((cat) => (
                  <button key={cat.key} type="button" className={`eh-ph-tab ${caseCat === cat.key ? "on" : ""}`} onClick={() => setCaseCat(cat.key)}>{cat.label}</button>
                ))}
              </div>
            </div>
          </header>
          <div className="eh-cv-wrap">
            {caseList.map((c) => (
              <article key={c.title} className="eh-case-card" onClick={() => setOpenCase(c)}>
                <div className="eh-case-cover">
                  <img className="eh-cimg" src={getPublicAssetPath(c.cover)} alt={c.title} />
                  <span className="eh-cover-glyph eh-cover-glyph-lg" style={{ color: c.tint }}><IconGlyph name={c.glyph} size={56} /></span>
                  <span className="eh-case-tag">{c.tag}</span>
                  <span className="eh-case-gain"><b>{c.gain}</b><span>{c.gainSub}</span></span>
                </div>
                <div className="eh-case-body">
                  <div className="eh-case-title">{c.title}</div>
                  <div className="eh-case-sub">{c.sub}</div>
                  <div className="eh-case-metrics">
                    {c.metrics.slice(0, 3).map((m) => (
                      <div key={m[0]} className="eh-case-metric"><span className="k">{m[0]}</span><div className="v">{m[1]}</div></div>
                    ))}
                  </div>
                  <div className="eh-case-inspire">💡 <b>给你的启发：</b>{c.inspire}</div>
                  <div className="eh-case-cta">
                    <button type="button" className="eh-case-use" onClick={(e) => { e.stopPropagation(); goCaseNav(c.nav); }}><IconGlyph name="bolt" size={13} style={{ display: "inline", verticalAlign: "-2px" }} /> 用同款 · {c.refName}</button>
                    <button type="button" className="eh-case-more" onClick={(e) => { e.stopPropagation(); setOpenCase(c); }}>看完整做法 ›</button>
                  </div>
                </div>
              </article>
            ))}
            {caseList.length === 0 ? (
              <div className="eh-cv-empty">该分类暂无案例 · 演示数据陆续补充</div>
            ) : null}
          </div>
        </section>
      ) : view === "cart" ? (
        /* ---------- 购物车（照原型 .cart-view：标题 + 商品行 + 固定合计条） ---------- */
        <section className="eh-cases-view cart-view">
          <header className="eh-ph">
            <div className="eh-ph-in">
              <div className="eh-ph-top">
                <span className="eh-ph-ico"><IconGlyph name="cart" size={17} /></span>
                <div className="eh-ph-tt">
                  <div className="eh-ph-t">购物车</div>
                  <p className="eh-ph-d">上线预约期商品 · 结算登记后客服按清单跟进</p>
                </div>
                {cartCount > 0 ? <div className="eh-ph-stat"><b>{cartCount}</b><span>件商品</span></div> : null}
              </div>
              <div className="eh-ph-meta">
                <span>购物车自动保留</span>
                <i />
                <span>结算不扣算力</span>
              </div>
            </div>
          </header>

          {cart.length === 0 ? (
            <div className="cart-empty">
              <span className="ce-ico"><IconGlyph name="cart" size={22} /></span>
              <b>购物车还是空的</b>
              <p>去商城把需要的智能体 / 商品加进来，这里会帮你算好总价。</p>
              <button type="button" className="cart-empty-go" onClick={() => goView("home")}>
                去商城逛逛 ›
              </button>
            </div>
          ) : (
            <>
              <div className="cart-wrap">
                {cart.map((line) => (
                  <div className="cart-item" key={line.key}>
                    {line.img ? (
                      <img className="ci-ava" src={line.img} alt="" />
                    ) : (
                      <span className="ci-ava ci-ava-ph" aria-hidden="true">{line.name.slice(0, 1)}</span>
                    )}
                    <div className="ci-main">
                      <b>{line.name}</b>
                      <span>
                        {line.cur === "cny"
                          ? `¥${line.ppu} /${line.unit}`
                          : `${line.ppu} 算力 /${line.unit} · ≈ ¥${(line.ppu / 10).toFixed(line.ppu % 10 === 0 ? 0 : 1)}`}
                      </span>
                      <em className="ci-unit">数量按{line.unit}计</em>
                    </div>
                    <div className="ci-step">
                      <button type="button" aria-label="减少数量" onClick={() => stepCart(line.key, -1)}>−</button>
                      <b>{line.qty}</b>
                      <button type="button" aria-label="增加数量" onClick={() => stepCart(line.key, 1)}>+</button>
                    </div>
                    <button type="button" className="ci-del" aria-label={`删除${line.name}`} onClick={() => removeCart(line.key)}>删除</button>
                  </div>
                ))}
                <div className="cart-tools">
                  <button type="button" onClick={clearCart}>清空购物车</button>
                  <button type="button" onClick={() => goView("home")}>继续逛 ›</button>
                </div>
              </div>

              <div className="cart-paybar">
                <span className="cart-total">
                  {cartCompute > 0 ? (
                    <>合计 <b>{fmtCredits(cartCompute)}</b> 算力<i className="ct-cny">≈ ¥{(cartCompute / 10).toFixed(cartCompute % 10 === 0 ? 0 : 1)}</i></>
                  ) : null}
                  {cartCny > 0 ? (
                    <i className="ct-cny">{cartCompute > 0 ? " + " : ""}¥{cartCny} 直购</i>
                  ) : null}
                </span>
                <button
                  type="button"
                  className="cart-checkout"
                  onClick={() => {
                    // 结算：商品都在「上线预约期」，所以结算不是扣费，而是把清单登记下来（真实留资，
                    // POST /market/bookings → 后台「商品预约」可查）。清单进 productName，客服照着跟进。
                    const names = cart.map((line) => `${line.name}×${line.qty}`).join("、");
                    setBooking({
                      name: `购物车结算 · ${cartCount} 件（${names}）`,
                      key: `cart-${cartCount}`
                    });
                  }}
                >
                  去结算
                </button>
              </div>
            </>
          )}
        </section>
      ) : view === "mine" ? (
        <section className="eh-cases-view">
          <header className="eh-ph">
            <div className="eh-ph-in">
              <div className="eh-ph-top">
                <span className="eh-ph-ico"><IconGlyph name="user" size={17} /></span>
                <div className="eh-ph-tt">
                  <div className="eh-ph-t">我的</div>
                  <p className="eh-ph-d">订单 · 算力 · 权益，都在这一页</p>
                </div>
              </div>
              <div className="eh-ph-meta">
                <span>智能体订单可点进工作台</span>
                <i />
                <span>结算不扣算力</span>
              </div>
            </div>
          </header>
          <div className="me-inner">
            <div className="me-profile">
              <div className="me-pf-top">
                <span className="me-ava"><IconGlyph name="user" size={22} /></span>
                <div className="me-id">
                  <b>{accountInfo?.tenantName || localAccountName || "我的账号"}</b>
                  <span>
                    {accountInfo ? `注册于 ${fmtInviteDate(accountInfo.createdAt)}` : "已登录"}
                  </span>
                </div>
              </div>
              <div className="me-pf-bal">
                <span className="mpb-k">算力余额</span>
                <b className="mpb-v">{fmtCredits(balance)}</b>
                <i className="mpb-cny">≈ ¥{balance != null ? (balance / 10).toFixed(balance % 10 === 0 ? 0 : 1) : "0"}</i>
                <button className="mini-btn" type="button" onClick={() => setShowRecharge(true)}>充值</button>
              </div>
            </div>
            <button type="button" className="me-sec-head me-sec-link" onClick={() => { setShowOrders(true); }}>
              <b>全部订单</b>
              <span>充值 · 商品 · 预约 · 查看详情 ›</span>
            </button>
            <div className="me-list">
              <button type="button" className="me-item" onClick={() => setShowDict(true)}>
                <span className="mi-ico"><IconGlyph name="help" size={15} /></span>
                <span className="mi-txt">新手帮助 · 术语词典<small>算力 · 计费 · 访谈，一看就懂</small></span>
                <span className="mi-go">›</span>
              </button>
              <button type="button" className="me-item" onClick={() => setShowSignIn(true)}>
                <span className="mi-ico"><IconGlyph name="calendar" size={15} /></span>
                <span className="mi-txt">每日签到<small>每日 +5 · 第 7 天 +30 · 周封顶 60</small></span>
                <span className="mi-go">›</span>
              </button>
              <button type="button" className="me-item" onClick={() => setShowInvite(true)}>
                <span className="mi-ico"><IconGlyph name="gift" size={15} /></span>
                <span className="mi-txt">邀请有礼<small>好友开通你就有奖</small></span>
                <span className="mi-go">›</span>
              </button>
              <button type="button" className="me-item" onClick={() => { setLedgerPage(1); setShowLedger(true); }}>
                <span className="mi-ico"><IconGlyph name="clipboard" size={15} /></span>
                <span className="mi-txt">算力明细<small>充值 · 赠送 · 消耗逐笔可查</small></span>
                <span className="mi-go">›</span>
              </button>
              <button type="button" className="me-item" onClick={() => setShowDeliv(true)}>
                <span className="mi-ico"><IconGlyph name="book" size={15} /></span>
                <span className="mi-txt">历史交付物<small>服务端保留 7 天 · 随时导出 Word</small></span>
                <span className="mi-go">›</span>
              </button>
              <button type="button" className="me-item" onClick={() => setShowApps(true)}>
                <span className="mi-ico"><IconGlyph name="shield" size={15} /></span>
                <span className="mi-txt">关联应用<small>得到大脑 · 私有知识源接入</small></span>
                <span className="mi-go">›</span>
              </button>
              <button type="button" className="me-item" onClick={() => setShowLogoutConfirm(true)}>
                <span className="mi-ico"><IconGlyph name="logout" size={15} /></span>
                <span className="mi-txt">退出登录<small>体验注册登录流程</small></span>
                <span className="mi-go">›</span>
              </button>
            </div>
          </div>
        </section>
      ) : (
      <section className="eco-mall">
        {/* Hero AI 指挥横幅（原型 v3.28：橙色渐变 + 波形 + 打字机 + 流光边） */}
        <section className="eh-hero">
          <div className="eh-hero-row">
            <button type="button" className="eh-hero-ava" title="点我和 AI 管家小潼聊聊" onClick={() => setShowDict(true)}><IconGlyph name="robot" size={26} /></button>
            <div className="eh-hero-main">
              <div className="eh-hero-tag">
                <span className="eh-wave"><i></i><i></i><i></i><i></i><i></i></span>
                AI 值班中 · 点左边头像，随时问小潼
              </div>
              <h1 className="eh-hero-title">你好，我是 AI 管家<em>小潼</em></h1>
              <div className="eh-hero-type">{typeText}<span className="eh-caret"></span></div>
              <div className="eh-hero-slogan">⭐ AI 商城 · 智能体 / 数字员工 / AI硬件 / AI课程，一站配齐</div>
            </div>
          </div>
          <div className="eh-hero-cta">
            {/*
              主 CTA（2026-09-30 重做交互）：
              - 文案不再「先免费开通、再闪变」：已登录且还没拿到真实态时留空占位（.is-pending），
                拿到后淡入；有本地缓存的老用户首帧就是对的。
              - 已开通 → 「开始今日任务」：平滑滚到今日任务卡（原型 startTodayBtn 的落点），
                不再弹一个「100 算力已到账」的冗余弹层。
              - 未开通 → 开通表单；成功后再引导「去用第一个智能体」。
            */}
            <button
              type="button"
              className={"eh-big" + (ctaReady ? "" : " is-pending")}
              aria-hidden={ctaReady ? undefined : true}
              onClick={() => {
                if (meActivated) {
                  document.querySelector(".eco-today-strip")?.scrollIntoView({ behavior: "smooth", block: "center" });
                  return;
                }
                setActivateStep("form");
                setShowActivate(true);
              }}
            >
              <IconGlyph name="gift" size={16} style={{ display: "inline", verticalAlign: "-3px" }} />
              {meActivated ? "开始今日任务" : "免费开通 · 立送 100 算力"}
            </button>
            <button type="button" className="eh-ghost" onClick={() => setShowDict(true)}><IconGlyph name="help" size={15} style={{ display: "inline", verticalAlign: "-2px" }} /> 新手帮助</button>
          </div>
          <div className="eh-hero-note"><IconGlyph name="bolt" size={11} style={{ display: "inline", verticalAlign: "-1px" }} /> 计费口径：1 元 = 10 算力 · 0 元开通 · 用后扣费 · 失败不扣</div>
        </section>

        <div className="eco-searchbar">
          <div className="eco-search">
            <svg className="eco-search-ico" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <path d="M20 20l-4.2-4.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜商品：文案 / 直播 / 复盘 / 课程…"
              aria-label="搜索商城商品"
            />
            {searching ? (
              <button type="button" className="eco-search-clear" onClick={() => setQuery("")} aria-label="清空搜索">×</button>
            ) : null}
          </div>
          <div className="eh-search-hint">不知道找谁？直接说事：<b>「今天要发内容」</b>，小潼帮你派单</div>
        </div>

        {searching ? (
          <div className="eco-results">
            <div className="eco-results-head">
              <span>“{query.trim()}” 的搜索结果 · <b>{results.length}</b> 个商品</span>
              <button type="button" onClick={() => setQuery("")}>清空</button>
            </div>
            {results.length > 0 ? (
              <div className="eco-products">
                {results.map((employee, index) => {
                  const ok = employee.status === "ok";
                  const skuCode = employeeSkuCode(employee, "通用");
                  const ppu = skuCode && skuPpu ? skuPpu.get(skuCode) : undefined;
                  return (
                    <EmployeeProduct
                      key={employee.key}
                      employee={employee}
                      status={ok ? "ok" : "dev"}
                      index={index}
                      ppu={ppu}
                      onOpen={() => {
                        const path = employeeDetailPath(employee, "通用");
                        if (path) window.location.href = getAppPath(path);
                      }}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="eco-empty">
                没有找到相关商品，换个关键词试试，比如「文案」「定位」「复盘」。
              </div>
            )}
          </div>
        ) : (
          <>
            {/* 广告位（原型 .ad-banner：带边框的外框 + 内部橙条） */}
            <div className="eh-ad">
              <button type="button" className="eco-banner eco-invite-banner" onClick={() => setShowInvite(true)}>
                <div className="eco-banner-text">
                  <b><IconGlyph name="gift" size={16} style={{ display: "inline", verticalAlign: "-3px" }} /> 邀请有礼</b>
                  <span>好友开通 · 各得 100 算力</span>
                </div>
                <span className="eco-banner-link">立即邀请 ›</span>
              </button>
            </div>

            <nav className="eco-kingkong" aria-label="商城楼层导航">
              {KINGKONG.map((item) => (
                <button
                  key={item.floor}
                  type="button"
                  className={`eco-kk-item ${activeFloor === item.floor ? "active" : ""}`}
                  style={{ "--kk-tint": item.tint } as CSSProperties}
                  onClick={() => scrollToFloor(item.floor)}
                >
                  <span className="eco-kk-ico" style={{ "--kk-deep": item.deep } as CSSProperties}><IconGlyph name={item.glyph} /></span>
                  <span className="eco-kk-label">{item.label}</span>
                </button>
              ))}
            </nav>

            {renderTodayStrip()}

            <section className="eco-floor" id="floor-acquire">
              <FloorHead no="F1" title="内容获客专区" sub="做内容引流的智能体都在这" live={`${byKey.acquireOk.length} 位在线`} />
              <div className="eco-products">
                {renderEmployeeProducts(byKey.acquireOk, "ok")}
              </div>
              {byKey.acquireDev.length > 0 ? (
                <>
                  <div className="eco-divider"><span>即将上线</span></div>
                  <div className="eco-products">
                    {renderEmployeeProducts(byKey.acquireDev, "dev")}
                  </div>
                </>
              ) : null}
            </section>

            <section className="eco-floor" id="floor-private">
              <FloorHead no="F2" title="私域营销专区" sub="客户成交 / 私域内容，跟着转化走。" live={`${byKey.privateDev.filter((x) => x.status === "ok").length} 位在线`} />
              <div className="eco-products">
                {renderEmployeeProducts(byKey.privateDev, "dev")}
              </div>
            </section>

            <section className="eco-floor" id="floor-consultants">
              <FloorHead no="F3" title="数字咨询师专区" sub="把真人的方法论装进数字分身" />
              <div className="eh-cons">
                <article className="eh-cons-card">
                  <span className="eh-scanline" />
                  <span className="eh-cons-ava-wrap">
                    <span className="eh-ring r1" /><span className="eh-ring r2" />
                    <span className="eh-cons-ava">
                      <img src={getPublicAssetPath("/mall/palu.jpg")} alt="保禄数字分身" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                      <b>🧭</b>
                    </span>
                    <i className="eh-cons-dot dev" />
                  </span>
                  <span className="eh-cons-main">
                    <span className="eh-cons-name">保禄数字分身</span>
                    <span className="eh-cons-face">思潼AI 创始人</span>
                    <span className="eh-cons-meta">我是保禄的数字分身，他的 AI 增长和连锁经营方法论都装进来了。你有具体问题，我按保禄的思路接着答。</span>
                    <span className="eh-cons-soon">🔐 真人授权训练中 · 即将上线</span>
                    <span className="eh-buy-row">
                      <button type="button" className="eh-buy-now book" onClick={() => setBooking({ name: "保禄数字分身", key: "baolu-consultant" })}>🔔 预约上线提醒</button>
                    </span>
                  </span>
                </article>
              </div>
            </section>

            <section className="eco-floor" id="floor-hardware">
              <FloorHead no="F4" title="AI 硬件专区" sub="让 AI 落到店里的硬件货架" />
              <div className="eh-prod">
                {renderProductCard({ glyph: "mic", tint: "#FF7A1A", icon: "🎙️", img: getPublicAssetPath("/mall/hwRec.jpg"), detail: "/product/hwRec/detail", name: "AI 录音卡", tag: "硬件新品", desc: "录音即分析，自动转经营动作：客户沟通自动归档、话术要点自动提炼。", price: "¥199 /台 · 人民币直购", bookingName: "AI 录音卡", bookingKey: "hwRec"})}
                {renderProductCard({ glyph: "robot", tint: "#0E9F6E", icon: "robot", img: getPublicAssetPath("/mall/hwRobot.jpg"), detail: "/product/hwRobot/detail", name: "门店 AI 机器人", tag: "硬件新品", desc: "迎宾接待、导购问答，常用话术语音随叫随到，前台接待不冷场。", price: "¥1,999 /台 · 人民币直购", bookingName: "门店 AI 机器人", bookingKey: "hwRobot"})}
              </div>
            </section>

            <section className="eco-floor" id="floor-courses">
              <FloorHead no="F5" title="AI 课程专区" sub="从 0 到 1 学会用 AI 干活" />
              <div className="eh-prod">
                {renderProductCard({ glyph: "sparkcap", tint: "#9752DC", icon: "🎓", img: getPublicAssetPath("/mall/courseAgent.jpg"), detail: "/product/courseAgent/detail", name: "智能体开发课", tag: "视频课", desc: "从 0 到 1 学会搭建自己的智能体工作流。", price: "¥199 /门 · 人民币直购", bookingName: "智能体开发课", bookingKey: "courseAgent"})}
                {renderProductCard({ glyph: "chart", tint: "#2E7CF6", icon: "📊", img: getPublicAssetPath("/mall/courseWb.jpg"), detail: "/product/courseWb/detail", name: "WorkBuddy 办公提效课", tag: "实操课", desc: "用 AI 把日报、周报、方案、表格这些日常活干得更快，即学即用。", price: "¥99 /门 · 人民币直购", bookingName: "WorkBuddy 办公提效课", bookingKey: "courseWb"})}
              </div>
            </section>

            <section className="eco-floor" id="floor-opc">
              <FloorHead no="F6" title="OPC 专区" sub="AI 算力与创作资源，商家价直供" />
              <div className="eh-prod">
                {renderProductCard({ glyph: "pack", tint: "#D96A00", icon: "🏭", img: getPublicAssetPath("/mall/opcLlm.jpg"), detail: "/product/opcLlm/detail", name: "大模型折扣仓", tag: "OPC", desc: "主流大模型 API 额度折扣直充，token 按仓价拿，AI 用量大的商家先省一半。", price: "50 算力/份 起", cny: "¥5", buyNow: true, demo: true, bookingName: "大模型折扣仓", bookingKey: "opcLlm"})}
                {renderProductCard({ glyph: "clapper", tint: "#DB2777", icon: "🎬", img: getPublicAssetPath("/mall/opcComic.jpg"), detail: "/product/opcComic/detail", name: "AIGC 漫剧创作工作台", tag: "OPC", desc: "分镜、角色、成片一条龙，批量产出漫剧短视频，带货与账号起号都能用。", price: "199 算力/席", cny: "¥19.9", buyNow: true, demo: true, bookingName: "AIGC 漫剧创作工作台", bookingKey: "opcComic"})}
              </div>
            </section>

            {renderBrandFloor()}

          </>
        )}
      </section>
      )}

      {/* 底部 TabBar（手机）/ 左侧导航（桌面 ≥960px，照原型 v3.28） */}
      <nav className="eh-tabbar" aria-label="商城导航">
        <div className="eh-nav-brand">
          <span className="eh-logo"><b>思潼</b><em>AI</em>商城</span>
        </div>
        <button type="button" className={`eh-tab ${view === "home" ? "act" : ""}`} onClick={() => goView("home")}>
          <i><IconGlyph name="home" size={19} /></i><span>首页</span>
        </button>
        <button type="button" className={`eh-tab ${view === "cases" ? "act" : ""}`} onClick={() => goView("cases")}>
          <i><IconGlyph name="book" size={19} /></i><span>AI案例</span>
        </button>
        <button
          type="button"
          className={`eh-tab ${view === "cart" ? "act" : ""}`}
          onClick={() => goView("cart")}
        >
          <i><IconGlyph name="cart" size={19} />{cartCount > 0 ? <b className="eh-tab-badge">{cartCount}</b> : null}</i><span>购物车</span>
        </button>
        <button type="button" className={`eh-tab ${view === "mine" ? "act" : ""}`} onClick={() => goView("mine")}>
          <i><IconGlyph name="user" size={19} /></i><span>我的</span>
        </button>
        <button type="button" className="eh-tab eh-tab-bal" onClick={() => setShowRecharge(true)}>
          <i><IconGlyph name="bolt" size={19} /></i><span>我的算力</span>
        </button>
        <div className="eh-nav-bal">
          <span className="t"><IconGlyph name="bolt" size={12} style={{ display: "inline", verticalAlign: "-2px" }} /> 我的算力</span>
          <span className="v">{fmtCredits(balance)}</span>
          <i>{balance != null ? `≈ ¥${(balance / 10).toFixed(balance % 10 === 0 ? 0 : 1)}` : ""}</i>
          <button type="button" className="eh-mini" onClick={() => setShowRecharge(true)}>充值</button>
        </div>
      </nav>
      {meToast ? <div className="me-toast">{meToast}</div> : null}

      <RechargeDrawer
        open={showRecharge}
        onClose={() => setShowRecharge(false)}
        onPaid={() => {
          void fetchMarketMe<{ creditBalance: number; activated?: boolean; gift?: { amount: number; expiresAt: string | null; scope: string } | null }>()
            .then((d) => {
              if (d) {
                setBalance(d.creditBalance);
                applyActivated(Boolean(d.activated));
                if (d.gift) setActivateGift(d.gift);
              }
            })
            .catch(() => setBalance(null));
          // 2026-09-30 用户：支付到账后，开着 的「算力明细」必须立刻重拉——
          // 否则抽屉顶部还是支付前的「实付余额 0」，新充值那一笔也不出现（假象：钱没到）。
          if (showLedger) void loadLedger(ledgerPage, ledgerCategory, ledgerQuery);
        }}
      />
      {booking ? (
        <BookingModal open productName={booking.name} productKey={booking.key} onClose={() => setBooking(null)} />
      ) : null}

      {openCase ? (
        <div className="eh-cd-mask" onClick={() => setOpenCase(null)}>
          <div className="eh-cd-sheet" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="eh-rd-x eh-cd-x" onClick={() => setOpenCase(null)}>✕</button>
            <div className="eh-cd-head">
              <img src={getPublicAssetPath(openCase.cover)} alt={openCase.title} />
              <div className="eh-cd-headtxt">
                <b>{openCase.title}</b>
                <div className="eh-cd-chips">
                  <span>{openCase.tag}</span>
                  <span>投入 {openCase.cost}</span>
                  {openCase.cycle ? <span>{openCase.cycle}</span> : null}
                </div>
              </div>
            </div>
            <div className="eh-cd-sec"><h4>😖 改造前 · 卡在哪</h4><p>{openCase.before}</p></div>
            <div className="eh-cd-sec">
              <h4>🛠 怎么做的 · {openCase.steps.length} 步</h4>
              {openCase.steps.map((st, j) => <div key={j} className="eh-cd-step"><i>{j + 1}</i><span>{st}</span></div>)}
            </div>
            <div className="eh-cd-cost">
              <div><span>投入</span><b>{openCase.cost}</b></div>
              <div><span>上线周期</span><b>{openCase.cycle || "—"}</b></div>
            </div>
            <div className="eh-cd-sec">
              <h4>📈 拿到什么结果</h4>
              {openCase.metrics.map((m) => (
                <div key={m[0]} className="eh-cd-metric"><span>{m[0]}</span><div><b>{m[1]}</b><em>{m[2] || ""}</em></div></div>
              ))}
            </div>
            <div className="eh-cd-sec"><h4>💡 给你的启发</h4><p>{openCase.inspire}</p></div>
            <button type="button" className="btn-orange eh-cd-use" onClick={() => { const nav = openCase.nav; setOpenCase(null); goCaseNav(nav); }}>
              <IconGlyph name="bolt" size={14} style={{ display: "inline", verticalAlign: "-2px" }} /> 用同款 · {openCase.refName}先逛逛
            </button>
          </div>
        </div>
      ) : null}

      {showSignIn ? (
        <div className="eco-modal-mask" onClick={() => setShowSignIn(false)}>
          <div className="eco-modal eco-signin" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="eco-modal-x" onClick={() => setShowSignIn(false)}>✕</button>
            <h3>📅 每日签到</h3>
            <p className="eco-modal-sub">每日 +5 · 第 7 天 +30 · 每周封顶 {signinStatus?.weeklyCap ?? 60} · 断签重置</p>
            <div className="eco-signin-grid">
              {(signinStatus?.days ?? []).map((d) => (
                <div
                  key={d.day}
                  className={
                    "eco-signin-day" +
                    (d.signed ? " is-signed" : "") +
                    (d.current ? " is-current" : "")
                  }
                >
                  <span className="sd-label">{d.label}</span>
                  <span className="sd-credits">+{d.credits}</span>
                  {/* 口径统一（2026-09-30 用户）：格子是「周期落点」不是日历——
                      今天已签时，下一次签到落在明天，所以 current 格标「明天」，不再标「今天」
                      造成「按钮说已签、格子还像能签」的矛盾。 */}
                  <span className="sd-state">
                    {d.signed ? "✓ 已签" : d.current ? (signinStatus?.signedToday ? "明天" : "今天") : ""}
                  </span>
                </div>
              ))}
            </div>
            <div className="eco-signin-progress">
              本周已领 <b>{signinStatus?.earnedInCycle ?? 0}</b> / {signinStatus?.weeklyCap ?? 60}
              <span className="sep">·</span>连续 <b>{signinStatus?.streak ?? 0}</b> 天
              <span className="sep">·</span>累计 <b>{signinStatus?.totalSignedDays ?? 0}</b> 天
            </div>
            <button
              type="button"
              className="eco-modal-btn"
              disabled={signinBusy || Boolean(signinStatus?.signedToday)}
              onClick={() => void doSignin()}
            >
              {signinBusy
                ? "签到中…"
                : signinStatus?.signedToday
                ? "今天已签到 ✓"
                : `立即签到 · +${signinStatus?.nextCredits ?? 5} 算力`}
            </button>
            {signinError ? <p className="eco-modal-tip eco-err">{signinError}</p> : null}
            <p className="eco-modal-tip">
              签到所得为赠送算力 · {signinStatus?.validDays ?? 90} 天有效 · 限思潼自营文字类智能体
            </p>
          </div>
        </div>
      ) : null}

      {showLedger ? (
        <div className="eh-rd-overlay" onClick={() => setShowLedger(false)}>
          <aside
            className="eh-rd-panel"
            role="dialog"
            aria-modal="true"
            aria-label="算力明细"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="eh-rd-head">
              <b>⚡ 算力明细</b>
              <span style={{ flex: 1 }} />
              <button type="button" className="eh-rd-x" onClick={() => setShowLedger(false)} aria-label="关闭">✕</button>
            </div>
            <div className="eh-rd-body eh-led-body">
              <div className="eh-rd-balance">
                <div>
                  <div style={{ fontSize: 11, color: "#94796B" }}>实付余额</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "#E86A00" }}>⚡ {fmtCredits(ledger?.wallet.paidBalance ?? 0)}</div>
                  <div style={{ fontSize: 11, color: "#BEA488" }}>
                    赠送可用 {fmtCredits(ledger?.usableBonus ?? 0)}
                    {ledger && ledger.expiredBonus > 0 ? ` · 已过期 ${fmtCredits(ledger.expiredBonus)}` : ""}
                  </div>
                </div>
                <span className="eh-rd-tag">与余额同源</span>
              </div>

              <div className="eh-led-search">
                <input
                  type="search"
                  value={ledgerInput}
                  onChange={(event) => setLedgerInput(event.target.value)}
                  placeholder="搜：签到 / 充值 / 开通礼…"
                  aria-label="搜索算力明细"
                />
              </div>

              <div className="eh-led-tabs">
                {(ledger?.categories ?? LEDGER_CATEGORIES).map((c) => {
                  const key = c.key;
                  const n = (c as { count?: number }).count ?? 0;
                  return (
                    <button
                      key={key}
                      type="button"
                      className={"eh-led-tab" + (ledgerCategory === key ? " on" : "")}
                      onClick={() => { setLedgerCategory(key); setLedgerPage(1); }}
                    >
                      {c.label}{n > 0 ? <i className="eh-led-tab-n">{n}</i> : null}
                    </button>
                  );
                })}
              </div>

              {ledgerBusy && ledgerEntries.length === 0 ? (
                <div className="eh-rd-loading">加载中…</div>
              ) : ledgerError ? (
                <div className="eh-rd-loading eco-err">{ledgerError}</div>
              ) : ledgerEntries.length === 0 ? (
                <div className="eh-led-empty">暂无明细 · 开通或充值后这里会自动记录</div>
              ) : (
                <ul className="eh-led-list">
                  {ledgerEntries.map((e) => (
                    <li key={e.id} className={"eh-led-row dir-" + e.direction}>
                      <div className="lr-main">
                        <span className="lr-label">{e.label}</span>
                        <span className="lr-detail">{e.detail}</span>
                      </div>
                      <div className="lr-right">
                        <span className={"lr-amount " + (e.direction === "out" ? "out" : "in")}>
                          {e.direction === "out" ? "-" : e.direction === "flat" ? "" : "+"}
                          {fmtCredits(e.amount)}
                        </span>
                        <span className="lr-time">
                          {new Date(e.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                          {e.bucket === "bonus" ? " · 赠" : ""}
                          {e.expired ? " · 已过期" : ""}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <DrawerPager
                isMobile={isMobile}
                page={ledgerPage}
                totalPages={ledger?.totalPages ?? 1}
                total={ledger?.total ?? 0}
                unit="笔"
                busy={ledgerBusy}
                onPrev={() => void loadLedger(ledgerPage - 1, ledgerCategory, ledgerQuery, false)}
                onNext={() => void loadLedger(ledgerPage + 1, ledgerCategory, ledgerQuery, false)}
                onLoadMore={() => void loadLedger(ledgerPage + 1, ledgerCategory, ledgerQuery, true)}
              />
            </div>
          </aside>
        </div>
      ) : null}

      {showInvite ? (
        <div className="eh-rd-overlay" onClick={() => setShowInvite(false)}>
          <aside
            className="eh-rd-panel"
            role="dialog"
            aria-modal="true"
            aria-label="邀请有礼"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="eh-rd-head">
              <b><IconGlyph name="gift" size={16} style={{ display: "inline", verticalAlign: "-3px" }} /> 邀请有礼</b>
              <span style={{ flex: 1 }} />
              <button type="button" className="eh-rd-x" onClick={() => setShowInvite(false)} aria-label="关闭">✕</button>
            </div>
            <div className="eh-rd-body eh-inv-body">
              {inviteBusy && !inviteLink ? (
                <div className="eh-rd-loading">正在生成专属海报…</div>
              ) : inviteError && !inviteLink ? (
                <div className="eh-rd-loading eco-err">{inviteError}</div>
              ) : (
                <>
                  {/* ---------- 可下载海报（Canvas 位图，3 版本切换，2026-09-30） ---------- */}
                  <InvitePoster
                    data={{
                      link: inviteLink?.link ?? null,
                      qrSvg: inviteLink?.qrSvg ?? null,
                      code: inviteLink?.code ?? inviteLink?.codePreview ?? null,
                      campaignActive: inviteLink?.campaignActive !== false,
                      busy: inviteBusy
                    }}
                  />

                  {/* ---------- 邀请码 / 链接 ---------- */}
                  <div className="eh-inv-rows">
                    <div className="eh-inv-fld">
                      <span className="eh-inv-fld-l">邀请码</span>
                      <code className="eh-inv-fld-v">{inviteLink?.code ?? inviteLink?.codePreview ?? "—"}</code>
                      <button
                        type="button"
                        className="eh-inv-copy"
                        onClick={() => copyInviteText(inviteLink?.code ?? inviteLink?.codePreview ?? null, "邀请码已复制")}
                      >复制</button>
                    </div>
                    <div className="eh-inv-fld">
                      <span className="eh-inv-fld-l">邀请链接</span>
                      <code className="eh-inv-fld-v eh-inv-link">{inviteLink?.link ?? "生成中…"}</code>
                      <button
                        type="button"
                        className="eh-inv-copy"
                        onClick={() => copyInviteText(inviteLink?.link ?? null, "邀请链接已复制")}
                      >复制</button>
                    </div>
                  </div>

                  {inviteLink?.link ? (
                    <button type="button" className="eh-inv-regen" onClick={() => void createInviteLink(true)} disabled={inviteBusy}>
                      {inviteBusy ? "生成中…" : "换一条新链接（旧链接仍然有效）"}
                    </button>
                  ) : null}

                  {inviteLink?.hint ? <p className="eh-inv-hint">{inviteLink.hint}</p> : null}

                  {/* ---------- 被邀请客户列表（分页：PC 按钮 / 手机翻页流） ---------- */}
                  <div className="eh-inv-sec">
                    <div className="eh-inv-sec-head">
                      <b>被邀请的客户</b>
                      <span>
                        {invitees ? `${invitees.total} 人` : "—"}
                        {invitees && invitees.creditsEarned > 0 ? ` · 已得 ${fmtCredits(invitees.creditsEarned)} 算力` : ""}
                      </span>
                    </div>
                    {inviteeItems.length > 0 ? (
                      <ul className="eh-inv-list">
                        {inviteeItems.map((it) => (
                          <li key={it.id} className="eh-inv-item">
                            <div className="eh-inv-ava" aria-hidden="true">{it.name.slice(0, 1)}</div>
                            <div className="eh-inv-info">
                              <div className="eh-inv-name">
                                {it.name}
                                {it.phone ? <span className="eh-inv-phone">{it.phone}</span> : null}
                              </div>
                              <div className="eh-inv-meta">
                                <span>绑定 {fmtInviteDate(it.boundAt)}</span>
                                {/* 2026-09-30 用户：徽标只在「已达成」时出现——对方没充值就不展示「首次充值」，等做到了再亮 */}
                                {it.firstUseRewarded ? <span className="eh-inv-badge on">首次使用 ✓</span> : null}
                                {it.firstRechargeRewarded ? <span className="eh-inv-badge on">首次充值 ✓</span> : null}
                              </div>
                            </div>
                            <div className="eh-inv-credits">
                              {it.creditsEarned > 0 ? <b>+{fmtCredits(it.creditsEarned)}</b> : <span className="eh-inv-credits-0">—</span>}
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="eh-inv-empty">还没有被邀请的客户 · 把上面的海报或链接发出去试试</div>
                    )}
                    <DrawerPager
                      isMobile={isMobile}
                      page={inviteePage}
                      totalPages={invitees?.totalPages ?? 1}
                      total={invitees?.total ?? 0}
                      unit="人"
                      busy={inviteBusy}
                      onPrev={() => void loadInviteePage(inviteePage - 1, false)}
                      onNext={() => void loadInviteePage(inviteePage + 1, false)}
                      onLoadMore={() => void loadInviteePage(inviteePage + 1, true)}
                    />
                  </div>

                  <p className="eco-modal-tip">风控：同设备 / 同手机号 / 同支付账号只认一个；刷量追回。</p>
                </>
              )}
            </div>
          </aside>
        </div>
      ) : null}

      {showOrders ? (
        <div className="eh-rd-overlay" onClick={() => setShowOrders(false)}>
          <aside
            className="eh-rd-panel"
            role="dialog"
            aria-modal="true"
            aria-label="全部订单"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="eh-rd-head">
              <b>🧾 全部订单</b>
              <span style={{ flex: 1 }} />
              <button type="button" className="eh-rd-x" onClick={() => setShowOrders(false)} aria-label="关闭">✕</button>
            </div>
            <div className="eh-rd-body eh-od-body">
              {ordersBusy && orderItems.length === 0 ? (
                <div className="eh-rd-loading">加载中…</div>
              ) : orderItems.length === 0 ? (
                <div className="eh-od-empty">
                  <span className="eh-od-empty-ico">🧾</span>
                  <b>暂无订单</b>
                  <p>充值算力、开通商品或登记预约后，订单会出现在这里，点开可看详情。</p>
                </div>
              ) : (
                <ul className="eh-od-list">
                  {orderItems.map((o) => (
                    <li key={o.id} className={"eh-od-item kind-" + o.kind}>
                      <button
                        type="button"
                        className="eh-od-row"
                        onClick={() => setOpenOrderId(openOrderId === o.id ? null : o.id)}
                      >
                        <div className="eh-od-main">
                          <div className="eh-od-t"><span className="eh-od-kind">{o.kindLabel}</span><b>{o.title}</b></div>
                          <span className="eh-od-time">{fmtInviteDate(o.createdAt)}</span>
                        </div>
                        <div className="eh-od-side">
                          {o.credits ? <b className="eh-od-pts">+{fmtCredits(o.credits)} 算力</b> : o.amountCny != null ? <b className="eh-od-cny">¥{o.amountCny}</b> : null}
                          <span className={"eh-od-st" + (o.status === "paid" ? " ok" : "")}>{o.statusLabel}</span>
                        </div>
                        <span className="eh-od-arrow" aria-hidden="true">{openOrderId === o.id ? "⌃" : "⌄"}</span>
                      </button>
                      {openOrderId === o.id ? (
                        <div className="eh-od-detail">
                          {o.detail.map((line) => (
                            <div key={line.label} className="eh-od-dl">
                              <span>{line.label}</span>
                              <b>{line.value}</b>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              <DrawerPager
                isMobile={isMobile}
                page={ordersPage}
                totalPages={orders?.totalPages ?? 1}
                total={orders?.total ?? 0}
                unit="笔"
                busy={ordersBusy}
                onPrev={() => void loadOrderPage(ordersPage - 1, false)}
                onNext={() => void loadOrderPage(ordersPage + 1, false)}
                onLoadMore={() => void loadOrderPage(ordersPage + 1, true)}
              />
            </div>
          </aside>
        </div>
      ) : null}

      {showDeliv ? (
        <div className="eh-rd-overlay" onClick={() => setShowDeliv(false)}>
          <aside
            className="eh-rd-panel"
            role="dialog"
            aria-modal="true"
            aria-label="历史交付物"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="eh-rd-head">
              <b>📄 历史交付物</b>
              <span style={{ flex: 1 }} />
              <button type="button" className="eh-rd-x" onClick={() => setShowDeliv(false)} aria-label="关闭">✕</button>
            </div>
            <div className="eh-rd-body eh-dl-body">
              <p className="eh-dl-tip">平台只为你保留 <b>7 天</b>，到期自动清理；需要长期保存请点「下载 Word」存到手机/电脑（WPS 或 Word 都能打开）。</p>
              {delivBusy && delivItems.length === 0 ? (
                <div className="eh-rd-loading">加载中…</div>
              ) : delivItems.length === 0 ? (
                <div className="eh-dl-empty">还没有交付物 · 生成成功后会保存在这里，7 天内随时可下载 Word</div>
              ) : (
                <ul className="eh-dl-list">
                  {delivItems.map((item) => {
                    const daysLeft = Math.max(0, Math.ceil((new Date(item.expiresAt).getTime() - Date.now()) / 86_400_000));
                    return (
                      <li key={item.id} className="eh-dl-item">
                        <div className="eh-dl-main">
                          <b>{item.skuName ?? "AI员工交付物"}</b>
                          <span>消耗 {item.credits} 算力 · {fmtInviteDate(item.createdAt)} · 剩余 {daysLeft} 天</span>
                        </div>
                        <button
                          type="button"
                          className="eh-dl-btn"
                          disabled={downloadingId === item.id}
                          onClick={() => void downloadDeliverable(item)}
                        >
                          {downloadingId === item.id ? "准备中…" : "下载 Word"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <DrawerPager
                isMobile={isMobile}
                page={delivPage}
                totalPages={deliv?.totalPages ?? 1}
                total={deliv?.total ?? 0}
                unit="份"
                busy={delivBusy}
                onPrev={() => void loadDelivPage(delivPage - 1, false)}
                onNext={() => void loadDelivPage(delivPage + 1, false)}
                onLoadMore={() => void loadDelivPage(delivPage + 1, true)}
              />
            </div>
          </aside>
        </div>
      ) : null}

      <AppsDrawer open={showApps} onClose={() => setShowApps(false)} />

      {/* 退出登录二次确认（2026-09-30 用户）：防误触，退出不可撤。 */}
      {showLogoutConfirm ? (
        <div className="eco-modal-mask" onClick={() => setShowLogoutConfirm(false)}>
          <div className="eco-modal eco-logout" onClick={(e) => e.stopPropagation()}>
            <h3>确认退出登录？</h3>
            <p className="eco-modal-sub">退出后需要重新登录才能查看算力余额、订单与邀请记录；本次会话的购物车仍会保留。</p>
            <button type="button" className="eco-modal-btn eco-logout-btn" onClick={() => handleMineLogout()}>退出登录</button>
            <button type="button" className="eco-modal-btn eco-ghost-btn" onClick={() => setShowLogoutConfirm(false)}>再想想</button>
          </div>
        </div>
      ) : null}

      {showActivate ? (
        <div className="eco-modal-mask" onClick={() => setShowActivate(false)}>
          <div className="eco-modal eco-activate" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="eco-modal-x" onClick={() => setShowActivate(false)}>✕</button>
            {activateStep === "form" ? (
              <>
                <h3><IconGlyph name="gift" size={18} style={{ display: "inline", verticalAlign: "-3px" }} /> 0 元开通 · 立送 100 算力</h3>
                <p className="eco-modal-sub">不收开通费、无月费，每次使用按目录价扣算力；注册礼直接进你的算力钱包。</p>
                <div className="eco-act-benefits">
                  <div><IconGlyph name="gift" size={13} style={{ display: "inline", verticalAlign: "-2px" }} /> 100 算力 · 赠送性质 · {SIGNUP_GIFT_VALID_DAYS} 天有效</div>
                  <div><IconGlyph name="pack" size={13} style={{ display: "inline", verticalAlign: "-2px" }} /> 限文字类任务（视频生成不可用）</div>
                  <div><IconGlyph name="shield" size={13} style={{ display: "inline", verticalAlign: "-2px" }} /> 用后扣费 · 失败不扣费</div>
                </div>
                <button type="button" className="eco-modal-btn" onClick={() => void activateAccount()}>确认开通 · 领取 100 算力</button>
                <p className="eco-modal-tip">同账号仅一份；异常挂起人工审核。</p>
              </>
            ) : (
              <>
                <div className="eco-act-ok">✅ 100 算力已到账</div>
                <p className="eco-modal-sub">赠送算力 · 有效期至 <b>{fmtGiftDate(activateGift?.expiresAt ?? null)}</b>（{activateGift?.validDays ?? SIGNUP_GIFT_VALID_DAYS} 天）· 到期前 3 天提醒</p>
                <button type="button" className="eco-modal-btn" onClick={() => { setShowActivate(false); window.location.href = getAppPath("/agents"); }}>去用第一个智能体 ›</button>
                <button type="button" className="eco-modal-btn eco-ghost-btn" onClick={() => setShowActivate(false)}>先逛逛</button>
              </>
            )}
          </div>
        </div>
      ) : null}

      {showDict ? (
        /* 新手帮助 · 术语词典（原型 v3.29：窄屏底部抽屉 / ≥700px 居中卡；图标统一走矢量 glyph） */
        <div className="eco-modal-mask eco-sheet-mask" onClick={() => setShowDict(false)}>
          <div className="eco-sheet" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="eco-sheet-x" onClick={() => setShowDict(false)}>✕</button>
            <div className="eco-help-head">
              <IconGlyph name="help" size={19} className="eco-help-ic" /> 新手帮助 · 术语词典
              <small>看不懂的词这里都有 · 也可以随时点左上角 <IconGlyph name="robot" size={12} className="eco-help-ic" /> 问小潼</small>
            </div>
            <div className="eco-help-list">
              <div className="eco-help-item"><b><IconGlyph name="bolt" size={13} className="eco-help-ic" /> 算力</b><span>商城里唯一的「钱」：1 元 = 10 算力。智能体按次扣算力（例：沈定 IP 定位全案 99 算力/次 ≈ ¥9.9）；AI 硬件按台直购、不耗算力（例：AI 录音卡 ¥199/台）。</span></div>
              <div className="eco-help-item"><b><IconGlyph name="gem" size={13} className="eco-help-ic" /> 积分（旧称）</b><span>以前叫「积分」（旧图标就是左边那个钻石），现在统一叫「算力」，是同一样东西，看到旧图写积分也别慌。</span></div>
              <div className="eco-help-item"><b><IconGlyph name="chat" size={13} className="eco-help-ic" /> 访谈</b><span>智能体开工前先问你几个问题（一次只问一个），你的回答会自动填进「简报」——AI 照着做才不跑偏。</span></div>
              <div className="eco-help-item"><b><IconGlyph name="clipboard" size={13} className="eco-help-ic" /> 简报</b><span>访谈答完自动生成的一页「任务卡」，字段可逐条改，你确认后才生成，改简报不花钱。</span></div>
              <div className="eco-help-item"><b><IconGlyph name="tag" size={13} className="eco-help-ic" /> 0 元开通 · 用后扣费</b><span>智能体不收月费、不用不花钱；点了「立即使用」并成功交付后才扣算力。</span></div>
              <div className="eco-help-item"><b><IconGlyph name="pack" size={13} className="eco-help-ic" /> 交付才扣</b><span>东西做好、你在交付区看到结果了才扣算力，中途退出不算你头上。</span></div>
              <div className="eco-help-item"><b><IconGlyph name="shield" size={13} className="eco-help-ic" /> 失败不扣费</b><span>任务失败 / 超时不扣算力，余额原路不动。</span></div>
              <div className="eco-help-item"><b><IconGlyph name="gift" size={13} className="eco-help-ic" /> 赠送算力</b><span>新客礼（0 元开通送的 100 算力）{SIGNUP_GIFT_VALID_DAYS} 天有效；签到 / 邀请送的 90 天有效。赠送算力限自营文字类智能体；充值所得（含赠送）通用不限。</span></div>
            </div>
            <div className="eco-help-note">还有疑问？点左上角头像随时问小潼。</div>
          </div>
        </div>
      ) : null}

      {openConsultant ? <ConsultantModal consultant={openConsultant} onClose={() => setOpenConsultant(null)} /> : null}
    </main>
  );
}
