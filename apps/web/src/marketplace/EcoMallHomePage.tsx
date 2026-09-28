import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { apiPath, getAppPath } from "../lib/api.js";
import { fetchMarketMe, readJson } from "./shell.js";
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

type FloorId = "floor-acquire" | "floor-private" | "floor-consultants" | "floor-hardware" | "floor-courses" | "floor-opc" | "floor-industry" | "floor-cases";

/** 金刚区七格（原型 v3.28，tint 照原型 data-tint）。 */
const KINGKONG: Array<{ floor: FloorId; label: string; icon: string; tint: string }> = [
  { floor: "floor-acquire", label: "内容获客", icon: "✍️", tint: "#FF7A1A" },
  { floor: "floor-private", label: "私域营销", icon: "💬", tint: "#F2538A" },
  { floor: "floor-consultants", label: "数字咨询师", icon: "🧭", tint: "#F5A623" },
  { floor: "floor-hardware", label: "AI硬件", icon: "🔌", tint: "#0E9F6E" },
  { floor: "floor-courses", label: "AI课程", icon: "🎓", tint: "#FF5C4D" },
  { floor: "floor-opc", label: "OPC专区", icon: "🏭", tint: "#D96A00" },
  { floor: "floor-industry", label: "行业工作台", icon: "🏪", tint: "#E8A33D" }
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
          ⚡ {ppu ?? "—"} 算力/{unit} <i>≈ ¥{cny} · 0元开通 · 用后扣费</i>
        </span>
      </div>
    </article>
  );
}

/** 占位商品卡：AI 硬件 / AI 课程等还没上架的货架位。 */
function EmployeeModal({
  employee,
  initialSkin,
  skuPpu,
  onClose
}: {
  employee: EcoEmployee;
  initialSkin: EcoSkinKey;
  skuPpu: Map<string, number> | null;
  onClose: () => void;
}) {
  const [skin, setSkin] = useState<EcoSkinKey>(initialSkin);
  const current = employee.skins[skin];
  const detailPath = employeeDetailPath(employee, skin);
  const canUse = employee.status === "ok" && Boolean(detailPath);
  const skuCode = employeeSkuCode(employee, skin);
  const ppu = skuCode && skuPpu ? skuPpu.get(skuCode) : undefined;

  return (
    <div className="eco-mask show" role="dialog" aria-modal="true" onClick={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="eco-modal">
        <button className="eco-modal-x" type="button" onClick={onClose} aria-label="关闭">×</button>
        <div className="eco-modal-top">
          <EcoAvatar icon={employee.icon} img={employeeImagePath(employee)} className="eco-m-ava" />
          <div>
            <div className="eco-m-role">{employee.role}</div>
            <div className="eco-name">{employeePersonaLabel(employee.capability)}</div>
            <div className="eco-m-tag">AI 数字员工 · {skin}</div>
          </div>
        </div>
        <div className="eco-tabs">
          {ECO_SKIN_ORDER.filter((key) => employee.skins[key]).map((key) => (
            <button key={key} type="button" className={key === skin ? "on" : ""} onClick={() => setSkin(key)}>
              {key}
            </button>
          ))}
        </div>
        <div className="eco-m-hook">{current?.hook ?? employee.hookBase}</div>
        <div className="eco-persona">
          <div><b>性格</b>{employee.personality}</div>
          <div><b>擅长</b>{employee.ability}</div>
        </div>
        <div className="eco-m-rows">
          <div className="eco-m-row">
            <span className="eco-m-label">交付</span>
            <span className="eco-m-val">{current?.deliver ?? ""}</span>
          </div>
          <div className="eco-m-row">
            <span className="eco-m-label">需要你给</span>
            <span className="eco-m-val">{current?.need ?? ""}</span>
          </div>
          {ppu != null ? (
            <div className="eco-m-row">
              <span className="eco-m-label">价格</span>
              <span className="eco-m-val eco-m-price"><b>{ppu}</b> 算力/次</span>
            </div>
          ) : null}
        </div>
        <div className="eco-note">
          <b>说明：</b>你可以在这里切换通用 / 美业专精 / 餐饮专精，查看不同行业的交付内容和需要准备的材料。
        </div>
        <button
          className="eco-primary"
          type="button"
          disabled={!canUse}
          onClick={() => {
            if (!detailPath) return;
            window.location.href = getAppPath(detailPath);
          }}
        >
          {employee.status === "ok" ? (detailPath ? "去使用 ›" : "该行业专精正在准备") : "开发中 · 敬请期待"}
        </button>
      </div>
    </div>
  );
}

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

function FloorHead({ no, title, sub }: { no: string; title: string; sub?: string }) {
  return (
    <div className="eco-floor-head">
      <div className="eco-floor-title">
        <span className="eco-floor-no">{no}</span>
        <h2>{title}</h2>
      </div>
      {sub ? <div className="eco-floor-sub">{sub}</div> : null}
    </div>
  );
}

export function EcoMallHomePage() {
  const [query, setQuery] = useState("");
  const [activeFloor, setActiveFloor] = useState<FloorId>("floor-acquire");
  const [balance, setBalance] = useState<number | null>(null);
  const [skuPpu, setSkuPpu] = useState<Map<string, number> | null>(null);
  const [openEmployee, setOpenEmployee] = useState<EcoEmployee | null>(null);
  const [openEmployeeSkin, setOpenEmployeeSkin] = useState<EcoSkinKey>("通用");
  const [openConsultant, setOpenConsultant] = useState<EcoConsultant | null>(null);
  // B 线新增（agents-home-tech-demo v3.28 对齐，2026-09-28）：签到 / 邀请 / 新手词典弹层。
  // 签到、邀请均为**本地演示态**（后端签到/裂变接口属 A 线 P1，落地后切换）。
  const today = new Date().toISOString().slice(0, 10);
  const [showSignIn, setShowSignIn] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showDict, setShowDict] = useState(false);
  const [signedToday, setSignedToday] = useState(() => Boolean(localStorage.getItem(`eco_sign_${new Date().toISOString().slice(0, 10)}`)));
  function signIn() {
    localStorage.setItem(`eco_sign_${today}`, "1");
    setSignedToday(true);
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

  useEffect(() => {
    document.body.classList.add("eco-mall-body");
    document.title = "思潼AI生态商城 · 数字员工 / 数字咨询师";
    return () => {
      document.body.classList.remove("eco-mall-body");
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchMarketMe<{ creditBalance: number }>()
      .then((data) => {
        if (!cancelled) setBalance(data ? data.creditBalance : null);
      })
      .catch(() => {
        if (!cancelled) setBalance(null);
      });
    return () => {
      cancelled = true;
    };
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
  /** 购物车（本地演示态：人民币直购商品加购，后端购物车接口落地后切换）。 */
  const [cartCount, setCartCount] = useState(0);
  function addToCart(name: string) {
    setCartCount((value) => value + 1);
  }

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

  function openEmployeeAt(employee: EcoEmployee, skin: EcoSkinKey) {
    setOpenEmployee(employee);
    setOpenEmployeeSkin(skin);
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
            // 未上线智能体：卡片直达预约详情页（原型 v12「预约统一收口到详情页」）
            if (status === "dev") {
              window.location.href = getAppPath(`/agent/${employeeSkuCode(employee, "通用")}/detail`);
              return;
            }
            openEmployeeAt(employee, "通用");
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
                onClick={() => employee && openEmployeeAt(employee, "通用")}
              >
                <span className="eco-today-ico">{employee?.icon}</span>
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

  /** 人民币直购货架卡（原型 F4 硬件 / F5 课程 / F6 OPC：加购按钮 + 价格行）。 */
  function renderShelfCard(icon: string, name: string, tag: string, desc: string, price: string, note: string) {
    return (
      <article className="eco-product is-ok">
        <div className="eco-p-img">
          <EcoAvatar icon={icon} img="" />
          <span className="eco-badge ok">{tag}</span>
        </div>
        <div className="eco-p-body">
          <div className="eco-p-name">{name}</div>
          <p className="eco-p-desc">{desc}</p>
          <div className="eco-p-buy">
            <span className="eco-p-price">
              <b>{price}</b>
              <span className="eco-p-unit">{note}</span>
            </span>
            <button
              type="button"
              className="eco-p-cart"
              onClick={(e) => { e.stopPropagation(); addToCart(name); }}
            >🛒 加购</button>
          </div>
        </div>
      </article>
    );
  }

  function renderBrandFloor() {
    return (
      <section className="eco-floor" id="floor-industry">
        <FloorHead no="F7" title="行业工作台" sub="美业品牌 demo 实景：门店 AI 工作台一整套的样子，点进去直接体验。" />
        <button
          type="button"
          className="eco-mod eco-mod-hero"
          onClick={() => { window.location.href = getAppPath("/lanqi"); }}
        >
          <div className="eco-mod-name">美业品牌 demo</div>
          <div className="eco-mod-desc">
            朋友圈 / 社群内容、经营驾驶舱、门店诊断、内容工作室、AI 绘图、公域获客——兰琪门店正在用的完整工作台，进去就能点。
          </div>
          <div className="eco-mod-go">进入 demo ›</div>
        </button>
      </section>
    );
  }

  return (
    <main className="app-wrap eco-mall-page eco-light eh">
      {/* 顶栏（原型 v3.28：品牌 + AI 在线状态 + 余额橙 chip + 充值 + ?） */}
      <header className="eh-topbar">
        <div className="eh-brand">
          <div className="eh-brand-txt">
            <b>思潼AI商城</b>
            <span className="eh-ai"><i></i>AI 全员在线</span>
          </div>
        </div>
        <span className="eh-sp" />
        <div className="eh-wallet">
          <span className="eh-bal">⚡ <b>{balance ?? "—"}</b><i>{balance != null ? `≈ ¥${(balance / 10).toFixed(balance % 10 === 0 ? 0 : 1)}` : ""}</i></span>
          <button type="button" className="eh-mini" onClick={() => { window.location.href = getAppPath("/recharge"); }}>充值</button>
        </div>
        <button type="button" className="eh-iconbtn" title="新手帮助" onClick={() => setShowDict(true)}>?</button>
      </header>

      <section className="eco-mall">
        {/* Hero AI 指挥横幅（原型 v3.28：橙色渐变 + 波形 + 打字机 + 流光边） */}
        <section className="eh-hero">
          <div className="eh-hero-row">
            <button type="button" className="eh-hero-ava" title="点我和 AI 管家小潼聊聊" onClick={() => setShowDict(true)}>🤖</button>
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
            <button type="button" className="eh-big" onClick={() => setShowInvite(true)}>🧧 免费开通 · 立送 100 算力</button>
            <button type="button" className="eh-ghost" onClick={() => setShowDict(true)}>❓ 新手帮助</button>
          </div>
          <div className="eh-hero-note">⚡ 计费口径：1 元 = 10 算力 · 0 元开通 · 用后扣费 · 失败不扣</div>
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
                      onOpen={() => openEmployeeAt(employee, "通用")}
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
            {/* 广告位（原型：当前仅邀约有礼） */}
            <button type="button" className="eco-banner eco-invite-banner" onClick={() => setShowInvite(true)}>
              <div className="eco-banner-text">
                <b>🎁 邀请有礼</b>
                <span>好友开通 · 各得 100 算力</span>
              </div>
              <span className="eco-banner-link">立即邀请 ›</span>
            </button>

            <nav className="eco-kingkong" aria-label="商城楼层导航">
              {KINGKONG.map((item) => (
                <button
                  key={item.floor}
                  type="button"
                  className={`eco-kk-item ${activeFloor === item.floor ? "active" : ""}`}
                  style={{ "--kk-tint": item.tint } as CSSProperties}
                  onClick={() => scrollToFloor(item.floor)}
                >
                  <span className="eco-kk-ico">{item.icon}</span>
                  <span className="eco-kk-label">{item.label}</span>
                </button>
              ))}
            </nav>

            {renderTodayStrip()}

            <section className="eco-floor" id="floor-acquire">
              <FloorHead no="F1" title="内容获客专区" sub={`做内容引流的智能体都在这 · ${byKey.acquireOk.length} 位在线`} />
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
              <FloorHead no="F2" title="私域营销专区" sub="客户成交 / 私域内容，跟着转化走。" />
              <div className="eco-products">
                {renderEmployeeProducts(byKey.privateDev, "dev")}
              </div>
            </section>

            <section className="eco-floor" id="floor-consultants">
              <FloorHead no="F3" title="数字咨询师专区" sub="把真人的方法论装进数字分身。" />
              <div className="eco-products">
                <article className="eco-product is-dev">
                  <div className="eco-p-img">
                    <EcoAvatar icon="🧭" img="" />
                    <span className="eco-badge dev">即将上线</span>
                  </div>
                  <div className="eco-p-body">
                    <div className="eco-p-name">保禄数字分身</div>
                    <div className="eco-p-shop">思潼AI 创始人</div>
                    <p className="eco-p-desc">我是保禄的数字分身，他的 AI 增长和连锁经营方法论都装进来了。你有具体问题，我按保禄的思路接着答。</p>
                    <div className="eco-p-buy">
                      <span className="eco-p-soon">🔐 真人授权训练中 · 即将上线</span>
                      <button type="button" className="eco-p-cart" onClick={() => addToCart("保禄数字分身")}>🛒 立即购买</button>
                    </div>
                  </div>
                </article>
                {ECO_CONSULTANTS.map((consultant, index) => {
                  const ok = consultant.status === "ok";
                  return (
                    <article
                      key={consultant.key}
                      className={`eco-product ${ok ? "is-ok" : "is-dev"}`}
                      style={{ animationDelay: `${Math.min(index, 9) * 40}ms` }}
                      onClick={() => setOpenConsultant(consultant)}
                    >
                      <div className="eco-p-img">
                        <EcoAvatar icon={consultant.icon} img={consultantImagePath(consultant)} />
                        <span className={`eco-badge ${ok ? "ok" : "dev"}`}>{ok ? "可对话" : "即将上线"}</span>
                      </div>
                      <div className="eco-p-body">
                        <div className="eco-p-name">{consultant.name}</div>
                        <div className="eco-p-shop">{consultant.face}</div>
                        <p className="eco-p-desc">{consultant.meta}</p>
                        <div className="eco-p-buy">
                          <span className="eco-p-soon">{ok ? "去对话" : "敬请期待"}</span>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            <section className="eco-floor" id="floor-hardware">
              <FloorHead no="F4" title="AI 硬件专区" sub="让 AI 落到店里的硬件货架（人民币直购 · 不进算力体系）。" />
              <div className="eco-products">
                {renderShelfCard("🎙️", "AI 录音卡", "硬件新品", "录音即分析，自动转经营动作：客户沟通自动归档、话术要点自动提炼。", "¥199", "/台 · 人民币直购")}
                {renderShelfCard("📹", "门店 AI 机器人", "硬件新品", "迎宾接待、导购问答，常用话术语音随叫随到，前台接待不冷场。", "¥1,999", "/台 · 人民币直购")}
              </div>
            </section>

            <section className="eco-floor" id="floor-courses">
              <FloorHead no="F5" title="AI 课程专区" sub="从 0 到 1 学会用 AI 干活（人民币直购 · 不进算力体系）。" />
              <div className="eco-products">
                {renderShelfCard("🎓", "智能体开发课", "视频课", "从 0 到 1 学会搭建自己的智能体工作流。", "¥199", "/门 · 人民币直购")}
                {renderShelfCard("🎬", "WorkBuddy 办公提效课", "实操课", "用 AI 把日报、周报、方案、表格这些日常活干得更快，即学即用。", "¥99", "/门 · 人民币直购")}
              </div>
            </section>

            <section className="eco-floor" id="floor-opc">
              <FloorHead no="F6" title="OPC 专区" sub="AI 算力与创作资源，商家价直供。" />
              <div className="eco-products">
                <article className="eco-product is-ok">
                  <div className="eco-p-img">
                    <EcoAvatar icon="🏭" img="" />
                    <span className="eco-badge ok">OPC</span>
                  </div>
                  <div className="eco-p-body">
                    <div className="eco-p-name">大模型折扣仓</div>
                    <div className="eco-p-shop">主流大模型 API 额度 · 折扣直充</div>
                    <p className="eco-p-desc">token 按仓价拿，AI 用量大的商家先省一半。</p>
                    <div className="eco-p-buy">
                      <span className="eco-p-price">
                        <b>50</b>
                        <span className="eco-p-unit">算力/份 起 ≈ ¥5</span>
                      </span>
                      <button type="button" className="eco-p-cart" onClick={() => addToCart("大模型折扣仓")}>🛒 加购</button>
                      <button type="button" className="eco-p-cart primary" onClick={() => addToCart("大模型折扣仓（直购）")}>立即购买</button>
                    </div>
                  </div>
                </article>
              </div>
            </section>

            {renderBrandFloor()}

            {/* AI 案例 · 信息流（原型 v3.12；演示数据虚构，照原型口径标注） */}
            <section className="eco-floor" id="floor-cases">
              <FloorHead no="📚" title="AI 案例" sub="看别人怎么用 AI 降本增效——每个案例写清卡点、做法、投入、结果，看中直接用同款智能体（演示数据虚构）。" />
              <div className="eco-cases">
                {AI_CASES.map((c) => (
                  <article key={c.title} className="eco-case">
                    <div className="eco-case-top">
                      <span className="eco-case-tag">{c.tag}</span>
                      <b className="eco-case-metric">{c.metric}</b>
                    </div>
                    <h3 className="eco-case-title">{c.title}</h3>
                    <p className="eco-case-point">{c.point}</p>
                    <div className="eco-case-agents">同款智能体：{c.agents}</div>
                  </article>
                ))}
              </div>
              <div className="eco-case-foot">上面这些案例用的智能体，商城里都有现成的 · <a onClick={() => scrollToFloor("floor-acquire")}>去逛同款 ›</a></div>
            </section>
          </>
        )}
      </section>

      {/* 底部 TabBar（手机）/ 左侧导航（桌面 ≥960px，照原型 v3.28） */}
      <nav className="eh-tabbar" aria-label="商城导航">
        <div className="eh-nav-brand">
          <span className="eh-brand-txt"><b>思潼AI商城</b><span className="eh-ai"><i></i>AI 全员在线</span></span>
        </div>
        <button type="button" className="eh-tab act" onClick={() => { window.scrollTo({ top: 0, behavior: "smooth" }); }}>
          <i>🏠</i><span>首页</span>
        </button>
        <button type="button" className="eh-tab" onClick={() => scrollToFloor("floor-cases")}>
          <i>📚</i><span>AI案例</span>
        </button>
        <button type="button" className="eh-tab" title="购物车（即将上线）">
          <i>🛒{cartCount > 0 ? <b className="eh-tab-badge">{cartCount}</b> : null}</i><span>购物车</span>
        </button>
        <button type="button" className="eh-tab" onClick={() => { window.location.href = getAppPath("/mine"); }}>
          <i>👤</i><span>我的</span>
        </button>
        <div className="eh-nav-bal">
          <span className="t">⚡ 我的算力</span>
          <span className="v">{balance ?? "—"}</span>
          <i>{balance != null ? `≈ ¥${(balance / 10).toFixed(balance % 10 === 0 ? 0 : 1)}` : ""}</i>
          <button type="button" className="eh-mini" onClick={() => { window.location.href = getAppPath("/recharge"); }}>充值</button>
        </div>
      </nav>

      {showSignIn ? (
        <div className="eco-modal-mask" onClick={() => setShowSignIn(false)}>
          <div className="eco-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="eco-modal-x" onClick={() => setShowSignIn(false)}>✕</button>
            <h3>📅 每日签到</h3>
            <p className="eco-modal-sub">每日 +5 · 第 7 天 +30（含当天）· 每周封顶 60 · 断签重置</p>
            <button type="button" className="eco-modal-btn" disabled={signedToday} onClick={signIn}>
              {signedToday ? "今天已签到 ✓" : "立即签到 · +5 算力"}
            </button>
            <p className="eco-modal-tip">签到所得为赠送算力 · 90 天有效期 · 限思潼自营文字类智能体<br />（演示环境：签到入账随后端能力上线）</p>
          </div>
        </div>
      ) : null}

      {showInvite ? (
        <div className="eco-modal-mask" onClick={() => setShowInvite(false)}>
          <div className="eco-modal eco-invite" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="eco-modal-x" onClick={() => setShowInvite(false)}>✕</button>
            <h3>🎁 邀请有礼</h3>
            <p className="eco-modal-sub">分享海报给好友 · 各得 100 算力 · 人数不限</p>
            <div className="eco-invite-poster">
              <b>思潼AI商城 · 智能体 0 元开通</b>
              <span>好友开通 · 各得 100 算力</span>
              <div className="eco-invite-rows">
                <i>100<small>好友注册立得</small></i>
                <i>100<small>好友消耗满 50 你得</small></i>
              </div>
            </div>
            <button
              type="button"
              className="eco-modal-btn"
              onClick={() => { void navigator.clipboard?.writeText(window.location.href); }}
            >
              复制邀请链接
            </button>
            <p className="eco-modal-tip">风控：同设备 / 同手机号 / 同支付账号只认一个；刷量追回（演示环境：邀请入账随后端能力上线）</p>
          </div>
        </div>
      ) : null}

      {showDict ? (
        <div className="eco-modal-mask" onClick={() => setShowDict(false)}>
          <div className="eco-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="eco-modal-x" onClick={() => setShowDict(false)}>✕</button>
            <h3>❓ 新手帮助 · 术语词典</h3>
            <p className="eco-modal-sub">看不懂的词这里都有</p>
            <div className="eco-dict">
              <p><b>⚡ 算力</b>商城里唯一的「钱」：1 元 = 10 算力。智能体按次扣算力，例：本单 99 算力 ≈ ¥9.9。</p>
              <p><b>🪙 算力（旧称「积分」）</b>以前叫「积分」，现在统一叫「算力」，是同一样东西。</p>
              <p><b>💬 访谈</b>智能体开工前先问你几个问题（一次只问一个），回答自动填进「简报」。</p>
              <p><b>📋 简报</b>访谈答完自动生成的任务卡，字段可逐条改，确认后才生成，改简报不花钱。</p>
            </div>
          </div>
        </div>
      ) : null}

      {openEmployee ? (
        <EmployeeModal
          employee={openEmployee}
          initialSkin={openEmployeeSkin}
          skuPpu={skuPpu}
          onClose={() => setOpenEmployee(null)}
        />
      ) : null}
      {openConsultant ? <ConsultantModal consultant={openConsultant} onClose={() => setOpenConsultant(null)} /> : null}
    </main>
  );
}
