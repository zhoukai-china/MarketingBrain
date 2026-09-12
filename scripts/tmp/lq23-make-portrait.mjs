/**
 * 一次性工具：把本地 HTML 渲染成一张**合成**测试人像 JPEG（联调首帧图用）。
 * 不依赖任何真人照片、客户素材或第三方包，只用本机 Chrome 的 headless 截图能力。
 *
 * 用法：node scripts/tmp/lq23-make-portrait.mjs <输出文件路径>
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const chromeCandidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  join(process.env.LOCALAPPDATA ?? "", "ms-playwright", "chromium-1234", "chrome-win64", "chrome.exe"),
  join(process.env.LOCALAPPDATA ?? "", "ms-playwright", "chromium_headless_shell-1234", "chrome-headless-shell-win64", "chrome-headless-shell.exe"),
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
];

const chrome = chromeCandidates.find((candidate) => candidate && existsSync(candidate));
if (!chrome) {
  console.error("no local chrome/edge binary found");
  process.exit(1);
}

const source = resolve("scripts/tmp/lq23-synthetic-portrait.html");
if (!existsSync(source)) {
  console.error(`missing ${source}`);
  process.exit(1);
}

const out = resolve(process.argv[2] ?? "scripts/tmp/lq23-synthetic-portrait.jpg");
const profile = mkdtempSync(join(tmpdir(), "lq23-portrait-"));
const url = `file:///${source.replace(/\\/g, "/")}`;

try {
  const result = spawnSync(
    chrome,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--disable-extensions",
      "--disable-sync",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--metrics-recording-only",
      "--virtual-time-budget=3000",
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--window-size=720,960",
      `--user-data-dir=${profile}`,
      `--screenshot=${out}`,
      url
    ],
    { encoding: "utf8", timeout: 60_000 }
  );
  if (!existsSync(out)) {
    console.error(result.stdout ?? "");
    console.error(result.stderr ?? "");
    console.error("screenshot was not written");
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, chrome, out, bytes: statSync(out).size }));
} finally {
  rmSync(profile, { recursive: true, force: true });
}
