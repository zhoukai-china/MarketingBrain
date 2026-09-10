/**
 * 兰琪驾驶舱 demo 模式的门店 / 角色范围（LQ-20）。
 *
 * `DATA_MODE=demo` 时没有 Membership / Store 表可查，但接口仍必须能表达两种真实
 * 状态，否则前端的两条引导路径永远测不到、也演示不出来：
 * ① 新账号名下**还没有门店** → 驾驶舱返回 `state: "no_store"`，前端显示开店引导；
 * ② 前台 / 店长（非老板）→ 只能看自己那家店，且**不能改目标**（写接口 403）。
 *
 * 与 `services/lanqi-store-profile.ts` 里的 demo 存取一样，这里只服务于演示与
 * 回归测试；数据库模式下门店与角色一律来自 Membership + Store 查询，不读本模块。
 */
import type { UserRole } from "@baolu/shared";
import { accessLevelForRole, type StoreAccess } from "../../services/store-access-guard.js";

export interface DemoStore {
  id: string;
  name: string;
  city: string | null;
}

interface DemoScope {
  role: UserRole;
  stores: DemoStore[];
}

/** 默认演示门店：本地 / 测试实例开箱即用的那一家。 */
const DEFAULT_STORES: readonly DemoStore[] = [
  { id: "demo-store-1", name: "演示门店 · 大连总店", city: "大连" }
];

const scopes = new Map<string, DemoScope>();

export function demoLanqiScope(tenantId: string): DemoScope {
  const found = scopes.get(tenantId);
  if (found) return found;
  return { role: "owner", stores: DEFAULT_STORES.map(store => ({ ...store })) };
}

/** 测试 / 演示专用：把某租户改成「前台角色」或「名下一家店都没有」。 */
export function setDemoLanqiScope(
  tenantId: string,
  patch: { role?: UserRole; stores?: DemoStore[] }
): void {
  const current = demoLanqiScope(tenantId);
  scopes.set(tenantId, {
    role: patch.role ?? current.role,
    stores: patch.stores ? patch.stores.map(store => ({ ...store })) : current.stores
  });
}

/** 测试专用：清空覆盖，回到默认演示门店。 */
export function resetDemoLanqiScopes(): void {
  scopes.clear();
}

/** 由 demo 范围推出与数据库模式同形状的 RBAC 结果。 */
export function demoStoreAccess(tenantId: string): StoreAccess {
  const scope = demoLanqiScope(tenantId);
  return {
    role: scope.role,
    level: accessLevelForRole(scope.role),
    membershipStoreId: scope.stores[0]?.id ?? null
  };
}

/** 按 RBAC 过滤 demo 租户可见门店：老板级看全部，单店角色只看绑定店。 */
export function listDemoVisibleStores(tenantId: string, access: StoreAccess): DemoStore[] {
  const { stores } = demoLanqiScope(tenantId);
  if (access.level === "boss") return stores.map(store => ({ ...store }));
  return access.membershipStoreId
    ? stores.filter(store => store.id === access.membershipStoreId).map(store => ({ ...store }))
    : [];
}
