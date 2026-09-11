// 兰琪美业门店 AI 经营大脑 · 公域获客 / AI 运营顾问
// 严格对齐 demo `methods.html`：顶部标题 + 「AI 运营顾问」对话框（欢迎语 / 快捷问题 / 输入框）。
// 平台识别与「识别不出来先反问」由后端确定性规则执行，动作清单正文由真实大模型生成。

import { useEffect, useRef, useState } from "react";
import { apiPath, getAppPath } from "../lib/api.js";
import { LanqiBrainShell } from "../components/lanqi-brain/LanqiBrainShell.js";

interface StoreInfo { id: string; name: string; city: string | null }
interface AdvisorStep { title: string; detail: string }
interface AdvisorAnswer {
  summary: string;
  steps: AdvisorStep[];
  followUps: string[];
  sources: string[];
  needInfo: string[];
}
interface AdvisorResult {
  platform: string | null;
  platformLabel: string;
  needPlatform: boolean;
  askBack?: string;
  answer?: AdvisorAnswer;
}

interface ChatMessage {
  id: number;
  role: "user" | "ai";
  text?: string;
  answer?: AdvisorAnswer;
  notice?: string;
}

/** 与 demo methods.html 的 QUICK_QUESTIONS 逐条一致（含 demo 原文里的标点）。 */
const QUICK_QUESTIONS = [
  "新门店预算少，该从哪个平台开始？",
  "差评多、星级低，怎么救？",
  "没空拍视频，怎么持续获客？",
  "视频号发了没人转，问题在哪？",
  "抖音投了本地推没转化，怎么调？",
  "美团团购利润被压，怎么办？"
];

const WELCOME_TITLE = "你好，我是 AI 运营顾问。抖音、视频号、美团上的运营问题，都可以直接问我。";
const WELCOME_BODY =
  "我会自动判断你问的是哪个平台；如果判断不出来，会反问确认。把门店情况说清楚——城市、项目、客单价、几个人、现在主要靠什么获客，或者直接点下面的快捷问题，我给你排好优先级的第一周动作清单。";

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

export function LanqiAcquireMethodsPage() {
  const [storeId, setStoreId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [thinkingText, setThinkingText] = useState("");
  const [error, setError] = useState("");
  const msgBoxRef = useRef<HTMLDivElement | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    if (!localStorage.getItem("store_os_token")) {
      window.location.replace(getAppPath("/login"));
      return;
    }
    void loadStores();
  }, []);

  useEffect(() => {
    const box = msgBoxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [messages, pending]);

  async function loadStores() {
    try {
      const data = await readResponse(await fetch(apiPath("/lanqi/stores"), { headers: authHeaders() }));
      const list: StoreInfo[] = data.stores ?? [];
      if (list.length) setStoreId((current) => current || list[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "门店加载失败");
    }
  }

  function nextId(): number {
    seqRef.current += 1;
    return seqRef.current;
  }

  function pushMessage(message: Omit<ChatMessage, "id">) {
    setMessages((current) => [...current, { ...message, id: nextId() }]);
  }

  async function send(question: string) {
    const text = question.trim();
    if (!text || pending) return;
    setError("");
    pushMessage({ role: "user", text });
    setInput("");
    setPending(true);
    setThinkingText("正在判断你问的是哪个平台…");
    try {
      const history = messages.slice(-6).map((item) => ({ role: item.role, content: item.text ?? item.answer?.summary ?? "" }));
      const body = await readResponse(
        await fetch(apiPath("/lanqi/acquire/advisor"), {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ storeId, question: text, platform: "auto", history })
        })
      );
      const result: AdvisorResult = body.result;
      if (result.needPlatform) {
        pushMessage({ role: "ai", text: result.askBack ?? "" });
        return;
      }
      if (!result.answer) throw new Error("顾问没有返回动作清单，请重试一次");
      pushMessage({ role: "ai", answer: result.answer, notice: `${result.platformLabel} · ${result.answer.sources.length ? "已附通用打法参考" : "未附参考"}` });
    } catch (e) {
      const message = e instanceof Error ? e.message : "请求失败";
      setError(message);
      pushMessage({ role: "ai", text: `这次没答上来：${message}。把门店情况再补一句，或者换个问法再发一次。` });
    } finally {
      setPending(false);
      setThinkingText("");
    }
  }

  // demo methods.html：主标题=品牌名，副标题=AI 运营顾问 · 自动识别平台语境
  return (
    <LanqiBrainShell active="acquire" subtitle="AI 运营顾问 · 自动识别平台语境" crumb="/ 公域获客 / AI 运营顾问">
      <div className="lq-adv">
        <div className="lq-moments__backline">
          <a href={getAppPath("/lanqi/acquire")} className="lq-moments__back">← 返回公域获客</a>
        </div>

        <section className="lq-adv__card">
          <header className="lq-adv__head">
            <span className="lq-adv__icon" aria-hidden>🤖</span>
            <div>
              <h3>AI 运营顾问</h3>
              <p>自动识别你问的是抖音、视频号还是美团；识别不出来会反问确认，再结合门店情况给能直接照做的动作</p>
            </div>
          </header>

          <div className="lq-adv__msgs" ref={msgBoxRef}>
            <div className="lq-adv__bubble ai">
              <div className="lq-adv__avatar" aria-hidden>🤖</div>
              <div className="lq-adv__body">
                <p>{WELCOME_TITLE}</p>
                <p>{WELCOME_BODY}</p>
              </div>
            </div>

            {messages.map((message) => (
              <div key={message.id} className={`lq-adv__bubble ${message.role === "user" ? "user" : "ai"}`}>
                <div className="lq-adv__avatar" aria-hidden>{message.role === "user" ? "🧑" : "🤖"}</div>
                <div className="lq-adv__body">
                  {message.text && <p>{message.text}</p>}
                  {message.answer && (
                    <>
                      <p>{message.answer.summary}</p>
                      <ol>
                        {message.answer.steps.map((step, index) => (
                          <li key={`${message.id}-${index}`}>
                            <b>{step.title}</b>{step.detail ? `：${step.detail}` : ""}
                          </li>
                        ))}
                      </ol>
                      {message.answer.needInfo.length > 0 && (
                        <p className="lq-adv__need">还需要你补一句：{message.answer.needInfo.join("、")}</p>
                      )}
                      {message.answer.sources.length > 0 && (
                        <>
                          <p className="lq-adv__source-note" data-lanqi-advisor-source-note>
                            以下为通用打法标签，按本店情况整理，不是平台官方发布
                          </p>
                          <div className="lq-adv__sources">
                            {message.answer.sources.map((source) => (
                              <span key={source} className="lq-adv__tag">参考：{source}</span>
                            ))}
                          </div>
                        </>
                      )}
                      {message.notice && <div className="lq-adv__meta">{message.notice}</div>}
                    </>
                  )}
                </div>
              </div>
            ))}

            {pending && (
              <div className="lq-adv__bubble ai">
                <div className="lq-adv__avatar" aria-hidden>🤖</div>
                <div className="lq-adv__body"><span className="lq-adv__thinking">{thinkingText || "正在整理建议…"}</span></div>
              </div>
            )}
          </div>

          <div className="lq-adv__chips">
            <div className="lq-adv__chip-row">
              <div className="lq-adv__chip-title">快捷问题</div>
              {QUICK_QUESTIONS.map((question) => (
                <button
                  key={question}
                  type="button"
                  className="lq-adv__chip"
                  disabled={pending}
                  onClick={() => void send(question)}
                >
                  {question}
                </button>
              ))}
            </div>
          </div>

          <div className="lq-adv__input">
            <textarea
              rows={2}
              value={input}
              maxLength={1000}
              placeholder="描述你的门店情况，例如：我是新开业的美容院，预算不多，该从哪个平台开始？"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
            />
            <button type="button" disabled={pending || !input.trim() || !storeId} onClick={() => void send(input)}>
              {pending ? "整理中…" : "发送"}
            </button>
          </div>
          {error && <p className="lq-adv__error">{error}</p>}
        </section>
      </div>
    </LanqiBrainShell>
  );
}
