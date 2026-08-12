import { useMemo, useState, type ChangeEvent } from "react";
import type { ConsultantId, MemoryState } from "../../types";
import { v4Entries, type V4EntryId } from "../../data/v4Entries";

interface LatestSolution {
  title: string;
  summary: string;
  cycleDays: number;
  firstLevel: string;
  growthTargets: string[];
  timeline: Array<{ day: number; theme: string; goal: string }>;
  confirmed?: boolean;
}

interface CsvResult {
  fileName: string;
  rowCount: number;
  fields: string[];
  missing: string[];
}

interface GrowthWorkbenchViewProps {
  memory: MemoryState;
  onStartDiagnosis: (consultantId: ConsultantId, prompt: string) => void;
  onOpenBilling: () => void;
}

export function GrowthWorkbenchView({ memory, onStartDiagnosis, onOpenBilling }: GrowthWorkbenchViewProps) {
  const defaultEntryId: V4EntryId = memory.role === "chain_brand" ? "franchise" : "local";
  const [entryId, setEntryId] = useState<V4EntryId>(defaultEntryId);
  const [csv, setCsv] = useState<CsvResult | null>(null);
  const [latestSolution] = useState<LatestSolution | null>(() => readLatestSolution());
  const entry = v4Entries[entryId];
  const opening = useMemo(() => buildOpening(entryId, memory), [entryId, memory]);

  function startDiagnosis() {
    onStartDiagnosis("customer_acquisition_diagnosis", entry.startPrompt);
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/\.(csv|tsv)$/i.test(file.name)) {
      setCsv({
        fileName: file.name,
        rowCount: 0,
        fields: [],
        missing: entry.csvRequiredFields
      });
      return;
    }
    const text = await file.text();
    setCsv(parseCsv(file.name, text, entry.csvRequiredFields));
  }

  return (
    <div className="growthWorkbench">
      <section className="growthEntrySwitch" aria-label="业务类型">
        {(["local", "franchise"] as const).map((id) => (
          <button key={id} className={entryId === id ? "active" : ""} onClick={() => setEntryId(id)}>
            <strong>{id === "local" ? "本地商家" : "连锁品牌"}</strong>
            <span>{id === "local" ? "同城获客到成交" : "招商线索到签约"}</span>
          </button>
        ))}
      </section>

      {latestSolution && (
        <section className="growthPanel latestSolutionPanel">
          <div className="growthSectionHeader">
            <span>我的方案</span>
            <h2>{latestSolution.title}</h2>
          </div>
          <p>{latestSolution.summary}</p>
          <div className="latestSolutionMeta">
            <strong>{latestSolution.cycleDays}天陪跑</strong>
            <span>{latestSolution.confirmed ? "已确认最终版" : "待确认"}</span>
            <span>第一关：{latestSolution.firstLevel}</span>
          </div>
          <div className="growthTimeline">
            {latestSolution.timeline.slice(0, 4).map((item) => (
              <article key={item.day}>
                <span>Day {item.day}</span>
                <strong>{item.theme}</strong>
                <p>{item.goal}</p>
              </article>
            ))}
          </div>
          <div className="latestSolutionActions">
            <button className="primaryAction" onClick={() => window.location.href = "/diagnosis#implementation"}>
              继续落地
            </button>
            <button className="outlineAction" onClick={() => window.location.href = "/diagnosis#solution"}>
              查看/调整方案
            </button>
          </div>
        </section>
      )}

      <section className="growthHero">
        <div className="growthChatCard">
          <div className="growthChatHead">
            <span>思潼</span>
            <strong>{entryId === "local" ? "我先帮你看获客到成交哪一环卡住了" : "我先帮你看招商到签约哪一环漏得最多"}</strong>
          </div>
          <p>{opening}</p>
          <div className="growthPromptBox">
            <span>{entryId === "local" ? "你可以直接这样说：" : "你可以直接这样说："}</span>
            <strong>{entry.startPrompt}</strong>
          </div>
          <div className="growthActions">
            <button className="primaryAction" onClick={startDiagnosis}>
              {entry.cta}
            </button>
            <button className="outlineAction" onClick={onOpenBilling}>
              查看套餐和积分
            </button>
          </div>
        </div>

        <aside className="growthPromise">
          <span>{entry.cycleDays} 天</span>
          <strong>{entryId === "local" ? "跑通一个小闭环" : "跑通一轮招商闭环"}</strong>
          <p>{entry.trialCreditsLabel}</p>
          <div>
            <em>诊断</em>
            <em>交付</em>
            <em>跟进</em>
            <em>复盘</em>
          </div>
        </aside>
      </section>

      <section className="growthGrid">
        <div className="growthPanel wide">
          <div className="growthSectionHeader">
            <span>接下来怎么走</span>
            <h2>思潼不会一次丢给你一堆方案，会一步步推着走</h2>
          </div>
          <div className="growthTimeline">
            {entry.timeline.map((item) => (
              <article key={item.day}>
                <span>{item.day}</span>
                <strong>{item.title}</strong>
                <p>{item.focus}</p>
              </article>
            ))}
          </div>
        </div>

        <div className="growthPanel">
          <div className="growthSectionHeader">
            <span>用数据复盘</span>
            <h2>有数据后，思潼会帮你看下一轮怎么调</h2>
          </div>
          <label className="growthFileDrop">
            <input type="file" accept=".csv,.tsv" onChange={handleFile} />
            <strong>选择 CSV / TSV 文件</strong>
            <small>建议字段：{entry.csvRequiredFields.join("、")}</small>
          </label>
          {csv && (
            <div className="growthCsvResult">
              <strong>{csv.fileName}</strong>
              <p>识别 {csv.rowCount} 行，字段：{csv.fields.join("、") || "暂无"}</p>
              {csv.missing.length > 0 ? (
                <p className="bad">还缺：{csv.missing.join("、")}</p>
              ) : (
                <p className="good">字段齐了，可以进入复盘。</p>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="growthPanel growthKpis">
        <div className="growthSectionHeader">
          <span>这一轮主要看什么</span>
          <h2>先盯少数关键数字，别把自己淹在表格里</h2>
        </div>
        <div>
          {entry.kpis.map((kpi) => (
            <article key={kpi.key}>
              <strong>{kpi.label}</strong>
              <span>{kpi.source}</span>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function buildOpening(entryId: V4EntryId, memory: MemoryState): string {
  const name = memory.tenantName ? `${memory.tenantName}，` : "";
  if (entryId === "franchise") {
    return `${name}你好，我是思潼。我们先不急着做内容，我会先看直营样板店、招商内容、线索跟进和签约转化这几段，找出最该先补的断点。`;
  }
  return `${name}你好，我是思潼。我们先不急着发更多内容，我会先看客人从哪来、有没有引流钩子、私信怎么接、到店怎么成交，找出最该先改的一环。`;
}

function readLatestSolution(): LatestSolution | null {
  try {
    const raw = localStorage.getItem("sitong_latest_landing_solution");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LatestSolution;
    if (!parsed?.title || !Array.isArray(parsed.timeline)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function parseCsv(fileName: string, text: string, required: string[]): CsvResult {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const delimiter = lines[0]?.includes("\t") ? "\t" : ",";
  const fields = (lines[0] ?? "").split(delimiter).map((field) => field.trim());
  return {
    fileName,
    rowCount: Math.max(0, lines.length - 1),
    fields,
    missing: required.filter((field) => !fields.includes(field))
  };
}
