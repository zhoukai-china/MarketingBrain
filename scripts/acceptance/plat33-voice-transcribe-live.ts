// PLAT-33 真实链路验收：用一段真实中文录音走一遍 `/voice/transcribe`，确认真能转出中文。
//
// 这是**手工验收脚本**（不在 qa:* 门禁里）：它会真的调用百炼 ASR，产生极小费用，
// 需要真实 Key。用法：
//
//   node apps/api/node_modules/tsx/dist/cli.mjs scripts/acceptance/plat33-voice-transcribe-live.ts <音频文件>
//
// 默认读 `apps/api/.env`（生产/测试同源配置），并强制 DATA_MODE=demo 以免碰数据库。
// 只把「转写文字 + 脱敏观测」打到 stdout，不上传、不落盘、不写数据库、不扣积分。
import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import Fastify from "../../apps/api/node_modules/fastify/fastify.js";
import multipart from "../../apps/api/node_modules/@fastify/multipart/index.js";

async function main(): Promise<void> {
  const audioPath = process.argv[2];
  if (!audioPath) {
    console.error("用法：node apps/api/node_modules/tsx/dist/cli.mjs scripts/acceptance/plat33-voice-transcribe-live.ts <音频文件>");
    process.exitCode = 2;
    return;
  }
  dotenv.config({ path: "apps/api/.env", quiet: true });
  process.env.DATA_MODE = "demo";
  process.env.NODE_ENV = "test";

  const { env } = await import("../../apps/api/src/config/env.js");
  const { registerVoiceRoutes } = await import("../../apps/api/src/routes/voice.js");
  const { createSessionToken } = await import("../../apps/api/src/services/auth-token.js");

  if (!env.ALIYUN_API_KEY && !env.DASHSCOPE_API_KEY) {
    console.error("FAIL: 本地没有百炼 Key，无法做真实转写验收。");
    process.exitCode = 3;
    return;
  }

  const bytes = await readFile(audioPath);
  const ext = basename(audioPath).split(".").pop()?.toLowerCase() ?? "mp3";
  const mime = ext === "wav" ? "audio/wav" : ext === "m4a" ? "audio/mp4" : ext === "webm" ? "audio/webm" : "audio/mpeg";

  const app = Fastify({ disableRequestLogging: true });
  await app.register(multipart, { limits: { fileSize: 12 * 1024 * 1024 } });
  await registerVoiceRoutes(app);

  const boundary = "plat33-live-boundary";
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="live-voice.${ext}"\r\nContent-Type: ${mime}\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);

  const startedAt = Date.now();
  const response = await app.inject({
    method: "POST",
    url: "/voice/transcribe",
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      authorization: `Bearer ${createSessionToken({ tenantId: "plat33-live-tenant", userId: "plat33-live-user", ttlSeconds: 300 })}`
    },
    payload
  });
  await app.close();

  const body = response.json() as {
    transcript?: string;
    purpose?: string;
    creditCost?: number;
    elapsedMs?: number;
    warnings?: string[];
    providerTrace?: Array<{ terminalStatus?: string; terminalCode?: string; requestFingerprint?: string; billingStarted?: string; model?: string; usage?: { audioSeconds?: number } }>;
  };
  const observation = body.providerTrace?.[0] ?? {};
  console.log(JSON.stringify({
    status: response.statusCode,
    model: observation.model,
    purpose: body.purpose,
    transcript: body.transcript ?? "",
    transcriptChars: (body.transcript ?? "").length,
    warnings: body.warnings ?? [],
    creditCost: body.creditCost,
    elapsedMs: body.elapsedMs,
    wallClockMs: Date.now() - startedAt,
    provider: {
      terminalStatus: observation.terminalStatus,
      terminalCode: observation.terminalCode,
      billingStarted: observation.billingStarted,
      requestFingerprint: observation.requestFingerprint
    },
    audioFile: basename(audioPath),
    audioBytes: bytes.byteLength
  }, null, 2));
  if (response.statusCode !== 200 || !(body.transcript ?? "").trim()) {
    console.error("FAIL: 真实转写没有拿到文字。");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
