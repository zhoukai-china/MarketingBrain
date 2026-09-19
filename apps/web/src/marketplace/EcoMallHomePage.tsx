import { useEffect, useMemo, useState } from "react";
import { getAppPath } from "../lib/api.js";
import { fetchMarketMe, Topbar } from "./shell.js";
import {
  ECO_CONSULTANTS,
  ECO_EMPLOYEES,
  ECO_EMPLOYEE_ZONES,
  ECO_SKIN_ORDER,
  consultantImagePath,
  employeeDetailPath,
  employeeImagePath,
  employeeStatusForZone,
  employeeZoneSkin,
  type EcoConsultant,
  type EcoEmployee,
  type EcoEmployeeZoneKey,
  type EcoSkinKey
} from "./eco-mall-data.js";

type EcoTopSection = "数字员工" | "consultant" | "智能体" | "品牌工作台专区" | "AI硬件" | "AI课程";
type EcoCategory = "employees" | "software" | "hardware" | "courses";

const CATEGORY_TABS: Array<{ key: EcoCategory; label: string }> = [
  { key: "employees", label: "数字员工" },
  { key: "software", label: "智能体" },
  { key: "hardware", label: "AI硬件" },
  { key: "courses", label: "AI课程" }
];

const TOP_SECTIONS: Array<{ key: EcoTopSection; label: string }> = [
  { key: "数字员工", label: "数字员工" },
  { key: "consultant", label: "数字咨询师（真人孪生）" },
  { key: "智能体", label: "智能体" },
  { key: "品牌工作台专区", label: "品牌工作台" },
  { key: "AI硬件", label: "AI硬件" },
  { key: "AI课程", label: "AI课程" }
];

const TODAY_ITEMS: Array<{ title: string; hint: string; employeeKey: string }> = [
  { title: "今天要发内容", hint: "让金牌文案主笔直接给你一条能念的稿", employeeKey: "copywriter" },
  { title: "周一起号 / 定方向", hint: "让首席定位官先定人设，再排内容", employeeKey: "ip-position" },
  { title: "刚直播完 / 发了视频", hint: "让流量诊断官或直播复盘导师帮你复盘", employeeKey: "video-diag" }
];

function EcoAvatar({
  icon,
  img,
  color,
  className
}: {
  icon: string;
  img: string;
  color: string;
  className?: string;
}) {
  return (
    <div
      className={`eco-ava ${className ?? ""}`}
      style={{ background: `${color}22`, borderColor: `${color}55` }}
      aria-hidden="true"
    >
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

function EmployeeCard({
  employee,
  status,
  onOpen
}: {
  employee: EcoEmployee;
  status: "ok" | "dev";
  onOpen: () => void;
}) {
  const ok = status === "ok";

  return (
    <article className={`eco-card ${ok ? "is-ok" : "is-dev"}`} onClick={onOpen}>
      <span className={`eco-badge ${ok ? "ok" : "dev"}`}>{ok ? "可用" : "开发中"}</span>
      <EcoAvatar icon={employee.icon} img={employeeImagePath(employee)} color={employee.color} />
      <div className="eco-role">{employee.role}</div>
    </article>
  );
}

function EmployeeModal({
  employee,
  initialSkin,
  onClose
}: {
  employee: EcoEmployee;
  initialSkin: EcoSkinKey;
  onClose: () => void;
}) {
  const [skin, setSkin] = useState<EcoSkinKey>(initialSkin);
  const current = employee.skins[skin];
  const detailPath = employeeDetailPath(employee, skin);
  const canUse = employee.status === "ok" && Boolean(detailPath);

  return (
    <div className="eco-mask show" role="dialog" aria-modal="true" onClick={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="eco-modal">
        <button className="eco-modal-x" type="button" onClick={onClose} aria-label="关闭">×</button>
        <div className="eco-modal-top">
          <EcoAvatar icon={employee.icon} img={employeeImagePath(employee)} color={employee.color} className="eco-m-ava" />
          <div>
            <div className="eco-m-role">{employee.role}</div>
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
          <div>{employee.personality}</div>
          <div>{employee.ability}</div>
        </div>
        <div className="eco-m-deliver">
          <b>交付</b>：{current?.deliver ?? ""}
        </div>
        <div className="eco-m-need">
          需要你给：<span>{current?.need ?? ""}</span>
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

function ConsultantCard({ consultant, onOpen }: { consultant: EcoConsultant; onOpen: () => void }) {
  const ok = consultant.status === "ok";

  return (
    <article className={`eco-card consultant-card ${ok ? "is-ok" : "is-dev"}`} onClick={onOpen}>
      <span className={`eco-badge ${ok ? "ok" : "dev"}`}>{ok ? "可对话" : "即将上线"}</span>
      <div className="eco-card-top">
        <EcoAvatar icon={consultant.icon} img={consultantImagePath(consultant)} color={consultant.color} className="eco-face" />
        <div className="eco-card-head">
          <div className="eco-role">{consultant.name}</div>
          <div className="eco-tagline">{consultant.face}</div>
        </div>
      </div>
      <div className="eco-meta">{consultant.meta}</div>
      <div className="eco-cta">唤出数字分身 ›</div>
    </article>
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
          <EcoAvatar icon={consultant.icon} img={consultantImagePath(consultant)} color={consultant.color} className="eco-m-ava eco-face" />
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

function SoonShelf({ title, subtitle, pill }: { title: string; subtitle: string; pill: string }) {
  return (
    <div className="eco-soon">
      <h3>{title}</h3>
      <div>{subtitle}</div>
      <span className="eco-soon-pill">{pill}</span>
    </div>
  );
}

export function EcoMallHomePage() {
  const [section, setSection] = useState<EcoTopSection>("数字员工");
  const [category, setCategory] = useState<EcoCategory>("employees");
  const [balance, setBalance] = useState<number | null>(null);
  const [openEmployee, setOpenEmployee] = useState<EcoEmployee | null>(null);
  const [openEmployeeSkin, setOpenEmployeeSkin] = useState<EcoSkinKey>("通用");
  const [openConsultant, setOpenConsultant] = useState<EcoConsultant | null>(null);

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

  const employeeByKey = useMemo(() => new Map(ECO_EMPLOYEES.map((item) => [item.key, item])), []);

  function openEmployeeAt(employee: EcoEmployee, skin: EcoSkinKey) {
    setOpenEmployee(employee);
    setOpenEmployeeSkin(skin);
  }

  function renderEmployees(zone: EcoEmployeeZoneKey) {
    if (zone !== "通用" && zone !== "美业专区" && zone !== "餐饮专区") {
      return (
        <div className="eco-zone-note">
          {ECO_EMPLOYEE_ZONES.find((item) => item.key === zone)?.note ?? "该行业数字员工正在准备。"}
        </div>
      );
    }

    const skin = employeeZoneSkin(zone);

    return (
      <>
        {zone === "通用" ? (
          <>
            <div className="eco-sec-head">
              <div>
                <h2>今天该用谁</h2>
                <div className="eco-sub">按老板日常节奏推荐入口；点一下直达对应数字员工。</div>
              </div>
            </div>
            <div className="eco-today">
              {TODAY_ITEMS.map((item) => {
                const employee = employeeByKey.get(item.employeeKey);
                return (
                  <button
                    key={item.employeeKey}
                    type="button"
                    className="eco-today-item"
                    onClick={() => employee && openEmployeeAt(employee, skin)}
                  >
                    <span>{item.title}</span>
                    <strong>{item.hint}</strong>
                  </button>
                );
              })}
            </div>
          </>
        ) : null}
        <div className="eco-sec-head">
          <div>
            <h2>数字员工团队{zone === "通用" ? "" : ` · ${zone}`}</h2>
          </div>
        </div>
        <div className="eco-grid">
          {ECO_EMPLOYEES.map((employee) => (
            <EmployeeCard
              key={`${zone}-${employee.key}`}
              employee={employee}
              status={employeeStatusForZone(employee, zone)}
              onOpen={() => openEmployeeAt(employee, skin)}
            />
          ))}
        </div>
      </>
    );
  }

  function renderSoftware(zone: EcoEmployeeZoneKey) {
    return (
      <div className="eco-zone-note">
        目前还没有不是数字员工的独立智能体，敬请期待。
      </div>
    );
  }

  function renderHardware(zone: EcoEmployeeZoneKey) {
    if (zone === "品牌工作台专区") {
      return <SoonShelf title="兰琪品牌工作台" subtitle="品牌工作台先看兰琪门店工作台，AI硬件后续接入。" pill="进入品牌工作台" />;
    }
    if (zone === "通用") {
      return <SoonShelf title="AI录音卡 · 即将接入" subtitle="录音即分析，自动转经营动作。硬件红利优先。" pill="规划中" />;
    }
    return <SoonShelf title={`${zone}专属 AI硬件 · 即将接入`} subtitle="该行业专属硬件正在准备。" pill="规划中" />;
  }

  function renderCourses(zone: EcoEmployeeZoneKey) {
    if (zone === "品牌工作台专区") {
      return <SoonShelf title="兰琪品牌工作台" subtitle="品牌工作台先看兰琪门店工作台，行业课程后续接入。" pill="进入品牌工作台" />;
    }
    if (zone === "通用") {
      return <SoonShelf title="智能体开发课程 · 即将上线" subtitle="从 0 到 1 学会搭建自己的数字员工与智能体工作流。" pill="规划中" />;
    }
    return <SoonShelf title={`${zone}专属 AI课程 · 即将上线`} subtitle="该行业专属课程正在准备。" pill="规划中" />;
  }

  function renderBrandWorkbench() {
    const lanqiModules: Array<{ name: string; desc: string; href: string; live?: boolean }> = [
      { name: "私域营销", desc: "朋友圈 / 社群内容自动生成与排期，兰琪门店正在用的一套。", href: "/lanqi/moments", live: true },
      { name: "经营驾驶舱", desc: "八板块总览，一屏看清门店经营健康度。", href: "/lanqi/brain", live: true },
      { name: "门店诊断", desc: "上传门店数据，AI 给出经营体检与改进动作。", href: "/lanqi/diagnosis", live: true },
      { name: "内容工作室", desc: "选题 / 脚本 / 标题一站式产出，带品牌语气。", href: "/lanqi/content-studio", live: true },
      { name: "AI 绘图", desc: "品牌风格化的图片与海报，一键出图。", href: "/lanqi/image-studio", live: true },
      { name: "公域获客", desc: "短视频 / 直播获客内容矩阵搭建。", href: "/lanqi/acquire", live: true }
    ];
    return (
      <>
        <div className="eco-sec-head">
          <div>
            <h2>兰琪美业 · 数字员工工作台（演示）</h2>
            <div className="eco-sub">这是思潼AI 为兰琪美业落地的品牌专属工作台实景。点任意模块即可进入体验。</div>
            <a className="eco-home-link" href={getAppPath("/lanqi")}>进入兰琪 demo 首页 ›</a>
          </div>
        </div>
        <div className="eco-mod-grid">
          {lanqiModules.map((m) => (
            <button
              key={m.href}
              type="button"
              className="eco-mod"
              onClick={() => { window.location.href = getAppPath(m.href); }}
            >
              <div className="eco-mod-name">{m.name}</div>
              <div className="eco-mod-desc">{m.desc}</div>
              <div className="eco-mod-go">进入体验 ›</div>
            </button>
          ))}
        </div>
      </>
    );
  }

  return (
    <main className="app-wrap eco-mall-page">
      <Topbar active="market" balance={balance} onNavigate={(path) => { window.location.href = getAppPath(path); }} />

      <section className="eco-mall">
        <div className="eco-hero">
          <span className="eco-kicker">● 思潼AI</span>
          <h1>跟 AI 有关的，都在这</h1>
          <p>数字员工帮你把活干完，数字咨询师给你真人级判断，硬件和课程让 AI 落到店里。</p>
        </div>

        <nav className="eco-nav" aria-label="顶层板块切换">
          <div className="eco-nav-row">
            {TOP_SECTIONS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={section === item.key ? "active" : ""}
                onClick={() => {
                  setSection(item.key);
                  if (item.key !== "数字员工") setCategory("employees");
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </nav>

        <div className="eco-content">
          {section === "consultant" ? (
            <>
              <div className="eco-sec-head">
                <div>
                  <h2>数字咨询师（真人孪生）</h2>
                  <div className="eco-sub">先放保禄本人的数字分身，后续再接入其他咨询师。</div>
                </div>
              </div>
              <div className="eco-grid">
                {ECO_CONSULTANTS.map((consultant) => (
                  <ConsultantCard key={consultant.key} consultant={consultant} onOpen={() => setOpenConsultant(consultant)} />
                ))}
              </div>
            </>
          ) : section === "品牌工作台专区" ? (
            renderBrandWorkbench()
          ) : section === "智能体" ? (
            renderSoftware("通用")
          ) : section === "AI硬件" ? (
            renderHardware("通用")
          ) : section === "AI课程" ? (
            renderCourses("通用")
          ) : (
            <>{renderEmployees("通用")}</>
          )}
        </div>
      </section>

      {openEmployee ? (
        <EmployeeModal
          employee={openEmployee}
          initialSkin={openEmployeeSkin}
          onClose={() => setOpenEmployee(null)}
        />
      ) : null}
      {openConsultant ? <ConsultantModal consultant={openConsultant} onClose={() => setOpenConsultant(null)} /> : null}
    </main>
  );
}
