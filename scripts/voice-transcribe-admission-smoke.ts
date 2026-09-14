import assert from "node:assert/strict";
import Fastify from "../apps/api/node_modules/fastify/fastify.js";
import multipart from "../apps/api/node_modules/@fastify/multipart/index.js";
import { env } from "../apps/api/src/config/env.js";
import { createSessionToken } from "../apps/api/src/services/auth-token.js";
import { registerMediaRoutes } from "../apps/api/src/routes/media.js";
import { registerVoiceRoutes } from "../apps/api/src/routes/voice.js";

// PLAT-33 公共平台语音输入的准入回归：合成音频 + 注入 fetch，0 真实网络 / 0 真实 Provider / 0 费用。
//
// 覆盖：
//   1. 匿名录音 → 401，且 0 次外发（客户端自报的 tenantId/storeId/purpose 不能放行）。
//   2. 服务端验签会话 → 200，且恰好 1 次外发；用途固定 web_voice_input、creditCost=0。
//   3. 视频/文档 → 415；超体积 → 413；缺 Key → 503；都 0 次外发。
//   4. 每小时次数上限（预算准入）超限 → 429，且 0 次外发。
//   5. 既有 `/media/analyze` 对音视频仍 fail-closed（本卡没有放开共享入口）。
//   6. 日志不出现音频内容、客户端自报字段、凭据或租户标识。

const originalFetch = globalThis.fetch;
const saved = {
  DATA_MODE: env.DATA_MODE,
  NODE_ENV: env.NODE_ENV,
  ALIYUN_API_KEY: env.ALIYUN_API_KEY,
  DASHSCOPE_API_KEY: env.DASHSCOPE_API_KEY,
  ALIYUN_BASE_URL: env.ALIYUN_BASE_URL,
  VOICE_TRANSCRIBE_HOURLY_LIMIT: env.VOICE_TRANSCRIBE_HOURLY_LIMIT,
  VOICE_TRANSCRIBE_MAX_MB: env.VOICE_TRANSCRIBE_MAX_MB
};

const SYNTHETIC_AUDIO_BODY = "synthetic-voice-body-marker";
const SYNTHETIC_KEY = "synthetic-never-uploaded-key";
const TRANSCRIPT = "帮我看一下这家门店最近的差评问题";

function form(bytes: Buffer, filename: string, mime: string, fields: Record<string, string> = {}) {
  const boundary = "plat33-synthetic-boundary";
  return {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`),
      bytes,
      ...Object.entries(fields).map(([key, value]) => Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}`)),
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ])
  };
}

function syntheticWav(): Buffer {
  const wav = Buffer.alloc(32_044);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16_000, 24);
  wav.writeUInt32LE(32_000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(wav.length - 44, 40);
  return wav;
}

async function main(): Promise<void> {
  Object.assign(env, {
    DATA_MODE: "demo",
    NODE_ENV: "test",
    ALIYUN_API_KEY: SYNTHETIC_KEY,
    DASHSCOPE_API_KEY: "",
    ALIYUN_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
  });

  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls++;
    return new Response(JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: TRANSCRIPT } }],
      usage: { total_tokens: 7 }
    }), { headers: { "content-type": "application/json" } });
  };

  const logs: string[] = [];
  const app = Fastify({ disableRequestLogging: true, logger: { stream: { write: (line: string) => { logs.push(line); } } } });
  await app.register(multipart, { limits: { fileSize: 12 * 1024 * 1024 } });
  await registerMediaRoutes(app);
  await registerVoiceRoutes(app);

  const wav = syntheticWav();
  const audioHeaders = { ...form(wav, "voice.webm", "audio/webm").headers };
  const tenantId = "plat33-synthetic-tenant";
  const userId = "plat33-synthetic-user";
  const session = `Bearer ${createSessionToken({ tenantId, userId, ttlSeconds: 600 })}`;
  const counters = { rejected: 0, transcribed: 0, documents: 0 };

  try {
    for (let round = 0; round < 3; round += 1) {
      // 1) 匿名：即使客户端自报用途/租户/门店，也不能进入外发路径。
      const beforeAnonymous = providerCalls;
      const anonymous = form(wav, "synthetic-voice.wav", "audio/wav", {
        tenantId: "synthetic-other-tenant",
        userId: "synthetic-other-user",
        purpose: "synthetic-client-purpose",
        authorized: "true"
      });
      const anonymousResult = await app.inject({
        method: "POST",
        url: "/voice/transcribe?purpose=synthetic-query-purpose",
        remoteAddress: `127.11.0.${round + 1}`,
        ...anonymous
      });
      assert.equal(anonymousResult.statusCode, 401, "匿名语音输入必须先登录");
      assert.equal(anonymousResult.json().error, "voice_login_required");
      assert.equal(anonymousResult.json().providerCalls, 0);
      assert.equal(anonymousResult.json().creditCost, 0);
      assert.equal(providerCalls, beforeAnonymous, "匿名请求不得外发");
      counters.rejected++;

      // 无令牌又没有 demo 身份头 → 仍然 401，说明入口真的依赖身份而不是「有没有传文件」。
      const stillAnonymous = await app.inject({
        method: "POST",
        url: "/voice/transcribe",
        remoteAddress: `127.12.0.${round + 1}`,
        ...form(wav, "anonymous.wav", "audio/wav")
      });
      assert.equal(stillAnonymous.statusCode, 401);
      assert.equal(stillAnonymous.json().error, "voice_login_required");
      assert.equal(providerCalls, beforeAnonymous);
      counters.rejected++;

      // 2) 正常路径：验签会话 + 录音 → 转写成功，且正好 1 次外发。
      const before = providerCalls;
      const ok = await app.inject({
        method: "POST",
        url: "/voice/transcribe",
        remoteAddress: `127.13.0.${round + 1}`,
        ...form(wav, "synthetic-voice.wav", "audio/wav", { purpose: "synthetic-client-purpose", tenantId: "synthetic-other-tenant" }),
        headers: { ...audioHeaders, authorization: session }
      });
      assert.equal(ok.statusCode, 200, `正常录音必须转写成功：${ok.body}`);
      const body = ok.json() as { transcript?: string; purpose?: string; configured?: boolean; creditCost?: number; providerTrace?: unknown[] };
      assert.equal(body.transcript, TRANSCRIPT);
      assert.equal(body.purpose, "web_voice_input", "用途由服务端固定，客户端字段不能改写");
      assert.equal(body.configured, true);
      assert.equal(body.creditCost, 0);
      assert.equal(providerCalls - before, 1, "一次录音只外发一次");
      for (const leaked of ["tenantId", "userId", "synthetic-other-tenant", "synthetic-client-purpose"]) {
        assert.ok(!ok.body.includes(leaked), `响应不得回显客户端自报字段：${leaked}`);
      }
      counters.transcribed++;

      // 3a) 视频：语音输入入口只收音频。
      const beforeVideo = providerCalls;
      const video = await app.inject({
        method: "POST",
        url: "/voice/transcribe",
        remoteAddress: `127.14.0.${round + 1}`,
        ...form(Buffer.alloc(2048, 1), "clip.mp4", "video/mp4"),
        headers: { ...audioHeaders, authorization: session }
      });
      assert.equal(video.statusCode, 415);
      assert.equal(video.json().error, "voice_format_unsupported");
      assert.equal(providerCalls, beforeVideo, "视频不得进入语音外发路径");
      counters.rejected++;

      // 3b) 超体积：按服务端上限拒绝，不依赖客户端自报。
      const beforeLarge = providerCalls;
      env.VOICE_TRANSCRIBE_MAX_MB = 0.001;
      const large = await app.inject({
        method: "POST",
        url: "/voice/transcribe",
        remoteAddress: `127.15.0.${round + 1}`,
        ...form(Buffer.alloc(4096, 2), "big.wav", "audio/wav"),
        headers: { ...audioHeaders, authorization: session }
      });
      env.VOICE_TRANSCRIBE_MAX_MB = saved.VOICE_TRANSCRIBE_MAX_MB;
      assert.equal(large.statusCode, 413);
      assert.equal(large.json().error, "voice_file_too_large");
      assert.equal(providerCalls, beforeLarge);
      counters.rejected++;

      // 3c) 缺 Key：明确 503，不假装转写成功，也不外发。
      const keyBackup = env.ALIYUN_API_KEY;
      env.ALIYUN_API_KEY = "";
      const beforeNoKey = providerCalls;
      const noKey = await app.inject({
        method: "POST",
        url: "/voice/transcribe",
        remoteAddress: `127.16.0.${round + 1}`,
        ...form(wav, "synthetic-voice.wav", "audio/wav"),
        headers: { ...audioHeaders, authorization: session }
      });
      env.ALIYUN_API_KEY = keyBackup;
      assert.equal(noKey.statusCode, 503);
      assert.equal(noKey.json().error, "voice_transcription_not_configured");
      assert.equal(noKey.json().providerCalls, 0);
      assert.equal(noKey.json().creditCost, 0);
      assert.equal(providerCalls, beforeNoKey);
      counters.rejected++;

      // 4) 预算准入：每小时次数上限按「租户+用户」计，超限 fail-closed，另一个用户不受影响。
      //    （demo 模式下身份取 demo 身份头；database 模式下同一逻辑按验签会话里的租户/用户计。）
      const budgetTenant = `plat33-budget-tenant-${round}`;
      const budgetUser = `plat33-budget-user-${round}`;
      const budgetHeaders = { ...audioHeaders, authorization: session, "x-sitong-tenant-id": budgetTenant, "x-sitong-user-id": budgetUser };
      env.VOICE_TRANSCRIBE_HOURLY_LIMIT = 2;
      const beforeBudget = providerCalls;
      const budgetResults: number[] = [];
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const result = await app.inject({
          method: "POST",
          url: "/voice/transcribe",
          remoteAddress: `127.17.0.${round + 1}`,
          ...form(wav, "synthetic-voice.wav", "audio/wav"),
          headers: budgetHeaders
        });
        budgetResults.push(result.statusCode);
      }
      const otherUser = await app.inject({
        method: "POST",
        url: "/voice/transcribe",
        remoteAddress: `127.18.0.${round + 1}`,
        ...form(wav, "synthetic-voice.wav", "audio/wav"),
        headers: { ...audioHeaders, authorization: session, "x-sitong-tenant-id": budgetTenant, "x-sitong-user-id": `plat33-other-user-${round}` }
      });
      env.VOICE_TRANSCRIBE_HOURLY_LIMIT = saved.VOICE_TRANSCRIBE_HOURLY_LIMIT;
      assert.deepEqual(budgetResults, [200, 200, 429], "超过服务端次数上限必须被拒");
      assert.equal(otherUser.statusCode, 200, "限流按用户计，不能误伤同一租户的其他用户");
      assert.equal(providerCalls - beforeBudget, 3, "被限流的请求不得外发");
      counters.transcribed += 3;
      counters.rejected++;

      // 5) 共享上传入口没有因为本卡而放开：音视频仍然 fail-closed。
      const beforeShared = providerCalls;
      const shared = await app.inject({
        method: "POST",
        url: "/media/analyze",
        remoteAddress: `127.18.0.${round + 1}`,
        ...form(wav, "synthetic-voice.wav", "audio/wav"),
        headers: { ...audioHeaders, authorization: session }
      });
      assert.equal(shared.statusCode, 503);
      assert.equal(shared.json().error, "asr_authorization_required");
      assert.equal(providerCalls, beforeShared, "共享入口不得外发");
      counters.rejected++;
    }

    const joined = logs.join("");
    for (const marker of [TRANSCRIPT, SYNTHETIC_KEY, SYNTHETIC_AUDIO_BODY, tenantId, userId, "synthetic-client-purpose"]) {
      assert.ok(!joined.includes(marker), `日志不得出现 ${marker}`);
    }
    const rejectedEvents = logs.map((line) => JSON.parse(line)).filter((event) => event.event === "voice_transcribe.admission_rejected");
    assert.ok(rejectedEvents.length > 0, "拒绝必须有可检索的事件");
    for (const event of rejectedEvents) assert.equal(event.providerCalls, 0);

    console.log(JSON.stringify({
      result: "PLAT33_VOICE_ADMISSION_PASS",
      rounds: 3,
      transcribed: counters.transcribed,
      rejected: counters.rejected,
      realProviderCalls: 0,
      costYuan: 0
    }));
  } finally {
    await app.close();
    Object.assign(env, saved);
    globalThis.fetch = originalFetch;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
