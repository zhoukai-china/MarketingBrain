// 兰琪美业门店 AI 经营大脑 · 公域获客 / 直播话术（主播单人 2 小时逐字稿）
// 严格对齐 demo `live.html`：头卡徽章 → 左侧直播信息 → 右侧空态 / 生成中 / 完成态。
// 生成口径：规则先出 5 组 / 23 段骨架（秒回），再按批串行调 AI 填正文，最后出通用救场话术库。

import { useMemo, useState } from "react";
import { apiPath, getAppPath } from "../lib/api.js";
import { LanqiBrainShell } from "../components/lanqi-brain/LanqiBrainShell.js";

interface StoreInfo { id: string; name: string; city: string | null }
interface LiveRound { no: number; name: string; time: string; goal: string }
interface PlanSegment { no: number; round: number; time: string; mins: number; theme: string; loop: boolean }
interface PlanBatch { no: number; round: number; roundName: string; segNos: number[]; totalMins: number; targetWords: number }
interface LivePlan {
  host: string;
  platforms: string[];
  carries: string[];
  linkWord: string;
  rounds: LiveRound[];
  segments: PlanSegment[];
  batches: PlanBatch[];
  plannedMinutes: number;
  serviceVersion: string;
}
interface LiveSegment extends PlanSegment {
  script: string;
  fill: string[];
  interact: string;
  rhythm: string;
  words: number;
}
interface FillerGroup { cat: string; items: string[] }

type Phase = "empty" | "generating" | "done" | "error";

const CARRY_OPTIONS = ["团购券", "居家产品", "会员卡"];
const PLATFORM_OPTIONS = ["抖音", "视频号"];
const WORDS_PER_MINUTE = 200;

const HERO_LEAD =
  "把真实项目/产品信息给我，直接生成主播一个人对着镜头能念的 2 小时逐字稿（含节奏提示）。不写运营动作、不要求场控，一个人一部手机就能播。支持一键导出 Word 文档。";
const HERO_LEAD_DONE_PREFIX = "共 23 段（开场 + 3 轮主循环 + 收尾），含【主播口播稿】【备用话术】【互动动作】【节奏提示】。每段可单独复制，整体可导出 Word。";
// 与 demo live.html 口径一致：<b>合规红线：</b> + 正文，正文本身不再重复「合规红线：」前缀。
const COMPLIANCE_NOTE =
  "生活美容禁医疗功效承诺（治疗/根治/七天见效）；禁极限词（最/第一/顶级）；价格用「参考」，不承诺确定效果。仅生成抖音 / 视频号平台话术（已移除快手）。";
const POOL_LEAD =
  "真实撑满 2 小时的关键：逐字稿念完会提前收场，这些话术用来填冷场、等人、被质疑、设备出状况的空档。打印出来贴在镜头边。";

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("store_os_token");
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

async function readResponse(response: Response): Promise<any> {
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) {
    localStorage.removeItem("store_os_token");
    window.location.replace(getAppPath("/login"));
    throw new Error("登录已失效");
  }
  if (!response.ok) throw new Error(body.message ?? body.error ?? "请求失败");
  return body;
}

/** 与后端 countLiveWords 同口径：去掉 [方括号] 舞台提示与空白。 */
function countLiveWords(text: string): number {
  return (text ?? "").replace(/\[[^\]]*\]/g, "").replace(/\s/g, "").length;
}

function segWords(segment: Pick<LiveSegment, "script" | "fill">): number {
  return countLiveWords(segment.script) + (segment.fill ?? []).reduce((sum, item) => sum + countLiveWords(item), 0);
}

function esc(value: string): string {
  return (value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function wescm(value: string): string {
  return esc(value).replace(/\n/g, "<br/>");
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function LanqiAcquireLivePage() {
  const [host, setHost] = useState("美肌研 · 创始人晓曼");
  const [carries, setCarries] = useState<string[]>(["团购券", "居家产品", "会员卡"]);
  const [main, setMain] = useState("水光深层补水 / 夜修精华");
  const [sell, setSell] = useState("小分子玻尿酸导入+手法，把水分推到肌底");
  const [price, setPrice] = useState("团购价99 / 原价398；夜修精华 169/298");
  const [card, setCard] = useState("年度会员 1980元，含12次补水+居家8折");
  const [platforms, setPlatforms] = useState<string[]>(["抖音", "视频号"]);

  const [phase, setPhase] = useState<Phase>("empty");
  const [plan, setPlan] = useState<LivePlan | null>(null);
  const [segments, setSegments] = useState<LiveSegment[]>([]);
  const [filler, setFiller] = useState<FillerGroup[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0, label: "" });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const stats = useMemo(() => {
    const words = segments.reduce((sum, seg) => sum + countLiveWords(seg.script), 0);
    const fillWords = segments.reduce((sum, seg) => sum + seg.fill.reduce((inner, item) => inner + countLiveWords(item), 0), 0);
    const poolWords = filler.reduce((sum, group) => sum + group.items.reduce((inner, item) => inner + countLiveWords(item), 0), 0);
    const total = words + fillWords + poolWords;
    return { words, fillWords, poolWords, total, estMinAll: Math.round(total / WORDS_PER_MINUTE) };
  }, [segments, filler]);

  async function loadStoreId(): Promise<string> {
    const data = await readResponse(await fetch(apiPath("/lanqi/stores"), { headers: authHeaders() }));
    const list: StoreInfo[] = data.stores ?? [];
    if (!list.length) throw new Error("当前账号还没有可用的门店，请先在门店后台补全门店信息");
    return list[0].id;
  }

  function payload(storeId: string) {
    return { storeId, host, carries, main, sell, price, card, platforms };
  }

  function toggle(list: string[], value: string, setter: (next: string[]) => void) {
    setter(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  }

  async function postJson(path: string, body: unknown): Promise<any> {
    return readResponse(await fetch(apiPath(path), { method: "POST", headers: authHeaders(), body: JSON.stringify(body) }));
  }

  /** 单批生成；网络抖动 / 服务端 5xx 时重试一次，输入类错误直接放弃。 */
  async function fetchBatch(storeId: string, batchNo: number): Promise<LiveSegment[]> {
    let lastError = "请求失败";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const body = await postJson("/lanqi/acquire/live/segments", { ...payload(storeId), batchNo });
        return body.result.segments as LiveSegment[];
      } catch (e) {
        lastError = e instanceof Error ? e.message : "请求失败";
        if (/还差必填|参数不合法|门店不存在|批次不存在|合规门禁|不足 3 条|是空的|念不动|重新输出|请补齐/.test(lastError)) break;
      }
    }
    throw new Error(`第 ${batchNo} 批生成失败：${lastError}`);
  }

  async function generate() {
    if (phase === "generating") return;
    if (!host.trim() || !main.trim() || !sell.trim() || !carries.length || !platforms.length) {
      setError("还差必填：请补齐店名 / 主播身份、主打项目、真实卖点、带货标的与平台");
      setPhase("error");
      return;
    }
    setError("");
    setNotice("");
    setSegments([]);
    setFiller([]);
    setPlan(null);
    setPhase("generating");
    setProgress({ done: 0, total: 0, label: "正在排 5 组 / 23 段节奏骨架…" });
    try {
      const storeId = await loadStoreId();
      const planBody = await postJson("/lanqi/acquire/live/plan", payload(storeId));
      const nextPlan = planBody.result as LivePlan;
      setPlan(nextPlan);

      const total = nextPlan.batches.length + 1;
      const collected: LiveSegment[] = [];
      for (const batch of nextPlan.batches) {
        setProgress({
          done: collected.length > 0 ? collected[collected.length - 1].no - 1 : 0,
          total,
          label: `正在写第 ${batch.segNos[0]}–${batch.segNos[batch.segNos.length - 1]} 段（${batch.roundName} · ${batch.totalMins} 分钟）…`
        });
        const batchSegments = await fetchBatch(storeId, batch.no);
        collected.push(...batchSegments);
        setSegments([...collected]);
      }

      setProgress({ done: nextPlan.segments.length, total, label: "正在写通用救场话术库…" });
      const fillerBody = await postJson("/lanqi/acquire/live/filler", payload(storeId));
      setFiller(fillerBody.result.groups as FillerGroup[]);
      setProgress({ done: total, total, label: "完成" });
      setPhase("done");
    } catch (e) {
      const message = e instanceof Error ? e.message : "生成失败";
      setError(message);
      setPhase(segments.length ? "done" : "error");
    }
  }

  function rhythmText(): string {
    let text = "2小时节奏表（主播版）\n";
    for (const round of plan?.rounds ?? []) {
      const rows = segments.filter((seg) => seg.round === round.no);
      if (!rows.length) continue;
      text += `\n【${round.name}】${round.time} · ${round.goal}\n`;
      for (const seg of rows) {
        text += `  ${seg.time}  ${seg.theme}（${seg.mins}分钟 / ${segWords(seg)}字）\n    ${seg.rhythm}\n`;
      }
    }
    return text;
  }

  function allScriptText(): string {
    const body = segments
      .map((seg) => {
        let text = `【第${seg.no}段 · ${seg.theme}】(${seg.time} · ${seg.mins}分钟)\n${seg.script}`;
        if (seg.fill.length) text += `\n【备用话术】\n${seg.fill.map((item, index) => `${index + 1}. ${item}`).join("\n")}`;
        text += `\n【互动动作】${seg.interact}\n【主播节奏提示】${seg.rhythm}`;
        return text;
      })
      .join("\n\n");
    const pool = filler.map((group) => `· ${group.cat}\n${group.items.map((item, index) => `  ${index + 1}. ${item}`).join("\n")}`).join("\n\n");
    return `${body}\n\n【通用救场话术库】\n${pool}`;
  }

  function buildWordHtml(): string {
    const parts: string[] = [];
    parts.push("<html><head><meta charset='utf-8'><title>直播话术</title><style>");
    parts.push("body{font-family:'Microsoft YaHei',sans-serif;color:#2d1a10;line-height:1.8;font-size:13px;}");
    parts.push("h1{font-size:20px;} h2{font-size:16px;margin-top:22px;color:#B4500F;}");
    parts.push("table.t{border-collapse:collapse;width:100%;font-size:12px;} table.t th,table.t td{border:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top;}");
    parts.push("table.t th{background:#FFF3E6;} .k{background:#FAF6F1;font-weight:700;width:110px;}");
    parts.push(".warn{background:#FFF5F5;border:1px solid #F3C6C6;padding:10px 12px;font-size:12px;color:#8A2B2B;margin:12px 0;}");
    parts.push(".stbox{background:#FAF6F1;border:1px solid #eee;padding:10px 12px;font-size:12px;margin:10px 0;}");
    parts.push(".rdh{background:#FFF3E6;font-weight:700;color:#B4500F;padding:6px 8px;margin:16px 0 8px;}");
    parts.push(".seg{border:1px solid #eee;padding:10px 12px;margin-bottom:12px;} .seg .h{font-weight:700;margin-bottom:6px;}");
    parts.push(".lab{font-weight:700;color:#B4500F;margin-top:8px;font-size:12px;} .txt{margin:4px 0;}");
    parts.push(".fl{margin:4px 0 4px 18px;} .ita,.rhy{color:#5a4a40;}");
    parts.push("</style></head><body>");
    parts.push(`<h1>直播话术 · ${esc(host)}</h1>`);
    parts.push("<table class='t'>");
    parts.push(`<tr><td class='k'>门店 / 主播</td><td>${esc(host)}</td></tr>`);
    parts.push(`<tr><td class='k'>投放平台</td><td>${esc(platforms.join(" / "))}</td></tr>`);
    parts.push("<tr><td class='k'>直播时长</td><td>2 小时（完整逐字稿）</td></tr>");
    parts.push(`<tr><td class='k'>带货标的</td><td>${esc(carries.join(" / "))}</td></tr>`);
    parts.push(`<tr><td class='k'>主打项目</td><td>${esc(main)}</td></tr>`);
    parts.push(`<tr><td class='k'>会员卡项</td><td>${esc(card)}</td></tr>`);
    parts.push(
      `<tr><td class='k'>稿子体量</td><td>${segments.length} 段 / 口播 ${stats.words} 字 / 备用话术 ${stats.fillWords} 字 / 合计 ${
        stats.words + stats.fillWords
      } 字（按 200 字每分钟，可撑约 ${stats.estMinAll} 分钟）</td></tr>`
    );
    parts.push("</table>");
    parts.push(
      `<div class='warn'><b>合规红线（务必遵守）：</b>生活美容 / 科技美容（非医疗资质）禁止医疗功效承诺（治疗、根治、七天见效等）；禁止《广告法》极限词（最、第一、顶级）；价格与效果用「参考」「多数客人反馈」，不承诺确定结果。${esc(
        platforms.join(" / ")
      )}平台话术请以各平台最新直播规范为准。</div>`
    );

    parts.push(`<h2>一、2 小时节奏表（主播版）· 5 组 / ${segments.length} 段</h2>`);
    parts.push("<table class='t'><tr><th>时间段</th><th>主题</th><th>时长</th><th>字数</th><th>主播节奏</th></tr>");
    for (const round of plan?.rounds ?? []) {
      const rows = segments.filter((seg) => seg.round === round.no);
      if (!rows.length) continue;
      parts.push(
        `<tr><td colspan='5' style='background:#FFF3E6;font-weight:700;color:#B4500F;'>${esc(round.name)}（${esc(
          round.time
        )}）· ${esc(round.goal)}</td></tr>`
      );
      for (const seg of rows) {
        parts.push(
          `<tr><td>${esc(seg.time)}</td><td>${esc(seg.theme)}</td><td>${seg.mins} 分钟</td><td>${segWords(seg)} 字</td><td>${wescm(
            seg.rhythm
          )}</td></tr>`
        );
      }
    }
    parts.push("</table>");

    parts.push(`<h2>二、完整逐字稿（${segments.length} 段）</h2>`);
    parts.push(
      `<div class='stbox'>使用说明：每段先念【主播口播稿】；本段讲完但时间还没到下一段时，念【备用话术】（同义换说法，避免重复念烦）；【互动动作】用来把观众拉进来，同时给自己留白喘气。口播按 200 字/分钟估算，全程约 ${stats.estMinAll} 分钟。</div>`
    );
    for (const round of plan?.rounds ?? []) {
      const rows = segments.filter((seg) => seg.round === round.no);
      if (!rows.length) continue;
      parts.push(`<div class='rdh'>${esc(round.name)}　${esc(round.time)}　${esc(round.goal)}</div>`);
      for (const seg of rows) {
        parts.push(
          `<div class='seg'><div class='h'>第${seg.no}段 · ${esc(seg.time)} · ${esc(seg.theme)}（${seg.mins} 分钟 / ${segWords(
            seg
          )} 字）</div><div class='b'>`
        );
        parts.push(`<div class='lab'>【主播口播稿】</div><div class='txt'>${wescm(seg.script)}</div>`);
        if (seg.fill.length) {
          parts.push(`<div class='lab'>【备用话术 · 时间没到就念这些】</div><ul class='fl'>${seg.fill.map((item) => `<li>${wescm(item)}</li>`).join("")}</ul>`);
        }
        parts.push(`<div class='lab'>【互动动作】</div><div class='ita'>${wescm(seg.interact)}</div>`);
        parts.push(`<div class='lab'>【主播节奏提示】</div><div class='rhy'>${wescm(seg.rhythm)}</div>`);
        parts.push("</div></div>");
      }
    }

    parts.push(`<h2>三、通用救场话术库（${stats.poolWords} 字 · 打印贴镜头边）</h2>`);
    parts.push(
      `<div class='stbox'>真实撑满 2 小时的关键：逐字稿念完会提前收场。以下话术跨段通用，用于填冷场、等人、被质疑、设备出状况的空档。全稿合计 ${
        stats.total
      } 字，按 200 字每分钟可撑约 ${stats.estMinAll} 分钟。</div>`
    );
    for (const group of filler) {
      parts.push(`<div class='rdh'>${esc(group.cat)}</div><ul class='fl'>${group.items.map((item) => `<li>${wescm(item)}</li>`).join("")}</ul>`);
    }
    parts.push("<p style='margin-top:18px;color:#999;font-size:11px;'>本文档由兰琪·美业门店AI经营大脑生成，仅供直播前演练参考。正式开播前请按门店实际项目、价格与平台规范复核。</p>");
    parts.push("</body></html>");
    return parts.join("");
  }

  function exportWord() {
    if (!segments.length) {
      setNotice("请先生成逐字稿再导出");
      return;
    }
    const store = (host.split(/[ ·]/)[0] || "美业").replace(/[\\/:*?"<>|]/g, "");
    const filename = `直播话术_${store}_${platforms.join("").replace(/\s/g, "")}.doc`;
    const blob = new Blob([`\ufeff${buildWordHtml()}`], { type: "application/msword" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function copy(what: string, text: string) {
    const ok = await copyText(text);
    setNotice(ok ? `已复制${what} ✓` : "复制失败，请手动选择文本");
    window.setTimeout(() => setNotice(""), 1600);
  }

  const plannedSegments = plan?.segments.length ?? 23;

  // demo live.html：主标题=直播话术，副标题=主播单人版 · 美业门店带货
  return (
    <LanqiBrainShell active="acquire" mainTitle="直播话术" subtitle="主播单人版 · 美业门店带货" crumb="/ 公域获客 / 直播话术">
      <div className="lq-live">
        <a className="lq-live__back" href={getAppPath("/lanqi/acquire")}>← 返回公域获客</a>

        <section className="lq-live__hero">
          <span className="lq-live__tag">美业门店带货 · 主播单人 · 2 小时</span>
          <h2>{phase === "done" ? "直播话术生成器 · 已生成" : "直播话术生成器"}</h2>
          <p className="lq-live__lead">
            {phase === "done" || segments.length
              ? `${host} · ${platforms.join(" / ")} · 带货标的：${carries.join(" / ")}。${HERO_LEAD_DONE_PREFIX}`
              : HERO_LEAD}
          </p>
          <div className="lq-live__badges">
            {phase === "done" || segments.length ? (
              <>
                <span>✅ 已通过合规校验</span>
                <span>✅ {segments.length} 段 / {stats.words} 字</span>
                <span>✅ 可撑 {stats.estMinAll} 分钟</span>
                <span>✅ 无运营动作</span>
                <span>✅ {platforms.join(" / ")}</span>
              </>
            ) : (
              <>
                <span>✅ 仅主播单人</span>
                <span>✅ 仅美业</span>
                <span>✅ 完整 2 小时</span>
                <span>✅ 仅抖音/视频号</span>
                <span>✅ 可导出 Word</span>
              </>
            )}
          </div>
        </section>

        <div className="lq-live__main">
          <section className="lq-live__input">
            <h3>① 直播信息（缺则反问，不捏造）</h3>
            <div className="lq-live__fi">
              <label htmlFor="lq-live-host">店名 / 主播身份</label>
              <input id="lq-live-host" value={host} onChange={(e) => setHost(e.target.value)} />
            </div>
            <div className="lq-live__fi">
              <label>带货标的（可多选）</label>
              <div className="lq-live__chips">
                {CARRY_OPTIONS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={`lq-live__chip${carries.includes(item) ? " on" : ""}`}
                    onClick={() => toggle(carries, item, setCarries)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
            <div className="lq-live__fi">
              <label htmlFor="lq-live-main">主打项目 / 产品名</label>
              <input id="lq-live-main" value={main} onChange={(e) => setMain(e.target.value)} />
            </div>
            <div className="lq-live__fi">
              <label htmlFor="lq-live-sell">真实卖点</label>
              <textarea id="lq-live-sell" rows={3} value={sell} onChange={(e) => setSell(e.target.value)} />
            </div>
            <div className="lq-live__fi">
              <label htmlFor="lq-live-price">价格机制</label>
              <input id="lq-live-price" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div className="lq-live__fi">
              <label htmlFor="lq-live-card">会员卡项权益与价</label>
              <input id="lq-live-card" value={card} onChange={(e) => setCard(e.target.value)} />
            </div>
            <div className="lq-live__fi">
              <label>平台（抖音 / 视频号，影响违禁词口径）</label>
              <div className="lq-live__chips">
                {PLATFORM_OPTIONS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={`lq-live__chip${platforms.includes(item) ? " on" : ""}`}
                    onClick={() => toggle(platforms, item, setPlatforms)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
            <div className="lq-live__fi">
              <label htmlFor="lq-live-duration">时长</label>
              <input id="lq-live-duration" value="2 小时（默认）" disabled readOnly />
            </div>
            <button className="lq-live__gen" type="button" disabled={phase === "generating"} onClick={() => void generate()}>
              {phase === "generating" ? "正在生成 2 小时逐字稿…" : phase === "done" ? "重新生成 2 小时逐字稿" : "生成 2 小时逐字稿"}
            </button>
            <div className="lq-live__note">
              <b>合规红线：</b>
              {COMPLIANCE_NOTE}
            </div>
            {error && <p className="lq-live__err">{error}</p>}
          </section>

          <section className="lq-live__out">
            {phase === "empty" && (
              <div className="lq-live__empty">
                <div className="ico">🎙️</div>
                <h3>填写左侧信息，生成逐字稿</h3>
                <p>
                  生成后，右侧将出现「2 小时节奏表」（按 5 组轮次分组）+ 23 段话术卡。每段含【主播口播稿】【备用话术】【互动动作】【节奏提示】，均可单独复制，也可一键导出 Word。
                  <b>总字数约 2.4 万字，按 200 字/分钟可撑满 120 分钟。</b>
                </p>
              </div>
            )}

            {phase === "error" && !segments.length && (
              <div className="lq-live__empty is-error">
                <div className="ico">⚠️</div>
                <h3>这次没生成出来</h3>
                <p>{error || "生成失败，请稍后重试一次。"}</p>
                <p className="lq-live__hint">逐字稿是按 19 批逐段生成的，中途失败不会留下半截稿子，重试即可从第 1 段重新开始。</p>
              </div>
            )}

            {(phase === "generating" || segments.length > 0) && (
              <>
                <div className="lq-live__statbar">
                  <div className="sc"><div className="sv">{segments.length}</div><div className="sl">段落数</div></div>
                  <div className="sc"><div className="sv">{stats.words}</div><div className="sl">口播字数</div></div>
                  <div className="sc"><div className="sv">{stats.fillWords}</div><div className="sl">备用话术字数</div></div>
                  <div className="sc"><div className="sv">{stats.poolWords}</div><div className="sl">救场库字数</div></div>
                  <div className="sc"><div className="sv">{stats.estMinAll}</div><div className="sl">可撑（分钟）</div></div>
                  <div className="sc"><div className="sv">120</div><div className="sl">计划时长（分钟）</div></div>
                </div>

                {phase === "generating" && (
                  <div className="lq-live__gen-state">
                    <div className="spinner" />
                    <div className="txt">
                      <b>
                        正在生成 2 小时逐字稿…{progress.total ? `（已排 ${segments.length} / ${plannedSegments} 段）` : ""}
                      </b>
                      <p>
                        {progress.label || "校验合规红线（极限词 / 医疗功效 / 价格口径）· 输出 5 组 / 23 段口播稿 + 备用话术 + 互动动作 + 节奏提示"}
                      </p>
                    </div>
                  </div>
                )}

                {segments.length > 0 && (
                  <div className="lq-live__timeline">
                    <h3>📋 2 小时节奏表（主播版）· 5 组 / {plannedSegments} 段</h3>
                    {(plan?.rounds ?? []).map((round) => {
                      const rows = (plan?.segments ?? []).filter((seg) => seg.round === round.no);
                      if (!rows.length) return null;
                      const rowWords = rows.reduce((sum, spec) => {
                        const hit = segments.find((seg) => seg.no === spec.no);
                        return sum + (hit ? segWords(hit) : 0);
                      }, 0);
                      return (
                        <div className="lq-live__round" key={round.no}>
                          <div className="lq-live__round-head">
                            <span className="rn">{round.name}</span>
                            <span className="rt">{round.time}</span>
                            <span className="rg">{round.goal} · {rows.length} 段 / {rowWords} 字</span>
                          </div>
                          {rows.map((spec) => {
                            const hit = segments.find((seg) => seg.no === spec.no);
                            return (
                              <div className="lq-live__tl-row" key={spec.no}>
                                <span className="tl-time">{spec.time}</span>
                                <span className="tl-theme">
                                  {spec.theme} <span className="tl-w">{spec.mins} 分钟 · {hit ? `${segWords(hit)} 字` : "生成中…"}</span>
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                )}

                {segments.length > 0 && (
                  <div className="lq-live__cards">
                    {segments.map((seg) => (
                      <article className="lq-live__card" key={seg.no}>
                        <header className="lq-live__card-head">
                          <span className="no">{seg.no}</span>
                          <span className="t">{seg.theme}</span>
                          {seg.loop && <span className="loop">核心复讲</span>}
                          <span className="meta">{seg.time} · {seg.mins} 分钟 · {segWords(seg)} 字</span>
                        </header>
                        <div className="lq-live__field">
                          <span className="lab">
                            【主播口播稿】
                            <button type="button" className="copy" onClick={() => void copy("口播稿", seg.script)}>复制</button>
                          </span>
                          <div className="body-text">{seg.script}</div>
                        </div>
                        {seg.fill.length > 0 && (
                          <div className="lq-live__field">
                            <span className="lab">
                              【备用话术 · 时间没到就念这些】
                              <button type="button" className="copy" onClick={() => void copy("备用话术", seg.fill.map((item, index) => `${index + 1}. ${item}`).join("\n"))}>复制</button>
                            </span>
                            <div className="fill-box">
                              <ul>{seg.fill.map((item, index) => <li key={index}>{item}</li>)}</ul>
                            </div>
                          </div>
                        )}
                        <div className="lq-live__field">
                          <span className="lab">
                            【互动动作】
                            <button type="button" className="copy" onClick={() => void copy("互动动作", seg.interact)}>复制</button>
                          </span>
                          <div className="interact">{seg.interact}</div>
                        </div>
                        <div className="lq-live__field">
                          <span className="lab">
                            【主播节奏提示】
                            <button type="button" className="copy" onClick={() => void copy("节奏提示", seg.rhythm)}>复制</button>
                          </span>
                          <div className="rhythm">{seg.rhythm}</div>
                        </div>
                      </article>
                    ))}
                  </div>
                )}

                {filler.length > 0 && (
                  <div className="lq-live__timeline lq-live__pool">
                    <h3>🆘 通用救场话术库（跨段复用 · {stats.poolWords} 字）</h3>
                    <p className="pool-lead">{POOL_LEAD}</p>
                    {filler.map((group) => (
                      <div className="lq-live__round" key={group.cat}>
                        <div className="lq-live__round-head">
                          <span className="rn">{group.cat}</span>
                          <span className="rg">{group.items.length} 条</span>
                        </div>
                        <div className="fill-box">
                          <ul>{group.items.map((item, index) => <li key={index}>{item}</li>)}</ul>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {phase === "done" && (
                  <div className="lq-live__actions">
                    <button type="button" className="btn-g" onClick={() => void copy("全部口播稿", allScriptText())}>复制全部口播稿</button>
                    <button type="button" className="btn-g primary" onClick={exportWord}>⬇ 导出 Word</button>
                    <button type="button" className="btn-g" onClick={() => void copy("节奏表", rhythmText())}>复制节奏表</button>
                  </div>
                )}
                {notice && <p className="lq-live__notice">{notice}</p>}
              </>
            )}
          </section>
        </div>
      </div>
    </LanqiBrainShell>
  );
}
