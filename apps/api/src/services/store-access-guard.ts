// 兰琪美业门店 AI 经营大脑 · Phase 0a 门店 RBAC（0909）
// 老板(owner/admin)=全门店可见 + agg；店长(manager)/前台(staff/operator)=仅绑定单店，不可见 agg。
// 每次请求由路由层从 Membership 重算，不缓存到端。

export type StoreAccessLevel = "boss" | "store";

export interface StoreAccess {
  role: string;
  level: StoreAccessLevel;
  membershipStoreId: string | null;
}

export function accessLevelForRole(role: string): StoreAccessLevel {
  return role === "owner" || role === "admin" ? "boss" : "store";
}

export function canViewAgg(access: StoreAccess): boolean {
  return access.level === "boss";
}

export function assertStoreVisible(access: StoreAccess, storeId: string): { allowed: boolean; reason?: string } {
  if (!storeId) return { allowed: false, reason: "缺少门店标识" };
  if (access.level === "boss") return { allowed: true };
  if (access.membershipStoreId && access.membershipStoreId === storeId) return { allowed: true };
  return { allowed: false, reason: "无权访问该门店" };
}

export function filterVisibleStoreIds(
  access: StoreAccess,
  tenantStoreIds: string[]
): string[] {
  if (access.level === "boss") return tenantStoreIds;
  return access.membershipStoreId && tenantStoreIds.includes(access.membershipStoreId)
    ? [access.membershipStoreId]
    : [];
}
