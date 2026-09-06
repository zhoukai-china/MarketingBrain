import { useMemo, useState } from "react";

type PrototypeView = "home" | "acquisition" | "xiaohongshu";

const NAV_ITEMS = [
  { label: "工作台首页", icon: "⌂", route: "/industry-prototype", view: "home" as const },
  { label: "美业AI改造日报", icon: "◫", status: "规划中" },
  { label: "美业知识问题", icon: "?", status: "规划中" },
  { label: "美业获客", icon: "↗", route: "/industry-prototype/acquisition", view: "acquisition" as const },
  { label: "美业销售", icon: "◎", status: "规划中" },
  { label: "美业专属交付", icon: "◇", status: "暂未开放" },
  { label: "美业专属经营诊断", icon: "⌁", status: "暂未开放" },
  { label: "成果与历史", icon: "▤", status: "规划中" },
  { label: "账户与MCP连接", icon: "⌘", status: "规划中" }
] as const;

const ACQUISITION_STAGES = [
  { index: "01", title: "获客目标", description: "先明确客群、目标与承接方式", state: "已规划" },
  { index: "02", title: "选题", description: "围绕顾客问题建立内容选题", state: "已规划" },
  { index: "03", title: "内容生产", description: "图文、脚本与视觉素材", state: "原型可看", active: true },
  { index: "04", title: "投流与发布准备", description: "只做预算与发布前检查", state: "规划中" },
  { index: "05", title: "直播获客", description: "话术、节奏与承接设计", state: "规划中" },
  { index: "06", title: "数据复盘", description: "视频复盘与直播复盘", state: "规划中" }
] as const;

const XHS_VARIANTS = [
  {
    eyebrow: "夏日轻盈护理",
    title: "把夏天的疲惫，留在门外",
    body: "闷热的午后，给自己留一段安静时间。\n\n从基础清洁到舒适补水，我们更关注每一次护理里的感受与节奏。具体项目、适用情况和预约方式，请以门店确认信息为准。",
    tags: ["#夏日护理", "#生活美容", "#到店体验", "#日常皮肤管理", "#城市生活"]
  },
  {
    eyebrow: "门店日常记录",
    title: "认真生活的人，也值得被认真照顾",
    body: "一间让人慢下来的护理空间，不需要夸张承诺。\n\n干净、克制、舒适，是我们希望每位到店顾客感受到的日常。服务内容与预约时间仍需结合本店已确认资料。",
    tags: ["#门店日常", "#生活美容", "#皮肤管理", "#松弛感", "#到店护理"]
  },
  {
    eyebrow: "周末松弛计划",
    title: "周末两小时，重新找回自己的节奏",
    body: "忙完一周，不妨把注意力重新放回自己。\n\n用一次基础护理开启周末，让空间、光线和专业服务共同营造安心感。所有效果、价格与项目细节均需门店进一步确认。",
    tags: ["#周末计划", "#生活方式", "#护理日常", "#美业门店", "#自我照顾"]
  }
] as const;

export function IndustryWorkbenchPrototypePage() {
  const view = resolveView(window.location.pathname);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return <main className="industryPrototype" data-prototype-view={view}>
    <PrototypeTopbar onMenu={() => setMobileNavOpen((value) => !value)} />
    <div className="industryPrototypeBody">
      <PrototypeSidebar view={view} mobileOpen={mobileNavOpen} onNavigate={() => setMobileNavOpen(false)} />
      <section className="industryPrototypeMain">
        {view === "home" && <PrototypeHome />}
        {view === "acquisition" && <PrototypeAcquisition />}
        {view === "xiaohongshu" && <PrototypeXiaohongshu />}
      </section>
    </div>
  </main>;
}

function PrototypeTopbar({ onMenu }: { onMenu: () => void }) {
  return <header className="industryPrototypeTopbar">
    <div className="industryPrototypeIdentity">
      <button className="industryPrototypeMenu" type="button" onClick={onMenu} aria-label="打开导航">☰</button>
      <span className="industryPrototypeLogo" aria-hidden="true">美</span>
      <div><strong>美业智能体</strong><small>企业经营工作台 · 页面原型</small></div>
    </div>
    <div className="industryPrototypeContext">
      <button className="industryPrototypeStore" type="button" disabled><span>当前经营主体</span><strong>示例生活美容门店</strong><em>合成示例</em></button>
      <div className="industryPrototypeCredits"><span>积分余额</span><strong>2,680</strong><em>原型展示</em></div>
      <button className="industryPrototypeTopAction" type="button" disabled>连接 WorkBuddy <span>规划中</span></button>
      <button className="industryPrototypeAvatar" type="button" disabled aria-label="用户中心，规划中">林</button>
    </div>
  </header>;
}

function PrototypeSidebar({ view, mobileOpen, onNavigate }: { view: PrototypeView; mobileOpen: boolean; onNavigate: () => void }) {
  return <aside className={`industryPrototypeSidebar ${mobileOpen ? "isOpen" : ""}`}>
    <div className="industryPrototypeBadge"><span>PROTOTYPE 01</span><strong>行业模板演示</strong><p>只确认版面，不调用AI或后端</p></div>
    <nav aria-label="行业智能体导航">
      {NAV_ITEMS.map((item) => {
        const active = "view" in item && (item.view === view || (item.view === "acquisition" && view === "xiaohongshu"));
        return "route" in item
          ? <button key={item.label} type="button" className={active ? "active" : ""} onClick={() => { onNavigate(); navigatePrototype(item.route); }}><span className="navIcon">{item.icon}</span><span>{item.label}</span>{active && <i />}</button>
          : <button key={item.label} type="button" disabled><span className="navIcon">{item.icon}</span><span>{item.label}</span><em>{item.status}</em></button>;
      })}
    </nav>
    <div className="industryPrototypeSideNote"><span>本轮边界</span><p>销售、交付、诊断等模块仅展示规划位置，不提供假功能。</p></div>
  </aside>;
}

function PrototypeHome() {
  return <div className="industryPrototypePage">
    <PrototypeBreadcrumb current="工作台首页" />
    <section className="industryPrototypeWelcome">
      <div><span className="industryPrototypeKicker">早上好，经营者</span><h1>今天，先把最重要的经营动作做完</h1><p>这里不是复杂的技术后台，而是按经营结果组织的行业工作台。当前以获客作为首个演示板块。</p><div className="industryPrototypeHeroActions"><button type="button" onClick={() => navigatePrototype("/industry-prototype/acquisition")}>进入美业获客 <span>→</span></button><button type="button" disabled>查看美业日报 <small>规划中</small></button></div></div>
      <aside><span>今日建议</span><strong>先确定本周的核心获客主题</strong><p>围绕一个明确顾客问题，完成选题、图文和发布准备。</p><button type="button" onClick={() => navigatePrototype("/industry-prototype/xiaohongshu")}>开始小红书图文</button></aside>
    </section>

    <section className="industryPrototypeSnapshot">
      <article><span>本周重点</span><strong>获客内容打磨</strong><p>当前MVP</p></article>
      <article><span>待完成动作</span><strong>3</strong><p>合成示例</p></article>
      <article><span>已保存成果</span><strong>12</strong><p>原型展示</p></article>
      <article><span>AI工作状态</span><strong className="statusReady">可规划</strong><p>未连接后端</p></article>
    </section>

    <section className="industryPrototypeSection">
      <div className="industryPrototypeSectionHead"><div><span className="industryPrototypeKicker">经营能力</span><h2>按企业经营结果进入工作</h2></div><p>已开放与规划中状态清晰分开，不让空壳按钮干扰决策。</p></div>
      <div className="industryPrototypeModules">
        <button className="moduleFeatured" type="button" onClick={() => navigatePrototype("/industry-prototype/acquisition")}><span className="moduleIcon">↗</span><em>当前MVP</em><h3>美业获客</h3><p>从获客目标、选题、内容生产，到投流准备、直播和数据复盘。</p><strong>进入板块 <span>→</span></strong></button>
        {[
          ["◎", "美业销售", "线索跟进、需求判断与成交协同", "规划中"],
          ["◇", "美业专属交付", "围绕美业服务流程组织交付", "暂未开放"],
          ["⌁", "美业专属经营诊断", "基于真实经营资料定位问题", "暂未开放"],
          ["◫", "美业AI改造日报", "每天看清AI改造进度与结果", "规划中"],
          ["?", "美业知识问题", "基于美业知识与企业资料答疑", "规划中"]
        ].map(([icon, title, text, status]) => <article key={title}><span className="moduleIcon">{icon}</span><em>{status}</em><h3>{title}</h3><p>{text}</p></article>)}
      </div>
    </section>
  </div>;
}

function PrototypeAcquisition() {
  return <div className="industryPrototypePage">
    <PrototypeBreadcrumb current="美业获客" />
    <section className="industryPrototypePageHero"><div><span className="industryPrototypeKicker">ACQUISITION</span><h1>把获客做成一条清楚的经营链路</h1><p>先确认目标，再生产内容；投流、发布和复盘都建立在真实资料与明确确认之上。</p></div><aside><span>当前进度</span><strong>第 3 步 · 内容生产</strong><div><i /><i /><i className="active" /><i /><i /><i /></div></aside></section>

    <section className="industryPrototypeStages" aria-label="获客流程">
      {ACQUISITION_STAGES.map((stage) => <article key={stage.index} className={("active" in stage && stage.active) ? "active" : ""}><span>{stage.index}</span><div><h2>{stage.title}</h2><p>{stage.description}</p></div><em>{stage.state}</em></article>)}
    </section>

    <section className="industryPrototypeSection">
      <div className="industryPrototypeSectionHead"><div><span className="industryPrototypeKicker">当前阶段</span><h2>内容生产</h2></div><p>先看三张确认页面；没有真实能力的媒体入口只标注状态。</p></div>
      <div className="industryPrototypeContentGrid">
        <button className="contentPrimary" type="button" onClick={() => navigatePrototype("/industry-prototype/xiaohongshu")}><span>图文</span><em>本轮原型</em><h3>小红书图文</h3><p>一次输入需求，在同一任务里查看标题、正文、标签和配图示例。</p><strong>打开页面 <b>→</b></strong></button>
        <article><span>脚本</span><em>规划中</em><h3>短视频文案 / 拍摄脚本</h3><p>围绕门店内容目标组织口播、镜头与拍摄清单。</p></article>
        <article><span>图片</span><em>暂未开放</em><h3>图片生成</h3><p>需完成真实模型、存储、授权和计费验收后开放。</p></article>
        <article><span>视频</span><em>暂未开放</em><h3>文生视频 / 图生视频</h3><p>当前没有可用主链，不展示生成按钮或模板结果。</p></article>
      </div>
    </section>

    <section className="industryPrototypePlanRow">
      <article><span>下一阶段</span><h3>投流与发布准备</h3><p>预算、素材、审核风险与发布清单，只做预览，不自动执行。</p><button type="button" disabled>规划中</button></article>
      <article><span>下一阶段</span><h3>直播获客</h3><p>围绕直播主题、话术节奏与到店承接组织获客动作。</p><button type="button" disabled>规划中</button></article>
    </section>

    <section className="industryPrototypeReviewBlock" aria-labelledby="industry-review-title">
      <div className="industryPrototypeReviewHead"><div><span className="industryPrototypeKicker">经营闭环</span><h2 id="industry-review-title">数据复盘</h2></div><p>沿用同一个复盘阶段，按内容形态拆成两个并列入口，避免一级流程过长。</p></div>
      <div className="industryPrototypeReviewGrid">
        <article><span>短视频内容</span><h3>视频数据复盘</h3><p>基于真实播放、停留、互动、咨询与到店数据，判断选题和内容怎么调整。</p><button type="button" disabled>规划中</button></article>
        <article><span>直播获客</span><h3>直播数据复盘</h3><p>基于真实观看、停留、互动、咨询、预约与到店数据，复盘直播节奏和承接。</p><button type="button" disabled>规划中</button></article>
      </div>
    </section>
  </div>;
}

function PrototypeXiaohongshu() {
  const initial = useMemo(() => {
    try { return JSON.parse(localStorage.getItem("industry_prototype_xhs_draft") ?? "null") as { brief?: string; audience?: string; variant?: number } | null; } catch { return null; }
  }, []);
  const [brief, setBrief] = useState(initial?.brief ?? "为夏季基础补水护理做一篇温柔、克制的小红书图文，不出现顾客正脸，不写疗效和优惠价格。");
  const [audience, setAudience] = useState(initial?.audience ?? "附近希望放松和进行日常皮肤管理的女性顾客");
  const [variantIndex, setVariantIndex] = useState(initial?.variant ?? 0);
  const [selectedTitle, setSelectedTitle] = useState(0);
  const [imageCount, setImageCount] = useState(3);
  const [selectedImage, setSelectedImage] = useState(0);
  const [notice, setNotice] = useState("合成示例已加载；本页不会调用AI或扣除积分。");
  const variant = XHS_VARIANTS[variantIndex % XHS_VARIANTS.length];
  const titles = [variant.title, "夏日护理，也可以很轻盈", "给忙碌生活留一段安静时间"];
  const imagePages = [
    { type: "封面图", eyebrow: variant.eyebrow, title: titles[selectedTitle] },
    { type: "内容图", eyebrow: "护理氛围", title: "干净、克制、舒适" },
    { type: "互动承接图", eyebrow: "互动引导", title: "你更喜欢哪种护理体验？" }
  ].slice(0, imageCount);
  const activeImage = imagePages[Math.min(selectedImage, imagePages.length - 1)];

  function saveDraft() {
    localStorage.setItem("industry_prototype_xhs_draft", JSON.stringify({ brief, audience, variant: variantIndex }));
    setNotice("原型草稿已保存在本机浏览器；没有上传任何资料。");
  }

  async function copyAll() {
    const content = `${titles[selectedTitle]}\n\n${variant.body}\n\n${variant.tags.join(" ")}`;
    try { await navigator.clipboard.writeText(content); setNotice("合成示例文字已复制。"); }
    catch { setNotice("浏览器未允许复制；这是原型权限反馈，不会改用其他方式读取剪贴板。"); }
  }

  function downloadCover() {
    const safeTitle = titles[selectedTitle].replace(/[<>&]/g, "");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#efe9df"/><stop offset="1" stop-color="#8fb8aa"/></linearGradient></defs><rect width="1080" height="1440" fill="url(#g)"/><circle cx="850" cy="260" r="230" fill="#fff" fill-opacity=".24"/><text x="90" y="170" font-size="34" fill="#345d52">页面原型 · 合成示例</text><text x="90" y="950" font-size="64" font-weight="700" fill="#173f36">${safeTitle}</text><text x="90" y="1040" font-size="32" fill="#345d52">美业智能体</text></svg>`;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "美业小红书页面原型-合成示例.svg"; anchor.click(); URL.revokeObjectURL(url);
    setNotice("已下载带“页面原型”标识的合成示例 SVG，不是真实AI图片。");
  }

  return <div className="industryPrototypePage prototypeXhsPage">
    <PrototypeBreadcrumb current="美业获客 / 小红书图文" />
    <section className="prototypeXhsHeader"><div><span className="industryPrototypeKicker">CONTENT STUDIO</span><h1>小红书图文</h1><p>统一任务布局：一次输入，在同一页完成文字与视觉结果的查看和调整。</p></div><div className="prototypeNotice"><strong>页面原型</strong><span>合成示例 · 零后端请求 · 零积分消耗</span></div></section>

    <section className="prototypeXhsWorkspace">
      <aside className="prototypeXhsComposer">
        <div className="prototypePanelTitle"><span>01</span><div><h2>输入需求与资料</h2><p>只填写本次创作需要的信息</p></div></div>
        <label>这次想做什么？<textarea rows={6} value={brief} onChange={(event) => setBrief(event.target.value)} /></label>
        <label>目标顾客<input value={audience} onChange={(event) => setAudience(event.target.value)} /></label>
        <div className="prototypeFieldRow"><label>用途<select defaultValue="xhs"><option value="xhs">小红书日常内容</option><option value="event">门店活动预告</option></select></label><label>画幅<select defaultValue="3:4"><option>3:4</option><option>1:1</option><option>4:3</option></select></label></div>
        <label>配图数量<select value={imageCount} onChange={(event) => { setImageCount(Number(event.target.value)); setSelectedImage(0); }}><option value={1}>1 张</option><option value={3}>3 张（推荐）</option></select></label>
        <div className="prototypeFieldRow"><label>视觉风格<select defaultValue="soft"><option value="soft">温柔高级</option><option value="real">自然真实</option><option value="clean">清爽克制</option></select></label><label>人物授权<select defaultValue="none"><option value="none">不出现真人</option><option value="authorized">仅授权人物</option></select></label></div>
        <div className="prototypeFactBox"><strong>资料边界</strong><p>当前为品牌中立合成示例；门店服务、价格、疗效、案例与真实场景均未作为事实使用。</p></div>
        <button className="prototypeGenerate" type="button" disabled={brief.trim().length < 6} onClick={() => { setVariantIndex((value) => (value + 1) % XHS_VARIANTS.length); setNotice("已切换一组合成示例；没有调用模型或产生费用。"); }}>生成小红书图文 <span>原型演示</span></button>
      </aside>

      <section className="prototypeXhsResult">
        <div className="prototypePanelTitle"><span>02</span><div><h2>图文结果</h2><p>合成示例，不是AI生成结果</p></div><em>草稿</em></div>
        <div className="prototypeResultGrid">
          <div className="prototypeCopyResult">
            <section><span>标题候选</span><div className="prototypeTitles">{titles.map((title, index) => <button key={title} type="button" className={selectedTitle === index ? "active" : ""} onClick={() => setSelectedTitle(index)}><i>{index + 1}</i><strong>{title}</strong></button>)}</div></section>
            <section><span>正文</span><div className="prototypeBodyCopy">{variant.body.split("\n\n").map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div></section>
            <section><span>话题标签与互动承接</span><div className="prototypeTags">{variant.tags.map((tag) => <em key={tag}>{tag}</em>)}</div><p className="prototypeEngagement">你更喜欢清爽护理，还是偏向安静放松的体验？欢迎说说你的日常习惯。</p></section>
          </div>
          <div className="prototypeVisualResult">
            <div className="prototypeImageSummary"><strong>配套图片</strong><span>本次 {imagePages.length} 张 · 当前第 {selectedImage + 1} 张</span></div>
            <div className={`prototypeCover variant${(variantIndex + selectedImage) % 3}`}><span>{activeImage.eyebrow}</span><strong>{activeImage.title}</strong><p>美业智能体 · {activeImage.type} · 合成示例</p><em>页面原型</em></div>
            <div className="prototypeImageStrip" aria-label="配套图片列表">{imagePages.map((image, index) => <button key={image.type} type="button" className={selectedImage === index ? "active" : ""} onClick={() => setSelectedImage(index)}><i className={`variant${(variantIndex + index) % 3}`} /><span>{index + 1}</span><strong>{image.type}</strong></button>)}</div>
            <div className="prototypePromptDetail"><span>高级详情 / 调整图片</span><p>自然光、克制留白、柔和材质、无真人正脸；中文标题采用受控后期排版。</p><em>仅展示创作方向，不是独立任务。</em></div>
          </div>
        </div>
        <footer className="prototypeXhsActions"><span role="status">{notice}</span><div><button type="button" onClick={() => setNotice("请在左侧修改需求；当前结果仍保留。")}>修改需求</button><button type="button" onClick={() => { setVariantIndex((value) => (value + 1) % XHS_VARIANTS.length); setNotice("已重新组合合成示例；没有调用模型。"); }}>重新生成</button><button type="button" onClick={() => void copyAll()}>复制全部文字</button><button type="button" onClick={downloadCover}>下载当前图</button><button className="primary" type="button" onClick={saveDraft}>保存草稿</button></div></footer>
      </section>
    </section>
  </div>;
}

function PrototypeBreadcrumb({ current }: { current: string }) {
  return <div className="industryPrototypeBreadcrumb"><span>美业智能体</span><i>/</i><strong>{current}</strong><em>页面原型</em></div>;
}

function resolveView(pathname: string): PrototypeView {
  if (pathname.includes("/industry-prototype/xiaohongshu")) return "xiaohongshu";
  if (pathname.includes("/industry-prototype/acquisition")) return "acquisition";
  return "home";
}

function navigatePrototype(path: string) {
  const base = window.location.pathname.startsWith("/os-v2") ? "/os-v2" : "";
  window.location.href = `${base}${path}`;
}
