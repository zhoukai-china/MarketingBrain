// PLAT-33 公共平台语音输入的源码契约回归（只读源码，不联网、不调模型）。
//
// 它钉死三件事，防止以后被「顺手改回去」：
//   1. 公共平台对话页与智能体工作台都走受授权入口 `/voice/transcribe`，谁都不许再打 `/media/analyze` 转语音；
//   2. 公共平台对话页保留「🎤 语音 / ⏹ 结束录音」的可见入口与录音中状态提示；
//   3. 后端确实注册了 `/voice/transcribe`，且四项准入（身份 / 用途 / 次数 / 缺配置）都在。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");

async function main() {
  const [chatPage, composer, voiceHook, voiceRoute, server] = await Promise.all([
    read("apps/web/src/marketplace/AgentChatPage.tsx"),
    read("apps/web/src/components/chat/ChatComposer.tsx"),
    read("apps/web/src/components/chat/useVoiceInput.ts"),
    read("apps/api/src/routes/voice.ts"),
    read("apps/api/src/server.ts")
  ]);

  const results = [];
  const check = (ok, label, detail = "") => {
    results.push({ ok, label, detail });
    console.log(`[${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` :: ${detail}` : ""}`);
  };

  // 1) 两个入口都用新接口。
  check(/apiPath\("\/voice\/transcribe"\)/.test(chatPage), "公共平台对话页语音走 /voice/transcribe");
  check(/apiPath\("\/voice\/transcribe"\)/.test(composer), "智能体工作台语音走 /voice/transcribe");
  const chatVoiceFunction = chatPage.slice(chatPage.indexOf("async function transcribeVoiceBlob"));
  check(
    !/media\/analyze/.test(chatVoiceFunction.slice(0, chatVoiceFunction.indexOf("\n  async function"))),
    "对话页语音不再复用 /media/analyze（音视频入口 fail-closed）"
  );

  // 2) 公共平台对话页的可见入口与状态提示。
  check(/🎤 语音/.test(chatPage) && /⏹ 结束录音/.test(chatPage), "对话页有「🎤 语音 / ⏹ 结束录音」按钮文案");
  check(/voice-recording/.test(chatPage), "录音中有可见状态样式（voice-recording）");
  check(/voice\.message/.test(chatPage), "语音失败/进行中提示会显示给用户");
  check(/voiceLoginRequired|需要先登录|\/voice\/transcribe/.test(chatPage), "未登录时的语音输入有明确去向");

  // 3) 复用同一个 hook，避免两套录音实现漂移。
  check(/export function useVoiceInput/.test(voiceHook), "语音输入抽成可复用 hook（useVoiceInput）");
  check(/webkitSpeechRecognition|SpeechRecognition/.test(voiceHook), "录音不可用时回落到浏览器原生语音识别");
  check(/麦克风权限未开启/.test(voiceHook) && /没有检测到可用麦克风/.test(voiceHook), "麦克风失败有中文人话提示");

  // 4) 后端准入与注册。
  check(/registerVoiceRoutes/.test(server), "server 注册了语音路由");
  check(/app\.post\("\/voice\/transcribe"/.test(voiceRoute), "存在 POST /voice/transcribe");
  for (const marker of [
    ["voice_login_required", "身份准入：未登录 401"],
    ["voice_rate_limited", "预算准入：每小时次数上限 429"],
    ["voice_transcription_not_configured", "缺 Key 时 503 且不假装成功"],
    ["web_voice_input", "用途由服务端固定（web_voice_input）"],
    ["creditCost: 0", "本次不扣积分（creditCost 0）"]
  ]) {
    check(voiceRoute.includes(marker[0]), marker[1]);
  }
  check(/purpose: VOICE_TRANSCRIBE_PURPOSE/.test(voiceRoute), "响应里的用途来自服务端常量，不取客户端字段");
  check(!/part\.fieldname === "purpose"|fields\.purpose/.test(voiceRoute), "没有把客户端自报字段当授权依据");

  const failed = results.filter((item) => !item.ok);
  console.log(JSON.stringify({ result: failed.length === 0 ? "PLAT33_VOICE_CONTRACT_PASS" : "PLAT33_VOICE_CONTRACT_FAIL", passed: results.length - failed.length, failed: failed.length }));
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
