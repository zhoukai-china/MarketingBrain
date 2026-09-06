import os from "node:os";
import path from "node:path";

process.env.NODE_ENV = "test";
process.env.DATA_MODE = "demo";
process.env.SKILL_MCP_ENABLED = "false";
process.env.LANQI_MEDIA_EXECUTION_MODE = "mock";
process.env.LANQI_MEDIA_ASSET_STORAGE = "disabled";
process.env.UPLOAD_DIR = path.join(os.tmpdir(), "lanqi-xhs-package-browser-e2e");
process.env.JWT_SECRET = "lanqi-xhs-package-browser-e2e-only";

const skillAnswer = `标题候选：
1. 初秋补水护理，到店前先确认这三件事
2. 换季日常护理怎么选？先看这份准备清单
3. 附近上班族的初秋护理小笔记

正文：
初秋气候变化时，可以先记录自己的日常护理需求，再向本店核对当前能够提供的服务和预约安排。日常补水护理不能替代医疗诊断或治疗；价格、效果和顾客案例均不在本稿中作承诺。

话题标签：
#小红书笔记 #初秋护理 #日常补水 #到店体验 #本地生活

互动与承接：
你换季时最想先确认哪项日常护理信息？具体承接方式待门店确认。

发布前核对：
本稿只使用门店已确认事实，未引用未激活的兰琪方法论、内部定价、疗效、价格或顾客案例。`;

async function main() {
const [{ default: fastify }, { default: cors }, { registerAuthRoutes }, { registerLanqiContentStudioRoutes }, { registerLanqiMediaGenerationRoutes }, { registerLanqiXhsPackageRoutes }] = await Promise.all([
  import("../apps/api/node_modules/fastify/fastify.js"),
  import("../apps/api/node_modules/@fastify/cors/index.js"),
  import("../apps/api/src/routes/auth.ts"),
  import("../apps/api/src/routes/lanqi-content-studio.ts"),
  import("../apps/api/src/routes/lanqi-media-generation.ts"),
  import("../apps/api/src/routes/lanqi-xhs-package.ts"),
]);

let providerCalls = 0;
const provider = {
  name: "lanqi-xhs-package-browser-e2e",
  async complete() {
    providerCalls += 1;
    return skillAnswer;
  },
};
const app = fastify({ logger: true });
await app.register(cors, { origin: true, credentials: true });
await registerAuthRoutes(app);
await registerLanqiContentStudioRoutes(app, provider);
await registerLanqiMediaGenerationRoutes(app, provider);
await registerLanqiXhsPackageRoutes(app, provider);
app.get("/ready", async () => ({ ok: true, dataMode: "demo", providerCalls, paidProviderCalls: 0 }));

const port = Number(process.env.PORT || 3016);
await app.listen({ host: "127.0.0.1", port });
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
