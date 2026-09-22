import { useEffect, useMemo, useState } from "react";
import { apiPath, getAppPath } from "../lib/api.js";
import { fetchMarketMe, readJson, Topbar } from "./shell.js";
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

type FloorId = "floor-employees" | "floor-consultants" | "floor-hardware" | "floor-courses" | "floor-brand";

const KINGKONG: Array<{ floor: FloorId; label: string; icon: string; tint: string }> = [
  { floor: "floor-employees", label: "数字员工", icon: "👥", tint: "244, 121, 32" },
  { floor: "floor-consultants", label: "数字咨询师", icon: "🧭", tint: "64, 123, 240" },
  { floor: "floor-hardware", label: "AI硬件", icon: "🔌", tint: "14, 159, 110" },
  { floor: "floor-courses", label: "AI课程", icon: "🎓", tint: "151, 82, 220" },
  { floor: "floor-brand", label: "品牌工作台", icon: "🏪", tint: "232, 163, 61" }
];

const TODAY_ITEMS: Array<{ title: string; hint: string; employeeKey: string }> = [
  { title: "今天要发内容", hint: "让金牌文案主笔直接给你一条能念的稿", employeeKey: "copywriter" },
  { title: "周一起号 / 定方向", hint: "让首席定位官先定人设，再排内容", employeeKey: "ip-position" },
  { title: "刚直播完 / 发了视频", hint: "让流量诊断官或直播复盘导师帮你复盘", employeeKey: "video-diag" }
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

  return (
    <article
      className={`eco-product ${ok ? "is-ok" : "is-dev"}`}
      style={{ animationDelay: `${Math.min(index, 9) * 40}ms` }}
      onClick={onOpen}
    >
      <div className="eco-p-img">
        <EcoAvatar icon={employee.icon} img={employeeImagePath(employee)} />
        <span className={`eco-badge ${ok ? "ok" : "dev"}`}>{ok ? "可用" : "开发中"}</span>
      </div>
      <div className="eco-p-body">
        <div className="eco-p-name">{employeePersonaLabel(employee.capability)}</div>
        <div className="eco-p-shop">{employee.role} · 数字员工</div>
        <p className="eco-p-desc">{hook}</p>
        {deliver ? (
          <div className="eco-p-tags">
            <span className="eco-p-tag">{deliver}</span>
          </div>
        ) : null}
        <div className="eco-p-buy">
          {ok ? (
            <>
              <span className="eco-p-price">
                {ppu != null ? (
                  <>
                    <b>{ppu}</b>
                    <span className="eco-p-unit">积分/次</span>
                  </>
                ) : (
                  <span className="eco-p-price-flex">按次计费</span>
                )}
              </span>
              <button type="button" className="eco-p-btn">去使用</button>
            </>
          ) : (
            <span className="eco-p-soon">即将上线</span>
          )}
        </div>
      </div>
    </article>
  );
}

/** 占位商品卡：AI 硬件 / AI 课程等还没上架的货架位。 */
function GhostProduct({ icon, name, desc }: { icon: string; name: string; desc: string }) {
  return (
    <div className="eco-product eco-ghost">
      <div className="eco-p-img">
        <EcoAvatar icon={icon} img="" />
        <span className="eco-badge dev">待上架</span>
      </div>
      <div className="eco-p-body">
        <div className="eco-p-name">{name}</div>
        <p className="eco-p-desc">{desc}</p>
        <div className="eco-p-buy">
          <span className="eco-p-soon">即将上架</span>
        </div>
      </div>
    </div>
  );
}

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
              <span className="eco-m-val eco-m-price"><b>{ppu}</b> 积分/次</span>
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
  const [activeFloor, setActiveFloor] = useState<FloorId>("floor-employees");
  const [balance, setBalance] = useState<number | null>(null);
  const [skuPpu, setSkuPpu] = useState<Map<string, number> | null>(null);
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

  /* 货架价目表：/market/skus 的 ppu（积分/次），商品卡和详情弹窗都从这取真实价格。 */
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

  const okEmployees = useMemo(
    () => ECO_EMPLOYEES.filter((employee) => employee.status === "ok"),
    []
  );
  const devEmployees = useMemo(
    () => ECO_EMPLOYEES.filter((employee) => employee.status !== "ok"),
    []
  );

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
          onOpen={() => openEmployeeAt(employee, "通用")}
        />
      );
    });
  }

  function renderTodayStrip() {
    return (
      <div className="eco-today-strip">
        <div className="eco-floor-head">
          <div className="eco-floor-title">
            <h2>今天该用谁</h2>
          </div>
          <div className="eco-floor-sub">按老板日常节奏推荐入口；点一下直达对应数字员工。</div>
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

  function renderBrandFloor() {
    return (
      <section className="eco-floor" id="floor-brand">
        <FloorHead no="F5" title="品牌工作台" sub="兰琪品牌 demo 实景：门店 AI 工作台一整套的样子，点进去直接体验。" />
        <button
          type="button"
          className="eco-mod eco-mod-hero"
          onClick={() => { window.location.href = getAppPath("/lanqi"); }}
        >
          <div className="eco-mod-name">兰琪品牌 demo</div>
          <div className="eco-mod-desc">
            朋友圈 / 社群内容、经营驾驶舱、门店诊断、内容工作室、AI 绘图、公域获客——兰琪门店正在用的完整工作台，进去就能点。
          </div>
          <div className="eco-mod-go">进入 demo ›</div>
        </button>
      </section>
    );
  }

  return (
    <main className="app-wrap eco-mall-page">
      <Topbar active="market" balance={balance} onNavigate={(path) => { window.location.href = getAppPath(path); }} />

      <section className="eco-mall">
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
              placeholder="搜索商品：文案、定位、直播复盘…"
              aria-label="搜索商城商品"
            />
            {searching ? (
              <button type="button" className="eco-search-clear" onClick={() => setQuery("")} aria-label="清空搜索">×</button>
            ) : null}
          </div>
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
            <nav className="eco-kingkong" aria-label="商城楼层导航">
              {KINGKONG.map((item) => (
                <button
                  key={item.floor}
                  type="button"
                  className={`eco-kk-item ${activeFloor === item.floor ? "active" : ""}`}
                  onClick={() => scrollToFloor(item.floor)}
                >
                  <span className="eco-kk-ico" style={{ background: `rgba(${item.tint}, 0.14)`, borderColor: `rgba(${item.tint}, 0.32)` }}>
                    {item.icon}
                  </span>
                  <span className="eco-kk-label">{item.label}</span>
                </button>
              ))}
            </nav>

            <div className="eco-banner">
              <div className="eco-banner-text">
                <b>数字员工团队已就位</b>
                <span>文案、定位、复盘…挑一位立即开工，按次计积分</span>
              </div>
              <a className="eco-banner-link" href={getAppPath("/recharge")}>积分充值 ›</a>
            </div>

            {renderTodayStrip()}

            <section className="eco-floor" id="floor-employees">
              <FloorHead no="F1" title="数字员工" sub="点商品卡看详情；「可用」的商品点进去直接用。" />
              <div className="eco-products">
                {renderEmployeeProducts(okEmployees, "ok")}
              </div>
              {devEmployees.length > 0 ? (
                <>
                  <div className="eco-divider"><span>即将上线</span></div>
                  <div className="eco-products">
                    {renderEmployeeProducts(devEmployees, "dev")}
                  </div>
                </>
              ) : null}
            </section>

            <section className="eco-floor" id="floor-consultants">
              <FloorHead no="F2" title="数字咨询师 · 真人孪生" sub="把真人的方法论装进数字分身，给你真人级判断。" />
              <div className="eco-products">
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
              <FloorHead no="F3" title="AI 硬件" sub="让 AI 落到店里的硬件货架，陆续上架。" />
              <div className="eco-products">
                <GhostProduct icon="🎙️" name="AI 录音卡" desc="录音即分析，自动转经营动作。硬件红利优先。" />
                <GhostProduct icon="📹" name="AI 客流摄像头" desc="到店客流自动统计，会员到店自动识别。" />
                <GhostProduct icon="🔊" name="门店 AI 音箱" desc="常用话术语音随叫随到，前台接待不冷场。" />
              </div>
            </section>

            <section className="eco-floor" id="floor-courses">
              <FloorHead no="F4" title="AI 课程" sub="从 0 到 1 学会用 AI 干活，行业打法一套跑通。" />
              <div className="eco-products">
                <GhostProduct icon="🎓" name="智能体开发课" desc="从 0 到 1 学会搭建自己的数字员工与智能体工作流。" />
                <GhostProduct icon="🎬" name="行业起号实操课" desc="按行业拆解：人设、选题、内容到转化全链路。" />
              </div>
            </section>

            {renderBrandFloor()}
          </>
        )}
      </section>

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
