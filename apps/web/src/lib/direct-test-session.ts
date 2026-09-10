import { apiPath } from "./api.js";
import { isProductLoginCode } from "@baolu/shared";

/**
 * 仅内测实例使用的免登录入口。
 *
 * 开关在构建期（VITE_DIRECT_TEST_LOGIN）与运行期（DIRECT_TEST_LOGIN）同时为 true 时才会生效，
 * 生产实例没有这两个开关，因此本文件在生产等同于空实现。
 * 账号密码登录由思潼 AI 平台统一设计后接入，这里只是让内测用户直接进到美业智能体。
 */

const TOKEN_KEY = "store_os_token";
const TENANT_ROLE_KEY = "store_os_tenant_role";
const TENANT_NAME_KEY = "store_os_tenant_name";

export const DIRECT_TEST_LOGIN_ENABLED = import.meta.env.VITE_DIRECT_TEST_LOGIN === "true";

const TEST_TENANT_NAME = "兰琪美业体验工作区";

/**
 * 免登录实例开通哪个产品，由构建期 `VITE_DIRECT_TEST_PRODUCT` 决定，默认兰琪。
 * 一个租户同时只持有一个产品 entitlement，所以这里必须和实例上真正要体验的
 * 产品一致，否则页面会拿到 403（WorkBuddy 2026-09-10 报告 Bug1）。
 */
const DIRECT_TEST_PRODUCT_RAW = import.meta.env.VITE_DIRECT_TEST_PRODUCT as string | undefined;
const DIRECT_TEST_PRODUCT_CODE = isProductLoginCode(DIRECT_TEST_PRODUCT_RAW)
  ? DIRECT_TEST_PRODUCT_RAW
  : "lanqi";

/** 会话可用性探针必须打在同一个产品作用域下，否则永远探到 403。 */
const DIRECT_TEST_PROBE_PATH = DIRECT_TEST_PRODUCT_CODE === "beauty-industry"
  ? "/beauty-industry/stores"
  : `/${DIRECT_TEST_PRODUCT_CODE}/stores`;

export function readStoredToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? "";
}

async function sessionIsUsable(token: string): Promise<boolean> {
  try {
    const response = await fetch(apiPath(DIRECT_TEST_PROBE_PATH), {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function createTestSession(): Promise<void> {
  const response = await fetch(apiPath("/auth/dev-login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      productCode: DIRECT_TEST_PRODUCT_CODE,
      tenantRole: "local_business",
      tenantName: TEST_TENANT_NAME,
      industry: "美业",
    }),
  });
  const data = (await response.json().catch(() => ({}))) as {
    token?: string;
    tenantRole?: string;
    tenantName?: string;
    message?: string;
    error?: string;
  };
  if (!response.ok || !data.token) {
    throw new Error(data.message ?? data.error ?? "本机体验登录暂时不可用。");
  }
  localStorage.setItem(TOKEN_KEY, data.token);
  localStorage.setItem(TENANT_ROLE_KEY, data.tenantRole ?? "local_business");
  localStorage.setItem(TENANT_NAME_KEY, data.tenantName ?? TEST_TENANT_NAME);
}

let inflightSession: Promise<void> | null = null;

/**
 * 确保内测实例始终持有一个可用会话：
 * 已有可用会话直接返回，会话缺失或失效则重新建立，不做任何跳转。
 */
export function ensureDirectTestSession(): Promise<void> {
  if (!DIRECT_TEST_LOGIN_ENABLED) return Promise.resolve();
  if (inflightSession) return inflightSession;

  const run = (async () => {
    const existing = readStoredToken();
    if (existing && (await sessionIsUsable(existing))) return;
    await createTestSession();
  })();

  inflightSession = run;
  void run
    .catch(() => undefined)
    .finally(() => {
      if (inflightSession === run) inflightSession = null;
    });
  return run;
}
