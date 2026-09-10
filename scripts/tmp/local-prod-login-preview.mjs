// 本机「生产模式」登录页预览：把一个 production 构建的 apps/web/dist 按真实 base 路径提供，
// 并把 /api 反代到目标实例，用来在非免登录实例上验收登录 / 注册页渲染。
// 生产构建（import.meta.env.PROD=true）才会走 LoginPage 的 mode="production" 分支；
// vite dev 的 mode="dev" 会强制按开放注册渲染，无法验证 INVITE_REQUIRED 分流。
// 用法：PREVIEW_API_TARGET=https://api.lcppch.top/lanqi-test/api node scripts/tmp/local-prod-login-preview.mjs
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(fileURLToPath(new URL("../../apps/web/dist", import.meta.url)));
const base = process.env.PREVIEW_BASE_PATH ?? "/os-v2/";
const webPort = Number(process.env.PREVIEW_WEB_PORT ?? 4173);
const apiPort = Number(process.env.PREVIEW_API_PORT ?? 3011);
const apiTarget = (process.env.PREVIEW_API_TARGET ?? "https://api.lcppch.top/os-v2/api").replace(/\/+$/, "");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8"
};

const webServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  let pathname = decodeURIComponent(url.pathname);
  if (!pathname.startsWith(base)) {
    res.writeHead(302, { location: base });
    res.end();
    return;
  }
  let rel = pathname.slice(base.length);
  if (rel === "" || !path.extname(rel)) rel = "index.html";
  let file = path.join(webRoot, rel);
  try {
    const info = await stat(file);
    if (info.isDirectory()) file = path.join(file, "index.html");
  } catch {
    file = path.join(webRoot, "index.html");
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});

const apiServer = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  try {
    const upstream = await fetch(`${apiTarget}${req.url ?? "/"}`, {
      method: req.method,
      headers: { ...req.headers, host: new URL(apiTarget).host },
      body: ["GET", "HEAD"].includes(req.method ?? "GET") ? undefined : body
    });
    const headers = {};
    upstream.headers.forEach((value, key) => {
      if (["content-encoding", "content-length", "transfer-encoding", "connection"].includes(key)) return;
      headers[key] = value;
    });
    headers["access-control-allow-origin"] = "*";
    // 负向对照：把 /auth/wechat-config 的 inviteRequired 改写成 true，
    // 用来验证「邀请制实例仍然渲染邀请码入口」这条不应被本次改动破坏的路径。
    if (process.env.PREVIEW_FORCE_INVITE_REQUIRED === "true" && (req.url ?? "").startsWith("/auth/wechat-config")) {
      const payload = JSON.parse(Buffer.from(await upstream.arrayBuffer()).toString("utf8"));
      payload.inviteRequired = true;
      const body = Buffer.from(JSON.stringify(payload), "utf8");
      res.writeHead(upstream.status, { ...headers, "content-type": "application/json; charset=utf-8" });
      res.end(body);
      return;
    }
    res.writeHead(upstream.status, headers);
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (cause) {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end(`proxy error: ${cause instanceof Error ? cause.message : cause}`);
  }
});

await new Promise((r) => webServer.listen(webPort, "127.0.0.1", r));
// 应用读的是 http://localhost:3011（lib/api.ts 对 localhost/127.0.0.1 的固定回退），
// Windows 上 localhost 可能先解析到 ::1，因此这里不绑定具体地址，走双栈监听。
await new Promise((r) => apiServer.listen(apiPort, r));

console.log(`preview_web=http://127.0.0.1:${webPort}${base}`);
console.log(`preview_api=http://127.0.0.1:${apiPort} -> ${apiTarget}`);
console.log("local_prod_login_preview:READY");

const shutdown = () => {
  webServer.close();
  apiServer.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
