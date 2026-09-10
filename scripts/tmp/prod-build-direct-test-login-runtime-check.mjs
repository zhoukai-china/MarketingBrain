// 发布前只读门禁：确认「生产构建」不会误开内测免登录。
//
// 背景：apps/web/.env.development.local 里有 VITE_DIRECT_TEST_LOGIN=true，
// 只应在 vite dev 生效。生产实例走 `VITE_BASE_PATH=/os-v2/ pnpm -r build`（mode=production），
// 这个文件不该被加载。静态看产物只能看到字符串常量被无条件打包（裁剪不掉），
// 所以这里用真实浏览器跑一遍构建产物：免登录开关若为 true，首屏必然渲染
// 「兰琪美业 · 内测实例 / 正在进入体验工作区」。
//
// 用法：node scripts/tmp/prod-build-direct-test-login-runtime-check.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const distDir = path.resolve(process.cwd(), "apps/web/dist");
const basePrefix = "/os-v2";
const port = Number(process.env.DIRECT_TEST_CHECK_PORT ?? 4477);
const chromePath =
  process.env.DIRECT_TEST_CHECK_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const shotDir = process.env.DIRECT_TEST_CHECK_SHOT_DIR ?? path.join(tmpdir(), `direct-test-login-check-${Date.now()}`);

const DIRECT_TEST_MARKERS = ["正在进入体验工作区", "兰琪美业 · 内测实例", "体验入口暂时打不开"];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2"
};

async function assertDistReady() {
  const indexHtml = path.join(distDir, "index.html");
  await stat(indexHtml).catch(() => {
    throw new Error(`缺少生产构建产物：${indexHtml}（先运行 VITE_BASE_PATH=/os-v2/ pnpm --filter @baolu/web build）`);
  });
  const html = await readFile(indexHtml, "utf8");
  assert.match(html, /\/os-v2\/assets\//, "dist/index.html 不是 /os-v2/ base 的生产构建");
}

// 纯静态服务：把 /os-v2/* 映射到 dist/*，未知路径回落 index.html（SPA 路由）。
function startStaticServer() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (!url.pathname.startsWith(basePrefix)) {
      res.writeHead(404).end("not found");
      return;
    }
    const rel = url.pathname.slice(basePrefix.length).replace(/^\/+/, "");
    const target = path.resolve(distDir, rel === "" ? "index.html" : rel);
    // 目录穿越防护：只允许 dist 内部路径
    if (!target.startsWith(distDir)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    try {
      const body = await readFile(target);
      res.writeHead(200, { "content-type": MIME[path.extname(target).toLowerCase()] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      const html = await readFile(path.join(distDir, "index.html"));
      res.writeHead(200, { "content-type": MIME[".html"] });
      res.end(html);
    }
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function runChromeDumpDom(url, userDataDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      chromePath,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--virtual-time-budget=8000",
        `--user-data-dir=${userDataDir}`,
        "--dump-dom",
        url
      ],
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: true }
    );
    const out = [];
    const err = [];
    child.stdout.on("data", (c) => out.push(c));
    child.stderr.on("data", (c) => err.push(c));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Chrome --dump-dom timeout"));
    }, 60_000);
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0 && out.length === 0) {
        reject(new Error(`Chrome exited ${code}: ${Buffer.concat(err).toString("utf8").slice(0, 400)}`));
        return;
      }
      resolve(Buffer.concat(out).toString("utf8"));
    });
    child.once("error", (cause) => {
      clearTimeout(timer);
      reject(cause);
    });
  });
}

async function main() {
  await assertDistReady();
  await stat(shotDir).catch(async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(shotDir, { recursive: true });
  });

  const server = await startStaticServer();
  const userDataDir = await mkdtemp(path.join(tmpdir(), "direct-test-login-chrome-"));
  const base = `http://127.0.0.1:${port}${basePrefix}`;

  try {
    for (const route of ["/login", "/"]) {
      const dom = await runChromeDumpDom(`${base}${route}`, userDataDir);
      await writeFile(path.join(shotDir, `dom${route.replace(/\//g, "_")}.html`), dom, "utf8");
      const hit = DIRECT_TEST_MARKERS.filter((m) => dom.includes(m));
      assert.equal(
        hit.length,
        0,
        `生产构建 ${route} 出现内测免登录标记：${hit.join("、")}（VITE_DIRECT_TEST_LOGIN 被打开，属 P0）`
      );
      // 反向自检：标记字符串确实被打进了包，只是没有渲染出来。
      console.log(`PASS ${route}：未渲染内测免登录页`);
    }

    const entry = await readFile(path.join(distDir, "index.html"), "utf8");
    const entryRel = (entry.match(/assets\/(index-[A-Za-z0-9_-]+\.js)/) ?? [])[1] ?? "index-missing.js";
    const entryJs = path.join(distDir, "assets", entryRel);
    const bundle = await readFile(entryJs, "utf8");
    // 自检：字符串常量确实被打进了入口包（裁剪不掉），说明上面的 DOM 断言真的在检测渲染结果，
    // 而不是因为文案根本不存在才「凑巧」通过。
    assert.ok(bundle.includes("内测实例"), "自检失败：入口包应仍包含内测字符串常量");
    assert.ok(bundle.includes('VITE_DIRECT_TEST_LOGIN==="true"'), "自检失败：入口包应仍包含免登录判断表达式");
    console.log(`PASS 自检：${path.basename(entryJs)} 含内测字符串与判断表达式，但页面未渲染内测入口`);
    console.log(`DOM 快照：${shotDir}`);
  } finally {
    server.close();
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((error) => {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
