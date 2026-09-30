import { appendFileSync, mkdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { env } from "../config/env.js";

/**
 * 大模型输入输出追踪日志（用户 2026-09-30：出问题了好追踪）。
 *
 * 每次大模型调用写一行 JSONL 到 `LLM_TRACE_DIR/llm-YYYY-MM-DD.jsonl`（按天滚动）：
 * - request  ：完整 messages（system 提示词 + 用户输入）
 * - response ：完整输出文本 + token 用量 + 耗时 + HTTP 状态
 * - error    ：终态错误码与耗时
 *
 * 口径：
 * - 追踪挂在 DomesticChatProvider 这一个汇聚点，所有走国内网关的调用（货架生成 /
 *   工作台 / 直播话术 / 短报）天然全覆盖；requestFingerprint 可把三行串成一次调用。
 * - 写文件失败只静默丢弃（try/catch 包死），绝不影响生成主链路。
 * - 明文含用户输入与成稿，属敏感排障数据：目录默认在服务运行目录下、不进 git
 *   （.gitignore 已加 logs/），生产要收紧就配 LLM_TRACE_ENABLED=false 关掉。
 */

export interface LlmTraceMessage {
  role: string;
  content: string;
}

export interface LlmTraceRecord {
  ts: string;
  event: "request" | "response" | "error";
  provider: string;
  model: string;
  fingerprint: string;
  /** request：完整消息列表 */
  messages?: LlmTraceMessage[];
  /** response：完整输出文本 */
  content?: string;
  usage?: Record<string, unknown>;
  elapsedMs?: number;
  httpStatus?: number;
  errorCode?: string;
  error?: string;
}

export function writeLlmTrace(record: LlmTraceRecord): void {
  if (env.LLM_TRACE_ENABLED !== "true") return;
  try {
    const dir = isAbsolute(env.LLM_TRACE_DIR) ? env.LLM_TRACE_DIR : join(process.cwd(), env.LLM_TRACE_DIR);
    const day = new Date().toISOString().slice(0, 10);
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, `llm-${day}.jsonl`), JSON.stringify(record) + "\n", "utf8");
  } catch {
    // 追踪失败不影响业务。
  }
}
