import {
  accessLevelForRole,
  canViewAgg,
  assertStoreVisible,
  filterVisibleStoreIds,
  type StoreAccess
} from "../apps/api/src/services/store-access-guard.js";

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`ok - ${name}`); }
  else { fail++; console.error(`FAIL - ${name}`); }
}

const boss: StoreAccess = { role: "owner", level: accessLevelForRole("owner"), membershipStoreId: "s1" };
const managerA: StoreAccess = { role: "manager", level: accessLevelForRole("manager"), membershipStoreId: "s1" };
const staffA: StoreAccess = { role: "staff", level: accessLevelForRole("staff"), membershipStoreId: "s1" };

assert("owner 判老板级", boss.level === "boss");
assert("manager 判单店", managerA.level === "store");
assert("staff 判单店", staffA.level === "store");
assert("owner 可见 agg", canViewAgg(boss) === true);
assert("manager 不可见 agg", canViewAgg(managerA) === false);
assert("staff 不可见 agg", canViewAgg(staffA) === false);

assert("owner 可访问任意本租户店", assertStoreVisible(boss, "s2").allowed === true);
assert("manager 可访问绑定店", assertStoreVisible(managerA, "s1").allowed === true);
assert("manager 不可访问他店", assertStoreVisible(managerA, "s2").allowed === false);
assert("staff 不可访问他店", assertStoreVisible(staffA, "s2").allowed === false);
assert("空 store 拒绝", assertStoreVisible(managerA, "").allowed === false);

const tenantStores = ["s1", "s2", "s3"];
assert("owner 列表=全部", filterVisibleStoreIds(boss, tenantStores).length === 3);
assert("manager 列表=绑定店", JSON.stringify(filterVisibleStoreIds(staffA, tenantStores)) === '["s1"]');
assert("无绑定店的单店用户列表为空", filterVisibleStoreIds({ role: "staff", level: "store", membershipStoreId: null }, tenantStores).length === 0);

console.log(`\nstore-access-guard -> ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
