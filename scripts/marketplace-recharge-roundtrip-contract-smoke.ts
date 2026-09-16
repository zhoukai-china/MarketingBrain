// PLAT-63：余额不足 → 充值 → 回到原智能体**不丢输入** 的往返契约回归。
//
// 触发（2026-09-16）：WorkBuddy 验收报告的 P2「充值往返状态恢复未经验证」+ 用户现场反馈
// 「新用户填完 5 项发现没积分，去充值回来还得重填」。原来的行为：402 只在聊天区显示一句
// 「当前积分不足，请先充值后再使用。」，客户得自己从顶栏找充值入口，也没有任何「回来继续」的提示
// （服务端 402 里的 `rechargeUrl` 是给 MCP/外部编排用的相对路径，网页从没读过它，
// 而且它不带 `/os-v2/`、`/lanqi-test/` 这类应用前缀，网页直接跳会打到站外路径）。
//
// 本用例守护三件事：
//   1. 回跳参数 `next` 的取值只允许站内绝对路径（开放跳转防护），且能覆盖真实路由（含下划线、query）。
//   2. 对话页在 402 时给出带 `next` 的动作按钮，且 `next` 用 `getAppRoutePath()` 去掉应用前缀
//      （避免 `/lanqi-test/lanqi-test/...` 这种前缀拼两遍）。
//   3. 充值页把 `next` 交给 `getAppPath()` 还原，并提供「返回继续生成」按钮（登录前 / 登录后都在）。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const chatPath = "apps/web/src/marketplace/AgentChatPage.tsx";
const rechargePath = "apps/web/src/pages/RechargePage.tsx";
const helperPath = "apps/web/src/lib/app-route.ts";

let failed = 0;
function check(ok: boolean, label: string) {
  console.log(`[${ok ? "PASS" : "FAIL"}] ${label}`);
  if (!ok) failed += 1;
}

async function main() {
  const chat = readFileSync(chatPath, "utf8");
  const recharge = readFileSync(rechargePath, "utf8");
  const mod = (await import(pathToFileURL(resolve(helperPath)).href)) as {
    toSafeAppRoute: (value: string | null | undefined) => string;
  };
  const safe = mod.toSafeAppRoute;

  // ① 站内路由放行 + 跨站写法一律拒绝（fail closed）。
  check(safe("/agent/ipzone__copy/chat") === "/agent/ipzone__copy/chat", "放行站内路由（含下划线）：/agent/ipzone__copy/chat");
  check(
    safe("/agent/ipzone__copy/chat?ref=x&from=y") === "/agent/ipzone__copy/chat?ref=x&from=y",
    "放行带 query 的站内路由"
  );
  check(safe("/recharge") === "/recharge", "放行普通站内路径");
  for (const bad of ["//evil.com", "https://evil.com", "http://evil.com", "javascript:alert(1)", "/a\\b", "/a b", "  ", "", null, undefined]) {
    check(safe(bad) === "", `拒绝非站内取值：${JSON.stringify(bad)}`);
  }
  check(safe("/\\evil.com") === "", "拒绝反斜杠绕过：/\\evil.com");
  check(safe("/agents") === "/agents", "正向对照：正常站内路径不受白名单误伤");

  // ② 对话页：402 走单独分支，带 next 的动作按钮，且 next 由 getAppRoutePath 去掉应用前缀。
  check(/runResponse\.status === 402/.test(chat), "对话页对 402 有独立分支（不再只抛一句错误文案）");
  check(/getAppRoutePath\(window\.location\.pathname\)/.test(chat), "next 用 getAppRoutePath() 去掉 /os-v2/、/lanqi-test/ 这类应用前缀");
  check(/from=agent&skill=\$\{encodeURIComponent\(runSku\.skuCode\)\}&next=\$\{encodeURIComponent\(nextRoute\)\}/.test(chat), "去充值链接带 from=agent + skill + next");
  check(/action:\s*\{/.test(chat) && /label: "去充值（回来不用重填）"/.test(chat), "动作按钮文案明确「回来不用重填」");
  check(/不用\*\*重填\*\*|不用重填/.test(chat), "402 提示里写明「不用重填」");
  check(!/window\.location\.href\s*=\s*"\/recharge/.test(chat), "对话页不直接跳裸 /recharge（会丢应用前缀）");

  // ③ 充值页：用同一个白名单函数 + getAppPath 还原 + 两个分支都渲染回头按钮。
  check(/import \{ toSafeAppRoute \} from "\.\.\/lib\/app-route\.js"/.test(recharge), "充值页导入 toSafeAppRoute（与对话页同一个口径）");
  check(/const nextRoute = toSafeAppRoute\(query\.get\("next"\)\)/.test(recharge), "next 经 toSafeAppRoute 白名单过滤后才使用");
  check(/window\.location\.href = getAppPath\(nextRoute\)/.test(recharge), "回跳时用 getAppPath() 补回应用前缀");
  const backButtons = (recharge.match(/返回继续生成/g) ?? []).length;
  check(backButtons >= 2, `登录前 / 登录后都渲染「返回继续生成」（命中 ${backButtons} 处）`);
  check(/你已经填的内容留在本机，不会丢，不用重填/.test(recharge), "充值页明确告知「已填内容不会丢、不用重填」");

  // ④ 本机留存仍在（这条是「回来还在」的底层保证，plat56 的能力不能被回退掉）。
  check(/sitong_chat_\$\{runSku\?\.skuCode \?\? ""\}/.test(chat), "对话页仍按 SKU 存本机草稿（回来能恢复）");
  /**
   * ⑤ 指纹必须是**稳定身份**（tenantId:userId），不能又退回 token 末 8 位。
   * 2026-09-16 真机复现过：token 被重新签发（重新登录 / 内测免登录门卫重建会话）时，
   * 同一账号的草稿会被判成「换了人」直接丢掉。
   */
  check(/fp: readSessionIdentity\(\)/.test(chat), "写入草稿用的指纹 = readSessionIdentity()（稳定身份，不是 token 尾巴）");
  check(/saved\.fp === readSessionIdentity\(\)/.test(chat), "恢复草稿时按同一稳定身份比对");
  check(!/slice\(-8\)[\s\S]{0,40}fp|fp[\s\S]{0,40}slice\(-8\)/.test(chat), "对话页不再用 token 末 8 位当草稿指纹");
  check(/export function readSessionIdentity/.test(readFileSync("apps/web/src/lib/session.ts", "utf8")), "session.ts 提供 readSessionIdentity()（稳定的 tenantId:userId 指纹）");

  if (failed > 0) {
    console.error(`marketplace_recharge_roundtrip_contract_smoke: FAIL (${failed} failed)`);
    process.exit(1);
  }
  console.log("marketplace_recharge_roundtrip_contract_smoke: PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
