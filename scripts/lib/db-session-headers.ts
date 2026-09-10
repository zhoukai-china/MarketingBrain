// P0（QA-20260911-002）：`DATA_MODE=database` 下身份只能来自服务端验签的会话令牌。
// 修复前测试夹具有的地方直接发裸 `x-sitong-tenant-id` / `x-sitong-user-id` 头，
// 那正好复刻了生产漏洞的调用方式；现在统一改成和浏览器/微信登录一致的真实会话令牌。
//
// 用法：把原来的 `{ "x-sitong-tenant-id": tenantId, "x-sitong-user-id": userId }`
// 换成 `sessionHeaders(tenantId, userId)`，额外头（content-type / 演示用 profile 等）
// 通过第三个参数传入，仍会原样保留。
import { createSessionToken } from "../../apps/api/src/services/auth-token.js";

export function sessionHeaders(
  tenantId: string,
  userId: string,
  extra: Record<string, string> = {}
): Record<string, string> {
  const planCode = extra["x-sitong-plan"];
  return {
    ...extra,
    authorization: `Bearer ${createSessionToken({
      tenantId,
      userId,
      planCode: planCode as Parameters<typeof createSessionToken>[0]["planCode"]
    })}`
  };
}
