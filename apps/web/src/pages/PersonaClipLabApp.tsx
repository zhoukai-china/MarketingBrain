import { useEffect, useMemo, useState } from "react";
import { apiPath, getAppPath } from "../lib/api.js";

interface SampleClip {
  id: string;
  filename: string;
  byteSize: number;
  durationSeconds: number;
  width: number;
  height: number;
  thumbnailUrl: string;
}

type CropMode = "wide" | "speaker" | "product" | "evidence";

interface PersonaSegment {
  segmentId: string;
  sourceId: string;
  startSeconds: number;
  endSeconds: number;
  transcript: string;
  role: string;
  cropMode: CropMode;
  reason: string;
  highlightScore?: number;
  highlightTags?: string[];
  editableStartSeconds?: number;
  editableEndSeconds?: number;
}

interface PersonaCandidateGroup { role: string; label: string; candidates: PersonaSegment[] }

interface PersonaTopic {
  topicId: string;
  title: string;
  summary: string;
  sourceStartSeconds: number;
  sourceEndSeconds: number;
  sourceDurationSeconds: number;
  estimatedDurationSeconds: number;
  selected: PersonaSegment[];
  candidateGroups: PersonaCandidateGroup[];
  structure: Array<{ role: string; label: string; count: number; complete: boolean }>;
  qualityFlags: string[];
}

const personaTemplates = [
  { id: "point", title: "观点力量", roles: ["hook", "insight", "reasoning", "takeaway"], desc: "有力量的观点→解释→完整收束" },
  { id: "story", title: "故事共鸣", roles: ["hook", "context", "story", "insight", "takeaway"], desc: "冲突开头→背景→发展→感悟" },
  { id: "reason", title: "问题启发", roles: ["hook", "context", "reasoning", "insight", "takeaway"], desc: "问题→原因→洞察→可带走的结论" }
];

interface PersonaPlan {
  batchPlanId: string;
  sourceId: string;
  sourceDurationSeconds: number;
  transcriptUnitCount: number;
  topicCount: number;
  targetDurationSeconds: number;
  topics: PersonaTopic[];
  asrCalls: number;
  analyzeMs: number;
  qualityFlags: string[];
}

interface PersonaResult {
  outputUrl: string;
  outputBytes: number;
  output: { durationSeconds: number };
  renderMs: number;
  segmentCount: number;
  aiWork: string[];
  humanChecklist: string[];
  qualityFlags: string[];
  totalMs: number;
  estimatedHumanMinutes: number;
  title: string;
}

export default function PersonaClipLabApp() {
  const [samples, setSamples] = useState<SampleClip[]>([]);
  const [sampleId, setSampleId] = useState("");
  const [targetDurationSeconds, setTargetDurationSeconds] = useState(60);
  const [topicHint, setTopicHint] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [plan, setPlan] = useState<PersonaPlan | null>(null);
  const [topics, setTopics] = useState<PersonaTopic[]>([]);
  const [renderingTopic, setRenderingTopic] = useState("");
  const [renderingAll, setRenderingAll] = useState(false);
  const [results, setResults] = useState<Record<string, PersonaResult>>({});
  const [selectedSegments, setSelectedSegments] = useState<Record<string, number>>({});
  const [dragging, setDragging] = useState<{ topicId: string; index: number } | null>(null);
  const [previewSegment, setPreviewSegment] = useState<PersonaSegment | null>(null);

  useEffect(() => {
    fetch(apiPath("/clip-lab/samples?mode=persona"))
      .then(async (response) => {
        if (!response.ok) throw new Error("无法读取人设视频素材");
        return response.json() as Promise<{ samples: SampleClip[] }>;
      })
      .then((data) => {
        setSamples(data.samples);
        setSampleId(data.samples.find((item) => item.filename.includes("知足常乐"))?.id ?? data.samples[0]?.id ?? "");
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "读取素材失败"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!planning && !renderingTopic && !renderingAll) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 500);
    return () => window.clearInterval(timer);
  }, [planning, renderingTopic, renderingAll]);

  const totalOutputSeconds = useMemo(() => topics.reduce((sum, topic) => sum + topic.estimatedDurationSeconds, 0), [topics]);

  async function uploadSource(file: File | undefined) {
    if (!file || uploading) return;
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(apiPath("/clip-lab/uploads?kind=source"), { method: "POST", body: form });
      const data = await response.json() as { sample?: SampleClip; message?: string };
      if (!response.ok || !data.sample) throw new Error(data.message ?? "视频上传失败");
      setSamples((current) => [data.sample!, ...current]);
      setSampleId(data.sample.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "视频上传失败");
    } finally {
      setUploading(false);
    }
  }

  async function generatePlan() {
    if (!sampleId || planning) return;
    setPlanning(true);
    setElapsed(0);
    setError("");
    setPlan(null);
    setTopics([]);
    setResults({});
    try {
      const response = await fetch(apiPath("/clip-lab/persona/plan"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sampleId, targetDurationSeconds, topicHint })
      });
      const data = await response.json() as { plan?: PersonaPlan; message?: string };
      if (!response.ok || !data.plan) throw new Error(data.message ?? "话题拆分失败");
      setPlan(data.plan);
      setTopics(data.plan.topics);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "话题拆分失败");
    } finally {
      setPlanning(false);
    }
  }

  function updateTopicSegment(topicId: string, segmentId: string, patch: Partial<PersonaSegment>) {
    setTopics((current) => current.map((topic) => topic.topicId !== topicId ? topic : {
      ...topic,
      selected: topic.selected.map((segment) => segment.segmentId === segmentId ? { ...segment, ...patch } : segment)
    }));
  }

  function removeTopicSegment(topicId: string, segmentId: string) {
    setTopics((current) => current.map((topic) => topic.topicId !== topicId ? topic : {
      ...topic,
      selected: topic.selected.filter((segment) => segment.segmentId !== segmentId)
    }));
  }

  function addTopicCandidate(topicId: string, candidate: PersonaSegment, replace: boolean) {
    setTopics((current) => current.map((topic) => {
      if (topic.topicId !== topicId) return topic;
      const targetIndex = selectedSegments[topicId] ?? 0;
      const existingIndex = topic.selected.findIndex((item) => item.segmentId === candidate.segmentId);
      if (replace && topic.selected[targetIndex]) {
        if (existingIndex === targetIndex) return topic;
        if (existingIndex >= 0) {
          const copy = [...topic.selected]; [copy[targetIndex], copy[existingIndex]] = [copy[existingIndex], copy[targetIndex]];
          return { ...topic, selected: copy };
        }
        return { ...topic, selected: topic.selected.map((item, index) => index === targetIndex ? candidate : item) };
      }
      return existingIndex >= 0 ? topic : { ...topic, selected: [...topic.selected, candidate] };
    }));
  }

  function applyPersonaTemplate(topicId: string, roles: string[]) {
    setTopics((current) => current.map((topic) => {
      if (topic.topicId !== topicId) return topic;
      const candidates = roles.flatMap((role) => {
        const currentMatch = topic.selected.find((item) => item.role === role);
        const alternative = topic.candidateGroups.find((group) => group.role === role)?.candidates[0];
        return currentMatch ? [currentMatch] : alternative ? [alternative] : [];
      });
      return { ...topic, selected: candidates.filter((item, index, list) => list.findIndex((candidate) => candidate.segmentId === item.segmentId) === index) };
    }));
  }

  function dropTopicSegment(topicId: string, targetIndex: number) {
    if (!dragging || dragging.topicId !== topicId) return;
    setTopics((current) => current.map((topic) => {
      if (topic.topicId !== topicId) return topic;
      const copy = [...topic.selected]; const [item] = copy.splice(dragging.index, 1); copy.splice(targetIndex, 0, item); return { ...topic, selected: copy };
    }));
    setSelectedSegments((current) => ({ ...current, [topicId]: targetIndex })); setDragging(null);
  }

  async function renderTopic(topic: PersonaTopic): Promise<PersonaResult> {
    if (!plan) throw new Error("请先生成话题方案");
    const response = await fetch(apiPath("/clip-lab/persona/render-topic"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        batchPlanId: plan.batchPlanId,
        topicId: topic.topicId,
        selected: topic.selected.map(({ segmentId, cropMode, startSeconds, endSeconds }) => ({ segmentId, cropMode, startSeconds, endSeconds }))
      })
    });
    const data = await response.json() as { result?: PersonaResult; message?: string };
    if (!response.ok || !data.result) throw new Error(data.message ?? `“${topic.title}”生成失败`);
    setResults((current) => ({ ...current, [topic.topicId]: data.result! }));
    return data.result;
  }

  async function renderOne(topic: PersonaTopic) {
    if (renderingTopic || renderingAll) return;
    setRenderingTopic(topic.topicId);
    setElapsed(0);
    setError("");
    try {
      await renderTopic(topic);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "视频生成失败");
    } finally {
      setRenderingTopic("");
    }
  }

  async function renderAll() {
    if (!plan || renderingAll || renderingTopic) return;
    setRenderingAll(true);
    setElapsed(0);
    setError("");
    try {
      for (const topic of topics) {
        if (topic.selected.length < 2 || results[topic.topicId]) continue;
        setRenderingTopic(topic.topicId);
        await renderTopic(topic);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "批量生成失败，已经完成的结果仍可下载");
    } finally {
      setRenderingTopic("");
      setRenderingAll(false);
    }
  }

  return <main className="clipLabPage personaClipLabPage">
    <header className="clipLabHeader">
      <a className="clipLabBrand" href={getAppPath("/agents")}><span className="clipLabLogo">思潼</span><span>自由组片智能体</span></a>
      <span className="clipLabStatus"><i /> 人设观点切片 · 多话题自动初剪</span>
    </header>

    <section className="clipLabHero clipLabHeroV2 personaHero">
      <div><span className="clipLabEyebrow">整段识别多个话题 · 一次生成多条短视频</span><h1>一条长素材，<br /><em>拆成多个完整故事。</em></h1><p>AI先理解整段讲了几件事，再把每件事分别压缩为30秒到2分钟的独立视频。不会套用带货成交逻辑，也不会因为停顿把一句话或一个故事切坏。</p></div>
      <div className="clipLabPromise"><strong>这一模式由AI完成</strong><div><span>01</span> 全片逐字识别与话题边界</div><div><span>02</span> 高光开头、观点逻辑与完整结尾</div><div><span>03</span> 多条无字幕MP4分别下载</div></div>
    </section>

    <section className="clipCapabilityMap">
      <div className="clipCapabilityIntro"><span>人设、观点、人生感悟、故事口述</span><h2>AI负责“找、拆、剪”，切片手负责最后精修</h2><p>AI不改写说话内容，所有成片只使用原视频里的真实口述。</p></div>
      <div className="clipCapabilityStages"><article><i>AI</i><strong>识别所有话题</strong><span>区分人物、事件、观点和结论的真实变化</span></article><article><i>AI</i><strong>形成独立故事</strong><span>强开头、必要背景、发展、洞察和收束</span></article><article><i>AI</i><strong>批量无字幕初剪</strong><span>完整句切点、干净人声、多条MP4</span></article><article className="human"><i>人</i><strong>剪映精修</strong><span>添加字幕、音乐、花字和最终审美</span></article></div>
    </section>

    <section className="clipV2Shell">
      <section className="clipV2Config">
        <StepHeader number="01" title="选择一条长素材" hint="AI会分析整段内容" />
        <label className="clipUploadSource"><input type="file" accept="video/mp4,video/quicktime,video/webm,.m4v" onChange={(event) => uploadSource(event.target.files?.[0])} /><strong>{uploading ? "正在上传视频…" : "上传人物口述、直播或访谈"}</strong><span>支持最长4小时；临时文件保留24小时，完成后请及时下载。</span></label>
        {loading ? <div className="clipLabLoading">正在读取素材…</div> : <div className="clipSourceGrid">{samples.map((sample) => <button key={sample.id} className={`clipSourceCard ${sampleId === sample.id ? "isSelected" : ""}`} onClick={() => setSampleId(sample.id)}><img src={apiPath(sample.thumbnailUrl)} alt={`${sample.filename}预览`} /><span className="clipSourceInfo"><strong>{sample.filename}</strong><small>{formatDuration(sample.durationSeconds)} · {sample.width}×{sample.height} · {formatBytes(sample.byteSize)}</small></span><b>{sampleId === sample.id ? "已选择" : "选择"}</b></button>)}</div>}

        <StepHeader number="02" title="设置每条成片长度" hint="最终允许30秒到2分钟" />
        <div className="clipV2Fields"><label><span>目标时长</span><select value={targetDurationSeconds} onChange={(event) => setTargetDurationSeconds(Number(event.target.value))}><option value={45}>约45秒</option><option value={60}>约1分钟（推荐）</option><option value={90}>约1分30秒</option><option value={120}>约2分钟</option></select></label><label className="wide"><span>可选：人物或内容提示</span><input value={topicHint} onChange={(event) => setTopicHint(event.target.value)} maxLength={500} placeholder="例如：重点关注创业经历、家庭关系和人生感悟；不填也可以" /></label></div>
        <button className="clipPlanButton" onClick={generatePlan} disabled={planning || !sampleId}>{planning ? <><span className="clipSpinner" /> {personaPlanningStage(elapsed)} · {formatDuration(elapsed)}</> : "识别整段话题并生成多条粗剪方案"}</button>
        <p className="clipPlanHint">{planning ? "27分钟素材首次分析可能需要3–8分钟，请保持页面打开；以后会复用逐字识别结果。" : "先识别整段讲了几件事，再逐条压缩；不会按固定分钟机械切开。"}</p>
      </section>

      {plan && <section className="clipV2Plan personaPlan">
        <div className="clipPlanHeader"><div><span>全片话题识别完成</span><h2>共找到 {topics.length} 个可独立成片的话题</h2><p>原素材 {formatDuration(plan.sourceDurationSeconds)}，已按完整故事和观点边界拆分。每个话题可以单独检查、生成和下载。</p></div><div className="clipPlanStats"><strong>{topics.length}</strong><span>条短视频</span><strong>{formatDuration(totalOutputSeconds)}</strong><span>预计总成片</span><strong>{formatDuration(plan.analyzeMs / 1000)}</strong><span>分析耗时</span></div></div>
        {plan.qualityFlags.length > 0 && <p className="clipPlanQualityFlags">需要复核：{plan.qualityFlags.join("；")}</p>}
        <div className="personaTopicList">{topics.map((topic, topicIndex) => <article className="personaTopicCard" key={topic.topicId}>
          <header><div><span>第 {topicIndex + 1} 条 · 原素材 {formatRange(topic.sourceStartSeconds, topic.sourceEndSeconds)}</span><h3>{topic.title}</h3><p>{topic.summary}</p></div><div><strong>{Math.round(topic.estimatedDurationSeconds)}s</strong><small>{topic.selected.length}个完整语义段</small></div></header>
          <div className="clipStageStrip">{topic.structure.map((stage) => <span key={stage.role} className={stage.complete ? "isComplete" : "isMissing"}>{stage.complete ? "✓" : "!"} {stage.label}</span>)}</div>
          {topic.qualityFlags.length > 0 && <p className="clipPlanQualityFlags">需要留意：{topic.qualityFlags.join("；")}</p>}
          <div className="personaTemplateChooser"><strong>快速套用结构</strong>{personaTemplates.map((item) => <button key={item.id} title={item.desc} onClick={() => applyPersonaTemplate(topic.topicId, item.roles)}>{item.title}<small>{item.desc}</small></button>)}</div>
          <details className="personaCandidateLibrary"><summary>展开这个话题的候选片段库</summary><div>{topic.candidateGroups.map((group) => <article key={group.role}><header><strong>{group.label}</strong><span>{group.candidates.length}个</span></header>{group.candidates.map((candidate) => <section key={candidate.segmentId} className={topic.selected.some((item) => item.segmentId === candidate.segmentId) ? "isUsed" : ""}><p>{candidate.transcript}</p><small>{formatRange(candidate.startSeconds, candidate.endSeconds)}</small><footer><button onClick={() => setPreviewSegment(candidate)}>试听</button><button onClick={() => addTopicCandidate(topic.topicId, candidate, false)}>追加</button><button onClick={() => addTopicCandidate(topic.topicId, candidate, true)}>替换当前</button></footer></section>)}</article>)}</div></details>
          <div className="personaSegmentList">{topic.selected.map((segment, index) => <div draggable onDragStart={() => setDragging({ topicId: topic.topicId, index })} onDragOver={(event) => event.preventDefault()} onDrop={() => dropTopicSegment(topic.topicId, index)} onClick={() => setSelectedSegments((current) => ({ ...current, [topic.topicId]: index }))} className={`personaSegment ${(selectedSegments[topic.topicId] ?? 0) === index ? "isSelected" : ""}`} key={segment.segmentId}><b>☷ {String(index + 1).padStart(2, "0")}</b><div><span>{personaRoleLabel(segment.role)} · {formatRange(segment.startSeconds, segment.endSeconds)}{segment.highlightTags?.length ? ` · ${segment.highlightTags.join("、")}` : ""}</span><p>{segment.transcript}</p><small>{segment.reason}</small><div className="clipTrimControls"><label>入点<input type="number" step="0.1" min={segment.editableStartSeconds ?? segment.startSeconds} max={segment.endSeconds - .35} value={roundTime(segment.startSeconds)} onChange={(event) => updateTopicSegment(topic.topicId, segment.segmentId, { startSeconds: Number(event.target.value) })} /></label><label>出点<input type="number" step="0.1" min={segment.startSeconds + .35} max={segment.editableEndSeconds ?? segment.endSeconds} value={roundTime(segment.endSeconds)} onChange={(event) => updateTopicSegment(topic.topicId, segment.segmentId, { endSeconds: Number(event.target.value) })} /></label><button onClick={() => setPreviewSegment(segment)}>试听</button></div></div><select value={segment.cropMode} onChange={(event) => updateTopicSegment(topic.topicId, segment.segmentId, { cropMode: event.target.value as CropMode })}><option value="wide">自然全景</option><option value="speaker">人物近景</option></select><button title="删除该片段" onClick={() => removeTopicSegment(topic.topicId, segment.segmentId)}>×</button></div>)}</div>
          <footer><span>输出为无字幕、无音乐初剪片，方便导入剪映精修。</span><button onClick={() => renderOne(topic)} disabled={Boolean(renderingTopic) || renderingAll || topic.selected.length < 2}>{renderingTopic === topic.topicId ? `正在生成 · ${formatDuration(elapsed)}` : results[topic.topicId] ? "重新生成" : "生成这条视频"}</button></footer>
          {results[topic.topicId] && <PersonaResultPanel result={results[topic.topicId]} />}
        </article>)}</div>
        <div className="clipRenderBar"><div><strong>批量生成全部人设短视频</strong><span>{topics.length}个话题 · 每条独立MP4 · 无字幕无音乐 · 可以分别下载到剪映</span></div><button onClick={renderAll} disabled={renderingAll || Boolean(renderingTopic)}>{renderingAll ? `正在生成第 ${Math.max(1, topics.findIndex((item) => item.topicId === renderingTopic) + 1)} 条 · ${formatDuration(elapsed)}` : "生成全部视频"}</button></div>
      </section>}
    </section>
    {previewSegment && <section className="clipSourcePreview personaSourcePreview"><div><strong>原片试听 · {formatRange(previewSegment.startSeconds, previewSegment.endSeconds)}</strong><button onClick={() => setPreviewSegment(null)}>关闭</button></div><video controls autoPlay src={`${apiPath(`/clip-lab/samples/${encodeURIComponent(previewSegment.sourceId)}/video`)}#t=${Math.max(0, previewSegment.startSeconds - 1)},${previewSegment.endSeconds + 1}`} /></section>}
    {error && <div className="clipLabError">{error}</div>}
  </main>;
}

function PersonaResultPanel({ result }: { result: PersonaResult }) {
  const videoUrl = apiPath(result.outputUrl);
  return <section className="personaInlineResult"><video controls playsInline src={videoUrl} /><div><strong>{result.title}</strong><span>{formatDuration(result.output.durationSeconds)} · {result.segmentCount}段原话 · {formatBytes(result.outputBytes)}</span><a href={videoUrl} download>下载无字幕 MP4 到剪映精修</a><small>建议人工快速检查完整句、节奏和观点逻辑，再添加字幕、音乐与花字。</small></div></section>;
}

function StepHeader({ number, title, hint }: { number: string; title: string; hint: string }) { return <div className="clipStepHeader"><span>{number}</span><h2>{title}</h2><p>{hint}</p></div>; }
function personaPlanningStage(seconds: number): string { if (seconds < 30) return "正在提取整段语音"; if (seconds < 150) return "正在生成全片逐字时间码"; if (seconds < 240) return "正在识别多个话题边界"; return "正在为每个话题组织独立短视频"; }
function personaRoleLabel(role: string): string { return ({ hook: "高光开头", context: "必要背景", story: "故事发展", reasoning: "观点论证", insight: "核心洞察", takeaway: "完整收束" } as Record<string, string>)[role] ?? "内容片段"; }
function formatRange(start: number, end: number): string { return `${formatDuration(start)}–${formatDuration(end)}`; }
function roundTime(seconds: number): number { return Math.round(seconds * 10) / 10; }
function formatDuration(seconds: number): string { const safe = Math.max(0, Math.round(seconds)); return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`; }
function formatBytes(bytes: number): string { return `${(bytes / 1024 / 1024).toFixed(bytes > 100 * 1024 * 1024 ? 0 : 1)} MB`; }
