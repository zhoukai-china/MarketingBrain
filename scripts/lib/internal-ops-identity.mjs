// 内部运维身份通道（P0 / QA-20260911-002）。
//
// 背景：`DATA_MODE=database` 下身份只能来自服务端验签的会话令牌。生产运维脚本
// （打 127.0.0.1:3002 等本机端口、直接用 Postgres 造/读数据）没有浏览器会话，
// 以前靠裸 `x-sitong-tenant-id` / `x-sitong-user-id` 头冒充成员，那正好是本次
// 修复掉的漏洞入口。现在它们必须显式证明运维身份：携带与 API 进程同源的
// `OPS_TOKEN`（请求头 `x-sitong-ops-token`）。API 端只在 `OPS_TOKEN` 非空且
// 常量时间匹配时才承认这组裸头（见 apps/api/src/services/request-context.ts）。
//
// 令牌来源顺序：process.env.SITONG_OPS_TOKEN → process.env.OPS_TOKEN → .env 文件。
// 都拿不到时直接抛错，不静默降级成「无凭证请求」。
import { readFileSync } from "node:fs";

function defaultEnvFiles() {
  return [
    process.env.SITONG_ENV_FILE,
    "/opt/baolu-os-v2/.env",
    "apps/api/.env",
    ".env"
  ].filter(Boolean);
}

export function readOpsTokenFromEnvFile(file) {
  try {
    const content = readFileSync(file, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?OPS_TOKEN\s*=\s*(.*)$/.exec(line);
      if (!match) continue;
      const value = match[1].trim().replace(/^["']|["']$/g, "");
      if (value) return value;
    }
  } catch {
    // 文件不存在或不可读：继续尝试下一个来源。
  }
  return undefined;
}

export function resolveInternalOpsToken() {
  const fromEnv = process.env.SITONG_OPS_TOKEN ?? process.env.OPS_TOKEN;
  if (fromEnv) return fromEnv;
  for (const file of defaultEnvFiles()) {
    const value = readOpsTokenFromEnvFile(file);
    if (value) return value;
  }
  throw new Error(
    "internal_ops_token_required: 内部运维脚本必须携带 x-sitong-ops-token。"
    + "请设置 SITONG_OPS_TOKEN/OPS_TOKEN，或保证默认 .env 可读（P0 QA-20260911-002）"
  );
}

export function internalIdentityHeaders(identity) {
  return {
    "x-sitong-tenant-id": identity.tenantId,
    "x-sitong-user-id": identity.userId,
    "x-sitong-ops-token": resolveInternalOpsToken()
  };
}
