#!/usr/bin/env node
/**
 * 一次性运维探针：连到已经在跑的验收 Chrome（CDP 端口），
 * 把登录页上的「微信授权登录」按钮点掉，让二维码出来，再截图。
 * 用于 LQ-23 生产浏览器验收（脚本本身的按钮文案猜错了，扫码流程要走下去）。
 *
 * 用法: node scripts/tmp/lq23-prod-click-login.mjs --port 9364 --out <png>
 */
import { writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  for (let i = args.length - 1; i >= 0; i -= 1) {
    if (args[i] === flag && args[i + 1]) return args[i + 1];
  }
  return fallback;
}

const port = Number(argValue("--port", "9364"));
const label = argValue("--label", "微信授权登录");
const out = argValue("--out", "");
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
    send(method, params = {}, sessionId) {
      const id = nextId++;
      const message = { id, method, params };
      if (sessionId) message.sessionId = sessionId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify(message));
      });
    },
    close: () => socket.close(),
  };
}

async function main() {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((item) => item.type === "page" && /\/login/.test(item.url));
  if (!page) {
    console.error("没有找到登录页 target:", targets.map((t) => `${t.type} ${t.url}`).join("\n"));
    process.exit(1);
  }
  const root = await connect(page.webSocketDebuggerUrl);
  const result = await root.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const nodes = [...document.querySelectorAll("button, a, [role='button'], div")];
      const hit = nodes.find((node) => (node.textContent || "").trim() === ${JSON.stringify(label)});
      if (!hit) return "not-found";
      hit.click();
      return "clicked";
    })()`,
  });
  console.log("click:", result.result.value, "on", page.url);
  await sleep(3000);
  if (out) {
    const shot = await root.send("Page.captureScreenshot", { format: "png" });
    await writeFile(out, Buffer.from(shot.data, "base64"));
    console.log("screenshot:", out);
  }
  root.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
