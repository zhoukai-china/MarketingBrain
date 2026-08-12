import { readFile } from "node:fs/promises";

const [page, helpPage, main] = await Promise.all([
  readFile(new URL("../apps/web/src/pages/EnterpriseKnowledgeBasePage.tsx", import.meta.url), "utf8"),
  readFile(new URL("../apps/web/src/pages/KnowledgeConnectionHelpPage.tsx", import.meta.url), "utf8"),
  readFile(new URL("../apps/web/src/main.tsx", import.meta.url), "utf8")
]);
for (const label of ["得到大脑", "飞书", "企业微信"]) if (!helpPage.includes(label)) throw new Error(`帮助页缺少 ${label} 指引`);
for (const url of ["https://www.biji.com/openapi", "https://open.feishu.cn/app", "https://work.weixin.qq.com/wework_admin/frame#apps"]) if (!helpPage.includes(url) || !page.includes(url)) throw new Error(`缺少官方控制台入口：${url}`);
if (!helpPage.includes("App Secret") || !helpPage.includes("Corp ID") || !helpPage.includes("API Key")) throw new Error("帮助页没有说明凭证字段");
if (!page.includes("不知道密钥在哪里？打开接入帮助")) throw new Error("连接页缺少帮助入口");
if (!main.includes("KnowledgeConnectionHelpPage") || !main.includes("connection-help")) throw new Error("帮助页路由未注册");
if (!helpPage.includes("不会替你登录平台") || !helpPage.includes("不要向任何人发送")) throw new Error("帮助页缺少密钥安全边界");
console.log("Knowledge connection onboarding smoke passed.");
