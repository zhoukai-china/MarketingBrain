// 由原型 ipai-franchise-demo-20261008.html **逐字转换**而来的 JSX（2026-10-09）
// 目的：把交付原型原样搬进系统，成为真页面（React 组件 + 真路由），而不是塞一份静态 HTML。
// 约定：
//   · 类名、结构、文案与原型完全一致（视觉由 styles/ipai-franchise.css 原样承载）
//   · onclick → data-act + onClick={onAct}，由页面组件用 React 处理器接管
//   · 原型中由 JS 动态渲染的列表（最近生成 / 定时任务 / 弹层 chips）改为 props 占位，由 React 渲染

import type { MouseEvent, ReactNode } from "react";

/** 原型 onclick 的统一接管器（由页面组件传入）。 */
export type OnAct = (e: MouseEvent<HTMLElement>) => void;

export function HeadMarkup({ onAct }: { onAct: OnAct }) {
  return (
    <>
      <header className="topbar">
      <div className="brand">⚡ 思潼<i>AI</i><span style={{fontSize: "10px", fontWeight: "700", color: "#3a2f12", background: "linear-gradient(135deg,#f3e2b8,#d8b878)", borderRadius: "6px", padding: "3px 7px", marginLeft: "8px", verticalAlign: "2px", letterSpacing: ".5px", whiteSpace: "nowrap"}}>招商加盟版</span></div>
      <div className="sp"></div>
      <div className="credits">⚡ 算力 <b id="creditNum">12,860</b></div>
      <button className="recharge" data-act="toast('演示环境 · 充值入口以线上为准')" onClick={onAct}>充值</button>
      </header>
    </>
  );
}

export function HomeMarkup({ rec, onAct }: { rec: ReactNode; onAct: OnAct }) {
  return (
    <section className="page act" id="page-home">
      <div className="card" id="painCard">
      <div className="card-h"><span className="h-ic">🧗</span>做招商正卡在三道坎</div>
      <div className="task">
      <div className="tk-ic">💸</div>
      <div className="tk-t"><b>招不到加盟商</b><span>招商团队贵、线索少、转化低；请代运营一年几十万，招不来几家，门店模型跑不出规模</span></div>
      </div>
      <div className="task">
      <div className="tk-ic">📉</div>
      <div className="tk-t"><b>加盟商存活低</b><span>招进来不会获客经营，开不久就关店，品牌口碑、续费、转介绍全受损</span></div>
      </div>
      <div className="task" style={{borderBottom: "0"}}>
      <div className="tk-ic">🏭</div>
      <div className="tk-t"><b>总部产能跟不上</b><span>给几十上百家加盟商供内容、做培训、跟线索，靠人力扛不住，标准统一不了</span></div>
      </div>
      <div style={{marginTop: "11px", paddingTop: "10px", borderTop: "1px solid var(--grn-line)", fontSize: "13px", fontWeight: "800", color: "var(--grn)"}}>一队数字高管，替你把用IP招商与加盟裂变的闭环跑完</div>
      </div>
      <div className="mbar" id="mbar">
      <span className="mbar-badge">年卡 · 限时价</span>
      <div className="mbar-t"><b>IP+AI 业绩倍增系统 <span className="demo-badge">演示数据</span></b><span>¥49,800/年 · 基础 3 席位 · 9 位数字高管畅用 · 失败不扣</span></div>
      <button className="mbar-link" data-act="switchTab('me')" onClick={onAct}>权益 ›</button>
      </div>
      <div className="card" id="todayCard">
      <div className="card-h"><span className="h-ic">📍</span>今日招商任务 · 按场景直达<button className="more" data-act="switchTab('task')" onClick={onAct}>全部任务 ›</button></div>
      <div className="task" id="tk1">
      <div className="tk-ic">✍️</div>
      <div className="tk-t"><b>今天要发招商内容</b><span>让苏笺直接给你一条品牌招商朋友圈</span></div>
      <button className="mini-btn go" data-act="event.stopPropagation();openOrder('qinwen')" onClick={onAct}>派活</button>
      </div>
      <div className="task" id="tk2">
      <div className="tk-ic">🎯</div>
      <div className="tk-t"><b>招商定位还没想清</b><span>让庄衡先定「招什么商、对谁招」</span></div>
      <button className="mini-btn go" data-act="event.stopPropagation();openOrder('shending')" onClick={onAct}>派活</button>
      </div>
      <div className="task" id="tk3">
      <div className="tk-ic">📊</div>
      <div className="tk-t"><b>招商视频没水花</b><span>让程鉴诊断意向加盟商为什么划走、下条怎么调</span></div>
      <button className="mini-btn go" data-act="event.stopPropagation();openOrder('jiangliu')" onClick={onAct}>派活</button>
      </div>
      <div className="task" id="tk4">
      <div className="tk-ic">🎙️</div>
      <div className="tk-t"><b>周五要开招商直播</b><span>让祝鸣出一套照着念就能播的招商话术</span></div>
      <button className="mini-btn go" data-act="event.stopPropagation();openOrder('luopan')" onClick={onAct}>派活</button>
      </div>
      </div>
      <div className="card" id="recCard">
      <div className="card-h"><span className="h-ic">🌟</span>今日推荐数字高管 <span className="demo-badge">按本周节奏</span></div>
      {rec}
      </div>
      <div className="card" id="recentCard">
      <div className="card-h"><span className="h-ic">🗂️</span>最近生成 <button className="more" data-act="switchTab('me')" onClick={onAct}>全部记录 ›</button></div>
      <div className="gen-it" data-act="location.href=WB_FILE.qinwen" onClick={onAct}>
      <div className="gen-ic">✍️</div>
      <div className="gen-m"><b>苏笺 · 招商文案</b><span>品牌招商朋友圈 · 合伙人社群 1 条</span><span className="rc-t">今天 09:12 · 已扣 15 算力</span></div>
      <span className="gen-arrow">›</span>
      </div>
      <div className="gen-it" data-act="location.href=WB_FILE.luzhen" onClick={onAct}>
      <div className="gen-ic">🎬</div>
      <div className="gen-m"><b>甄映 · 文生视频</b><span>招商口播视频 · 15 秒竖版</span><span className="rc-t">昨天 16:40 · 已扣 120 算力</span></div>
      <span className="gen-arrow">›</span>
      </div>
      <div className="gen-it" data-act="location.href=WB_FILE.hece" onClick={onAct}>
      <div className="gen-ic">🗓️</div>
      <div className="gen-m"><b>金点 · 选题包</b><span>本周招商选题 3 条 · 已拍 1 条</span><span className="rc-t">10-04 · 已扣 99 算力</span></div>
      <span className="gen-arrow">›</span>
      </div>
      </div>
    </section>
  );
}

export function AgentsMarkup({ onAct }: { onAct: OnAct }) {
  return (
    <section className="page" id="page-agents">
      <div className="subtabs" id="agChips">
      <button className="on" data-tag="all" data-act="chipFilter('all',this)" onClick={onAct}>全部 9</button>
      <button data-tag="dingwei" data-act="chipFilter('dingwei',this)" onClick={onAct}>🎯 定位</button>
      <button data-tag="xuanti" data-act="chipFilter('xuanti',this)" onClick={onAct}>🗓️ 选题</button>
      <button data-tag="neirong" data-act="chipFilter('neirong',this)" onClick={onAct}>✍️ 内容</button>
      <button data-tag="zhibo" data-act="chipFilter('zhibo',this)" onClick={onAct}>🎙️ 直播</button>
      <button data-tag="siyu" data-act="chipFilter('siyu',this)" onClick={onAct}>🤝 转化</button>
      </div>
      <div className="group" id="g-ding" data-tags="dingwei">
      <div className="g-title">定位 · 先想明白对谁说 <span className="g-n">1 位在线</span></div>
      <div className="agent-grid">
      <div className="card agent" data-tag="dingwei">
      <div className="ag-top">
      <div className="ava b1">庄</div>
      <div className="ag-info"><b>庄衡</b><span className="ag-role">首席定位官 · 数字高管</span></div>
      <span className="live">🟢 在线</span>
      </div>
      <p className="ag-desc">先把你这个人想明白，再定「对谁说、说啥」。起号第一站，别上来就发。</p>
      <div className="ag-foot"><span className="price"><b>⚡99 算力</b>/份<i>≈¥9.9 · 0元开通·用后扣费</i></span><button className="mini-btn go" data-act="openOrder('shending')" onClick={onAct}>派活给他</button></div>
      </div>
      </div>
      </div>
      <div className="group" id="g-xuan" data-tags="xuanti">
      <div className="g-title" style={{marginTop: "14px"}}>选题 · 每天有得拍 <span className="g-n">1 位在线</span></div>
      <div className="agent-grid">
      <div className="card agent" data-tag="xuanti">
      <div className="ag-top">
      <div className="ava b5">金</div>
      <div className="ag-info"><b>金点</b><span className="ag-role">选题策略官 · 数字高管</span></div>
      <span className="live">🟢 在线</span>
      </div>
      <p className="ag-desc">每天给你 3–5 条带「三关筛选」标签、可直接开拍的选题。</p>
      <div className="ag-foot"><span className="price"><b>⚡99 算力</b>/次<i>≈¥9.9 · 0元开通·用后扣费</i></span><button className="mini-btn go" data-act="openOrder('hece')" onClick={onAct}>派活给他</button></div>
      </div>
      </div>
      </div>
      <div className="group" id="g-nei" data-tags="neirong">
      <div className="g-title" style={{marginTop: "14px"}}>内容 · 写文案 / 爆款复刻 / 文生视频 / 视频复盘 <span className="g-n">4 位在线</span></div>
      <div className="agent-grid">
      <div className="card agent" data-tag="neirong">
      <div className="ag-top">
      <div className="ava b2">苏</div>
      <div className="ag-info"><b>苏笺</b><span className="ag-role">金牌文案主笔 · 数字高管</span></div>
      <span className="live">🟢 在线</span>
      </div>
      <p className="ag-desc">你把卖点给我，我给你一条多平台适配、带钩子的可直发文案。</p>
      <div className="ag-foot"><span className="price"><b>⚡15 算力</b>/次<i>≈¥1.5 · 0元开通·用后扣费</i></span><button className="mini-btn go" data-act="openOrder('qinwen')" onClick={onAct}>派活给他</button></div>
      </div>
      <div className="card agent" data-tag="neirong">
      <div className="ag-top">
      <div className="ava b6">米</div>
      <div className="ag-info"><b>米临</b><span className="ag-role">爆款复刻 · 数字高管</span></div>
      <span className="live">🟢 在线</span>
      </div>
      <p className="ag-desc">给我一条对标的爆款，我拆它的结构、换上你的文案，照着火一遍。</p>
      <div className="ag-foot"><span className="price"><b>⚡70 算力</b>/次<i>≈¥7 · 0元开通·用后扣费</i></span><button className="mini-btn go" data-act="openOrder('gutu')" onClick={onAct}>派活给他</button></div>
      </div>
      <div className="card agent" data-tag="neirong">
      <div className="ag-top">
      <div className="ava b7">映</div>
      <div className="ag-info"><b>甄映</b><span className="ag-role">文生视频 · 数字高管</span></div>
      <span className="live">🟢 在线</span>
      </div>
      <p className="ag-desc">文案丢给我，竖版成片还给你：分镜、配音、大字字幕一条龙。</p>
      <div className="ag-foot"><span className="price"><b>⚡120 算力</b>/条<i>≈¥12 · 0元开通·用后扣费</i></span><button className="mini-btn go" data-act="openOrder('luzhen')" onClick={onAct}>派活给他</button></div>
      </div>
      <div className="card agent" data-tag="neirong">
      <div className="ag-top">
      <div className="ava b4">程</div>
      <div className="ag-info"><b>程鉴</b><span className="ag-role">流量诊断官 · 数字高管</span></div>
      <span className="live">🟢 在线</span>
      </div>
      <p className="ag-desc">给一条视频做数据复盘，告诉你为什么没爆、下条怎么调。</p>
      <div className="ag-foot"><span className="price"><b>⚡50 算力</b>/次<i>≈¥5 · 0元开通·用后扣费</i></span><button className="mini-btn go" data-act="openOrder('jiangliu')" onClick={onAct}>派活给他</button></div>
      </div>
      </div>
      </div>
      <div className="group" id="g-zhi" data-tags="zhibo">
      <div className="g-title" style={{marginTop: "14px"}}>直播 · 照着念就能播 <span className="g-n">1 位在线</span></div>
      <div className="agent-grid">
      <div className="card agent" data-tag="zhibo">
      <div className="ag-top">
      <div className="ava b3">祝</div>
      <div className="ag-info"><b>祝鸣</b><span className="ag-role">直播话术师 · 数字高管</span></div>
      <span className="live">🟢 在线</span>
      </div>
      <p className="ag-desc">给你一套可开播的逐字直播话术稿，照着念就上。</p>
      <div className="ag-foot"><span className="price"><b>⚡50 算力</b>/场<i>≈¥5 · 0元开通·用后扣费</i></span><button className="mini-btn go" data-act="openOrder('luopan')" onClick={onAct}>派活给他</button></div>
      </div>
      </div>
      </div>
      <div className="group" id="g-zhuan" data-tags="siyu">
      <div className="g-title" style={{marginTop: "14px"}}>转化 · 加盟商接住才叫增长 <span className="g-n">2 位在线</span></div>
      <div className="agent-grid">
      <div className="card agent" data-tag="siyu">
      <div className="ag-top">
      <div className="ava b8">温</div>
      <div className="ag-info"><b>温故</b><span className="ag-role">招商私域顾问 · 数字高管</span></div>
      <span className="live">🟢 在线</span>
      </div>
      <p className="ag-desc">给你一条能直接发的招商朋友圈，信任人设 + 业务价值 + 软引导，把意向加盟商引进社群。</p>
      <div className="ag-foot"><span className="price"><b>⚡5 算力</b>/条<i>≈¥0.5 · 0元开通·用后扣费</i></span><button className="mini-btn go" data-act="openOrder('zhouyu')" onClick={onAct}>派活给他</button></div>
      </div>
      <div className="card agent" data-tag="siyu">
      <div className="ag-top">
      <div className="ava b9">万</div>
      <div className="ag-info"><b>万契</b><span className="ag-role">招商成交官 · 数字高管</span></div>
      <span className="live">🟢 在线</span>
      </div>
      <p className="ag-desc">给一个招商场景的标准成交话术 + 异议处理，进线的意向加盟商都接得住。</p>
      <div className="ag-foot"><span className="price"><b>⚡25 算力</b>/次<i>≈¥2.5 · 0元开通·用后扣费</i></span><button className="mini-btn go" data-act="openOrder('yicheng')" onClick={onAct}>派活给他</button></div>
      </div>
      </div>
      </div>
    </section>
  );
}

export function TaskMarkup({ sched, onAct }: { sched: ReactNode; onAct: OnAct }) {
  return (
    <section className="page" id="page-task">
      <div className="card" id="threeCard">
      <div className="card-h"><span className="h-ic">✅</span>今日三事 · 全齐 +10 算力 <span className="demo-badge">演示数据</span></div>
      <div className="tk-prog">已打卡 <span id="tkDone">0</span>/3 <span className="bar"><i id="tkFill"></i></span></div>
      <div className="task" data-task>
      <div className="tk-ic">📤</div>
      <div className="tk-t"><b>发 1 条招商内容</b><span>没灵感？点右边让苏笺写一条</span></div>
      <button className="mini-btn go" data-act="event.stopPropagation();openOrder('qinwen')" onClick={onAct}>派苏笺</button>
      <span className="tk-done">✓</span>
      </div>
      <div className="task" data-task>
      <div className="tk-ic">💬</div>
      <div className="tk-t"><b>回 10 条意向加盟商私信</b><span>不知道怎么回？让万契给你话术</span></div>
      <button className="mini-btn go" data-act="event.stopPropagation();openOrder('yicheng')" onClick={onAct}>派万契</button>
      <span className="tk-done">✓</span>
      </div>
      <div className="task" data-task>
      <div className="tk-ic">📈</div>
      <div className="tk-t"><b>看 1 次数据复盘</b><span>把昨天那条招商视频丢给程鉴</span></div>
      <button className="mini-btn go" data-act="event.stopPropagation();openOrder('jiangliu')" onClick={onAct}>派程鉴</button>
      <span className="tk-done">✓</span>
      </div>
      <div style={{fontSize: "11px", color: "#98a4b0", marginTop: "10px"}}>点整行即可打卡 · 打卡奖励为演示口径</div>
      </div>
      <div className="card" id="weekCard">
      <div className="card-h"><span className="h-ic">🗓️</span>本周招商节奏 · 照着走就行</div>
      <div className="week">
      <div className="wd"><span>周一</span><b>定选题</b></div>
      <div className="wd"><span>周二</span><b>发视频</b></div>
      <div className="wd"><span>周三</span><b>追评论</b></div>
      <div className="wd"><span>周四</span><b>备直播</b></div>
      <div className="wd"><span>周五</span><b>开播</b></div>
      <div className="wd"><span>周六</span><b>做复盘</b></div>
      <div className="wd today"><span>周日</span><b>私域日</b></div>
      </div>
      <div className="play" style={{marginTop: "12px", borderTop: "1px solid var(--line)", paddingTop: "13px"}}>
      <div className="p-ic">🚀</div>
      <div className="tk-t"><b>还没起号？走「起号七步」</b><span>从定位到第一条招商爆款的最短路径，庄衡带队开工</span></div>
      <button className="mini-btn go" data-act="event.stopPropagation();openOrder('shending')" onClick={onAct}>开工</button>
      </div>
      <div className="play">
      <div className="p-ic">🗓️</div>
      <div className="tk-t"><b>每天不知道发什么？要「选题日历」</b><span>一周 7 天不发愁，金点每天给 3 条能直接拍的</span></div>
      <button className="mini-btn go" data-act="event.stopPropagation();openOrder('hece')" onClick={onAct}>去要</button>
      </div>
      <div className="play">
      <div className="p-ic">💬</div>
      <div className="tk-t"><b>意向加盟商进来了？做好「私域承接」</b><span>意向加盟商进来别冷场：温故写招商朋友圈，万契接签约</span></div>
      <button className="mini-btn go" data-act="event.stopPropagation();openOrder('zhouyu')" onClick={onAct}>接住</button>
      </div>
      <div style={{fontSize: "11px", color: "#98a4b0", marginTop: "10px"}}>节奏为演示示例 · 每个环节都有对应数字高管接单</div>
      </div>
      <div className="card" id="schedCard">
      <div className="card-h"><span className="h-ic">⏰</span>定时任务 · 到点自动干 <button className="more" data-act="openSched()" onClick={onAct}>管理 ›</button></div>
      <div className="sch">
      <span className="sch-when">每周一<br />09:00</span>
      <div className="tk-t"><b>金点 · 本周招商选题包</b><span>自动出 5 条招商选题 · 结果进增长台「最近生成」</span></div>
      <button className="tgl on" data-act="tglSch(this)" onClick={onAct}></button>
      </div>
      <div className="sch">
      <span className="sch-when">每天<br />20:00</span>
      <div className="tk-t"><b>温故 · 明日招商朋友圈</b><span>提前备好第二天那条 · 早上照发就行</span></div>
      <button className="tgl on" data-act="tglSch(this)" onClick={onAct}></button>
      </div>
      <div className="sch">
      <span className="sch-when">每周四<br />19:00</span>
      <div className="tk-t"><b>祝鸣 · 周五开播话术</b><span>周五晚场照着念就能播 · 扣字引导全安排</span></div>
      <button className="tgl" data-act="tglSch(this)" onClick={onAct}></button>
      </div>
      <div className="card-note">定时任务不打卡、不占「今日三事」名额 · 消耗算力按各数字高管单价 · 失败不扣（演示口径）</div>
      </div>
    </section>
  );
}

export function MeMarkup({ onAct }: { onAct: OnAct }) {
  return (
    <section className="page" id="page-me">
      <div className="card rights">
      <span className="r-tag">我的权益</span>
      <h3>IP+AI 业绩倍增系统 · 年卡（招商加盟版） <span className="demo-badge">演示数据</span></h3>
      <div className="r-sub">¥49,800/年 · 限时价 · 基础 3 席位 · 加 1 席位 +¥1,000/年</div>
      <div style={{fontSize: "12px", lineHeight: "2", marginTop: "8px", color: "#5a4632"}}>
      ✅ 9 位数字高管全年畅用（招商全链路）<br />
      ✅ 保禄老师十年实战方法论 · 专家私有知识库<br />
      ✅ 录音卡接入 · 招商接待录音自动变线索<br />
      ✅ 招商内容 · 私域承接 · 签约成交话术模板<br />
      ✅ 交付成功才扣费 · 失败不扣 · 到期前 7 天提醒续费
      </div>
      </div>
      <div className="card">
      <div className="bal">
      <div className="bal-n"><em>算力余额 · 1 元 = 10 算力</em><b id="meBalance">12,860</b><i>算力</i></div>
      <button className="mini-btn go" data-act="toast('演示环境 · 充值入口以线上为准')" onClick={onAct}>充值</button>
      <button className="mini-btn" data-act="toast('演示环境 · 明细入口以线上为准')" onClick={onAct}>明细</button>
      </div>
      <div style={{fontSize: "11px", color: "#98a4b0", marginTop: "10px"}}>0 元开通 · 交付成功才扣费 · 失败不扣</div>
      </div>
      <div className="card" id="inviteCard">
      <div className="card-h"><span className="h-ic">🎁</span>邀请有礼</div>
      <div className="task">
      <div className="tk-ic">🤝</div>
      <div className="tk-t"><b>好友开通 · 各得 100 算力</b><span>把你的增长台分享给身边做连锁的朋友</span></div>
      <button className="mini-btn go" data-act="toast('演示环境 · 邀请卡片以线上为准')" onClick={onAct}>邀请</button>
      </div>
      </div>
      <div className="card">
      <div className="card-h"><span className="h-ic">🗂️</span>增长档案 · 最近派单</div>
      <div className="rec-list">
      <div className="rec"><span className="rc-t">今天 10:24</span><div className="rc-m"><b>苏笺 · 招商文案</b><span>品牌招商朋友圈 · 合伙人社群 1 条</span></div><span className="rc-c">-15 算力</span></div>
      <div className="rec"><span className="rc-t">昨天</span><div className="rc-m"><b>程鉴 · 流量诊断</b><span>短视频复盘诊断 1 次</span></div><span className="rc-c">-50 算力</span></div>
      <div className="rec"><span className="rc-t">10-01</span><div className="rc-m"><b>庄衡 · IP 定位</b><span>定位全案 1 份</span></div><span className="rc-c">-99 算力</span></div>
      </div>
      </div>
      <div className="card" id="recApiCard">
      <div className="card-h"><span className="h-ic">🎙️</span>我的设备 · AI录音卡 <span className="api-st" id="apiSt">未连接</span><span className="demo-badge" style={{marginLeft: "auto"}}>演示数据</span></div>
      <div className="api-row"><span>API 地址</span><input id="apiUrl" defaultValue="https://api.sitongai.com/open/v1/recordings" spellCheck="false" /></div>
      <div className="api-row"><span>连接密钥</span><input id="apiKey" type="password" defaultValue="sk-demo-2026" /></div>
      <button className="big-btn" id="apiBtn" data-act="apiConnect()" onClick={onAct}>🔌 连接录音卡（拉取招商接待录音）</button>
      <div className="api-log" id="apiLog"></div>
      <div className="card-note">录音卡装在门店自动录招商接待对话 · API 连上后每 30 分钟同步一次，录音转写成文字，线索直接派给数字高管接（演示口径）</div>
      </div>
      <div className="card" id="memCard">
      <div className="card-h"><span className="h-ic">🧠</span>记忆与进化 <span className="demo-badge" style={{marginLeft: "auto"}}>越用越懂你</span></div>
      <div className="mem-it">
      <span className="mem-tag">品牌画像</span>
      <div className="mem-b">连锁烘焙品牌 · 单店投资 28 万 · 主打区域代理 · 目标一年签 30 家</div>
      <div className="mem-ops"><button data-act="memEdit(this)" onClick={onAct}>✏️</button><button data-act="memDel(this)" onClick={onAct}>🗑️</button></div>
      </div>
      <div className="mem-it">
      <span className="mem-tag">风格偏好</span>
      <div className="mem-b">口语化、爱用算账式钩子、结尾固定引导扣「招商」</div>
      <div className="mem-ops"><button data-act="memEdit(this)" onClick={onAct}>✏️</button><button data-act="memDel(this)" onClick={onAct}>🗑️</button></div>
      </div>
      <div className="mem-it">
      <span className="mem-tag">红线禁忌</span>
      <div className="mem-b">不说「最便宜」、不承诺效果、不贬低同行</div>
      <div className="mem-ops"><button data-act="memEdit(this)" onClick={onAct}>✏️</button><button data-act="memDel(this)" onClick={onAct}>🗑️</button></div>
      </div>
      <button className="mini-btn mem-add" data-act="memAdd(this)" onClick={onAct}>＋ 添加一条记忆</button>
      <div className="card-note">已记住 26 条 · 本周自动进化 12 次 · 你每次改过的交付都会被记住，9 位数字高管下次直接照你的口味来（演示口径）</div>
      </div>
      <div className="card">
      <div className="card-h"><span className="h-ic">❓</span>新手帮助</div>
      <div className="help-it open">
      <button className="help-q" data-act="this.parentNode.classList.toggle('open')" onClick={onAct}>怎么派活？</button>
      <div className="help-a">去「数字高管」页选人 → 点「派活给他」→ 选场景 → 生成后一键复制就能用。不知道找谁？回增长台按场景点任务。</div>
      </div>
      <div className="help-it">
      <button className="help-q" data-act="this.parentNode.classList.toggle('open')" onClick={onAct}>算力怎么扣？</button>
      <div className="help-a">1 元 = 10 算力 · 0 元开通 · 生成成功才扣费，失败不扣。每位数字高管的单价在他的卡片上标着。</div>
      </div>
      <div className="help-it">
      <button className="help-q" data-act="this.parentNode.classList.toggle('open')" onClick={onAct}>发了没效果怎么办？</button>
      <div className="help-a">招商是闭环：把数据丢给程鉴诊断 → 按建议调整 → 金点换选题 → 苏笺重写。迭代三轮，比单发一条有效得多。</div>
      </div>
      </div>
      <button className="spec-link" data-act="location.href='spec-franchise.html'" onClick={onAct}>📄 产品说明 · 招商加盟版（功能与计费口径）</button>
    </section>
  );
}

export function RedlineMarkup({ onAct }: { onAct: OnAct }) {
  return (
    <>
      <div className="redline-tip">🛡️ 本页为 UI 设计演示：所有数据、案例、人名均为虚构示意，不构成任何投资或加盟建议；不对招商成果、加盟收益、回本周期作任何承诺或保证；相关表述已按《广告法》要求规避承诺性、绝对化用语；「限时价」为演示口径，实际以官方页面为准。计费：1 元 = 10 算力 · 0 元开通 · 用后扣费 · 失败不扣费。</div>
    </>
  );
}

export function SheetMarkup({ sfAgents, sfFreq, sched, onAct }: { sfAgents: ReactNode; sfFreq: ReactNode; sched: ReactNode; onAct: OnAct }) {
  return (
    <>
      <div className="sheet">
      <div className="sh-head">
      <div className="ssh-ic">⏰</div>
      <div className="sh-n"><b>定时任务管理</b><span>到点自动派活 · 结果进增长台「最近生成」</span></div>
      <button className="sh-x" data-act="closeSched()" onClick={onAct}>✕</button>
      </div>
      {sched}
      <button className="big-btn" id="schedNewBtn" style={{marginTop: "12px"}} data-act="openSchedForm()" onClick={onAct}>＋ 新建定时任务</button>
      <div className="ssh-form" id="schedForm" style={{display: "none"}}>
      <div className="f-label" style={{marginTop: "0"}}>① 选数字高管</div>
      {sfAgents}
      <div className="f-label">② 选任务场景</div>
      <div className="chips" id="sfScenes"><span className="f-hint">先选高管 · 自动带出他的拿手场景</span></div>
      <div className="f-label">③ 执行频率</div>
      {sfFreq}
      <button className="big-btn" data-act="saveSched()" onClick={onAct}>保存定时任务</button>
      <button className="ssh-cancel" data-act="closeSchedForm()" onClick={onAct}>收起，不建了</button>
      </div>
      <div className="card-note ssh-foot">正式版支持到点提醒与自动执行 · 消耗算力按各数字高管单价 · 以线上为准</div>
      </div>
    </>
  );
}

export function TabbarMarkup({ onAct }: { onAct: OnAct }) {
  return (
    <>
      <nav className="tabbar">
      <div className="side-brand">⚡ 思潼<i>AI</i> 业绩倍增<small>招商加盟版</small></div>
      <button className="tab act" data-tab="home" data-act="switchTab('home')" onClick={onAct}><span className="ic">🏠</span>增长台</button>
      <button className="tab" data-tab="agents" data-act="switchTab('agents')" onClick={onAct}><span className="ic">🤖</span>数字高管</button>
      <button className="tab" data-tab="task" data-act="switchTab('task')" onClick={onAct}><span className="ic">✅</span>任务</button>
      <button className="tab" data-tab="me" data-act="switchTab('me')" onClick={onAct}><span className="ic">👤</span>我的</button>
      </nav>
    </>
  );
}

export function HeroMarkup({ onAct }: { onAct: OnAct }) {
  return (
    <>
      <section className="hero">
      <div className="hero-in">
      <div className="hero-top">
      <div className="hero-t">
      <h1>IP+AI 业绩倍增系统</h1>
      <div className="hero-sub">不是通用AI套壳 · 做IP·招商·加盟裂变</div>
      </div>
      <button className="demo-btn" id="demoBtn" data-act="toggleDemo()" onClick={onAct}>▶ 一键演示</button>
      </div>
      <div className="zone-row"><span className="zone-tag">不需要学 · 直接用</span><span className="zone-tag ghost">⚡ 实战专家团 · 十年沉淀</span></div>
      <div className="loop-bar" id="loopBar">
      <button className="loop-it" data-act="loopJump('dingwei')" onClick={onAct}><span className="loop-dot">🎯</span><b>定位</b><span>庄衡</span></button>
      <button className="loop-it" data-act="loopJump('xuanti')" onClick={onAct}><span className="loop-dot">🗓️</span><b>选题</b><span>金点</span></button>
      <button className="loop-it" data-act="loopJump('neirong')" onClick={onAct}><span className="loop-dot">✍️</span><b>内容</b><span>4 位</span></button>
      <button className="loop-it" data-act="loopJump('zhibo')" onClick={onAct}><span className="loop-dot">🎙️</span><b>直播</b><span>祝鸣</span></button>
      <button className="loop-it" data-act="loopJump('siyu')" onClick={onAct}><span className="loop-dot">🤝</span><b>转化</b><span>温故 · 万契</span></button>
      </div>
      </div>
      </section>
    </>
  );
}
