#!/usr/bin/env node
/**
 * 一次性运维探针：给正在跑的验收 Chrome（CDP 端口）里的微信登录二维码保活。
 *
 * 背景：微信扫码登录码有有效期（通常几分钟），而 LQ-23 生产浏览器级验收要等真人到场扫码，
 * 等待窗口远长于码的有效期。本脚本每隔 `--interval` 秒点一次「刷新二维码」，
 * 并在页面离开 `/login`（即扫码成功）后自动退出。
 *
 * 用法: node scripts/tmp/lq23-prod-qr-keepalive.mjs --port 9365 --interval 240 --max-minutes 60
 */
const args = process.argv.slice(2);
function argValue(flag, fallback) {
  for (let i = args.length - 1; i >= 0; i -= 1) {
    if (args[i] === flag && args[i + 1]) return args[i + 1];
  }
  return fallback;
}

const port = Number(argValue("--port", "9365"));
const intervalSeconds = Number(argValue("--interval", "240"));
const maxMinutes = Number(argValue("--max-minutes", "60"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("CDP 连接失败")), { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (payload.id && pending.has(payload.id)) {
      const { resolve, reject } = pending.get(payload.id);
      pending.delete(payload.id);
      if (payload.error) reject(new Error(payload.error.message));
      else resolve(payload.result);
    }
  });
  return {
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close: () => socket.close(),
  };
}

const stamp = () => new Date().toISOString().slice(11, 19);

async function main() {
  const deadline = Date.now() + maxMinutes * 60_000;
  let round = 0;
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = targets.find((item) => item.type === "page" && /lcppch\.top/.test(item.url));
      if (!page) {
        console.log(`[${stamp()}] 浏览器已关闭，退出。`);
        return;
      }
      if (!/\/login/.test(page.url)) {
        console.log(`[${stamp()}] 已离开登录页（${page.url}），扫码成功，退出保活。`);
        return;
      }
      const root = await connect(page.webSocketDebuggerUrl);
      if (round > 0) {
        const clicked = await root.send("Runtime.evaluate", {
          returnByValue: true,
          expression: `(() => {
            const nodes = [...document.querySelectorAll("button, a, [role='button'], div, span")];
            const hit = nodes.find((node) => (node.textContent || "").trim() === "刷新二维码");
            if (!hit) return "not-found";
            hit.click();
            return "clicked";
          })()`,
        });
        console.log(`[${stamp()}] 刷新二维码: ${clicked.result.value}`);
      } else {
        console.log(`[${stamp()}] 首次进入，二维码已在页面上。`);
      }
      root.close();
      round += 1;
    } catch (error) {
      console.log(`[${stamp()}] 本轮失败：${error.message}`);
    }
    await sleep(intervalSeconds * 1000);
  }
  console.log(`[${stamp()}] 到达最长保活时间（${maxMinutes} 分钟），退出。`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
