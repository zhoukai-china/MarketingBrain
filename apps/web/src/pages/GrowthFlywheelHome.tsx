import { useMemo, useState } from "react";
import sitongChiefAvatar from "../assets/sitong-beauty.png";
import {
  diagnosisModes,
  membershipOffers,
  quickDiagnosisCategories,
  type DiagnosisMode,
  type QuickDiagnosisCategory
} from "../data/growthFlywheel";

function openDiagnosis(mode: DiagnosisMode, category?: QuickDiagnosisCategory) {
  const params = new URLSearchParams({ mode });
  if (category) params.set("category", category);
  window.location.href = `/diagnosis?${params.toString()}`;
}

function openWorkspace() {
  window.location.href = "/workbench";
}

export function GrowthFlywheelHome() {
  const [showDiagnosisPicker, setShowDiagnosisPicker] = useState(false);
  const [quickCategory, setQuickCategory] = useState<QuickDiagnosisCategory>("short_video_ip");
  const hasWorkspace = useMemo(() => Boolean(localStorage.getItem("store_os_token")), []);

  return (
    <div className="flywheelHome">
      {hasWorkspace && (
        <button className="workspaceShortcut" onClick={openWorkspace}>
          我的工作台
        </button>
      )}

      <header className="flywheelHero">
        <nav className="flywheelTopline" aria-label="产品入口">
          <button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
            思潼AI 行业智能体平台
          </button>
          <button onClick={() => window.location.href = "#plans"}>积分使用</button>
        </nav>

        <div className="heroGrid">
          <section className="heroCopy" aria-labelledby="home-title">
            <p className="flywheelEyebrow">先体检，再行动</p>
            <h1 id="home-title">思潼AI 行业智能体平台</h1>
            <p className="heroLead">
              先做一次免费的经营AI体检，看清获客、成交、团队、营收里的关键问题；需要继续落地时，思潼再陪你生成方案、拆任务、做复盘。
            </p>
            <button className="heroDiagnosisButton" onClick={() => setShowDiagnosisPicker(true)}>
              免费企业经营AI诊断
            </button>
            <div className="heroAssurances" aria-label="诊断说明">
              <span>免费诊断</span>
              <span>免费报告</span>
              <span>不限次数</span>
            </div>
          </section>

          <aside className="sitongReception" aria-label="思潼">
            <img src={sitongChiefAvatar} alt="思潼" />
            <div>
              <span>AI经营顾问</span>
              <strong>思潼</strong>
              <p>你好，我是思潼。先陪你做一次经营体检，帮你看清当前最需要处理的卡点。</p>
            </div>
          </aside>
        </div>
      </header>

      <main>
        <section className="workflowBand" aria-label="服务流程">
          {["经营信息采集", "AI经营诊断", "输出诊断报告", "定制改善方案", "分步落地执行", "周期复盘迭代"].map((step, index) => (
            <article key={step}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{step}</strong>
            </article>
          ))}
        </section>

        <section className="freeDiagnosisBand">
          <div className="sectionHeading">
            <p className="flywheelEyebrow">双模式免费诊断</p>
            <h2>先免费看清问题，再决定下一步</h2>
          </div>
          <div className="diagnosisModeGrid">
            {diagnosisModes.map((mode) => (
              <article key={mode.id} className="diagnosisModeCard">
                <span>{mode.duration}</span>
                <h3>{mode.title}</h3>
                <p>{mode.subtitle}</p>
                <dl>
                  <div>
                    <dt>适合谁</dt>
                    <dd>{mode.audience}</dd>
                  </div>
                  <div>
                    <dt>你会得到</dt>
                    <dd>{mode.output}</dd>
                  </div>
                </dl>
                <button
                  onClick={() => {
                    if (mode.id === "quick") {
                      setShowDiagnosisPicker(true);
                      return;
                    }
                    openDiagnosis("deep");
                  }}
                >
                  {mode.cta}
                </button>
              </article>
            ))}
          </div>
        </section>

        <section id="plans" className="plansBand">
          <div className="sectionHeading">
            <p className="flywheelEyebrow">积分使用</p>
            <h2>不收月费，按实际调用扣积分</h2>
          </div>
          <div className="plansGrid">
            {membershipOffers.map((plan) => (
              <article key={plan.code} className={plan.highlighted ? "planCard featured" : "planCard"}>
                {plan.highlighted && <span className="planTag">推荐</span>}
                <h3>{plan.name}</h3>
                <p>{plan.audience}</p>
                <strong>不收月费</strong>
                <ul>
                  {plan.benefits.map((benefit) => (
                    <li key={benefit}>{benefit}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>
      </main>

      <div className="bottomDock" aria-label="固定入口">
        <button onClick={() => window.location.href = "/workbench#solutions"}>我的方案</button>
        <button onClick={() => window.location.href = "/workbench"}>思潼顾问</button>
        <button onClick={() => window.location.href = "/workbench#support"}>人工客服咨询</button>
      </div>

      {showDiagnosisPicker && (
        <div className="diagnosisPickerLayer" role="dialog" aria-modal="true" aria-label="选择诊断模式">
          <section className="diagnosisPicker">
            <button className="modalClose" onClick={() => setShowDiagnosisPicker(false)} aria-label="关闭">
              ×
            </button>
            <p className="flywheelEyebrow">选择免费诊断模式</p>
            <h2>你想先体检哪一种经营问题？</h2>
            <div className="pickerCards">
              <article>
                <span>5-8分钟</span>
                <strong>单项快速诊断</strong>
                <p>适合先做一个专项访谈，看清具体问题，不限次数、不扣积分。</p>
                <div className="categoryChips" aria-label="选择单项诊断类目">
                  {quickDiagnosisCategories.map((item) => (
                    <button
                      key={item.id}
                      className={quickCategory === item.id ? "active" : ""}
                      onClick={() => setQuickCategory(item.id)}
                    >
                      {item.title}
                    </button>
                  ))}
                </div>
                <button className="primaryModalAction" onClick={() => openDiagnosis("quick", quickCategory)}>
                  开始单项快速诊断
                </button>
              </article>
              <article>
                <span>10分钟</span>
                <strong>全企业深度系统诊断</strong>
                <p>覆盖营收、获客、团队、门店运营、供应链、招商拓店六大板块。</p>
                <button className="primaryModalAction" onClick={() => openDiagnosis("deep")}>
                  开始全企业深度诊断
                </button>
              </article>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
