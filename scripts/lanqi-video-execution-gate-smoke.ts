// LQ-27 付费执行门禁的密钥形状用例（先红后绿）。
//
// 现场（2026-09-13，生产真事）：受控执行自检要求
//   /^sk-[A-Za-z0-9_-]{16,}$/
// 但生产在用的工作区密钥形如 `sk-ws-….<有小数点>`，末尾还有 CRLF 带来的 `\r`。
// 结果：配置合法却永远 503 execution_configuration_invalid，付费链路无法开通。
// 这里锁两件事：① 真实形状（含 `.`）必须通过；② 明显不是密钥的串必须被拒。
import { isProviderKeyShaped } from "../apps/api/src/services/beauty-video-controlled-execution.js";

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`ok - ${name}`); }
  else { fail++; console.error(`FAIL - ${name}`); }
}

assert("真实工作区密钥（含小数点）通过", isProviderKeyShaped("sk-ws-abcdefghijklmnop.qrstuvwx"));
assert("纯字母数字密钥通过", isProviderKeyShaped("sk-abcdefghijklmnop1234"));
assert("下划线/连字符通过", isProviderKeyShaped("sk-abc_def-ghijklmnop"));
assert("尾部 CR 被容忍（env 换行残留）", isProviderKeyShaped("sk-ws-abcdefghijklmnop.qrstuvwx\r"));
assert("空值被拒", !isProviderKeyShaped(""));
assert("不以 sk- 开头被拒", !isProviderKeyShaped("pk-abcdefghijklmnopqrst"));
assert("太短被拒", !isProviderKeyShaped("sk-short"));
assert("含空格被拒", !isProviderKeyShaped("sk-abcdefghij klmnopqrst"));

console.log(`\nlanqi video execution gate smoke: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
