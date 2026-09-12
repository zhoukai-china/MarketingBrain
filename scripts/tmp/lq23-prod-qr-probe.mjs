#!/usr/bin/env node
/**
 * 一次性运维探针：读取正在跑的验收 Chrome（CDP 端口）里登录页的可见文案，
 * 判断微信二维码是否已经过期；加 --refresh 时点一次「刷新二维码」。
 *
 * 用法: node scripts/tmp/lq23-prod-qr-probe.mjs --port 9365 [--refresh] [--out <png>]
 */
import { writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  for (let i = args.length - 1; i >= 0; i -= 1) {
    if (args[i] === flag && args[i + 1]) return args[i + 1];
  }
  return fallback;
}

const port = Number(argValue("--port", "9365"));
const out = argValue("--out", "");
const refresh = args.includes("--refresh");
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

async function main() {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((item) => item.type === "page" && /lcppch\.top/.test(item.url));
  if (!page) {
    console.error("没有找到目标页:", targets.map((t) => `${t.type} ${t.url}`).join("\n"));
    process.exit(1);
  }
  const root = await connect(page.webSocketDebuggerUrl);
  const text = await root.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => (document.body ? document.body.innerText : "").replace(/\\s+/g, " "))()`,
  });
  console.log("url:", page.url);
  console.log("text:", String(text.result.value).slice(0, 400));

  if (refresh) {
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
    console.log("refresh:", clicked.result.value);
    await sleep(3000);
  }

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
