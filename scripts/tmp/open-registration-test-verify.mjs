#!/usr/bin/env node
/**
 * 只读/受控复验：平台主入口开放注册（去掉邀请码）在目标实例上的真实行为。
 *
 * 断言（不含“不应发生”的反向验证）：
 *  1. GET /auth/wechat-config -> inviteRequired = false
 *  2. POST /auth/beta-login 省略 inviteCode -> 不得因 schema 400，应进入正常登录/注册流程
 *  3. POST /auth/beta-login inviteCode="" -> 同上
 *  4. POST /auth/beta-login inviteCode="不存在的邀请码" -> 403 invite_code_not_found（邀请制语义未被误删）
 *  5. POST /auth/beta-login 带 productCode 但空 inviteCode -> 必须 403 invite_code_required，绝不可放行
 *  6. POST /auth/product-invite/validate 带 productCode 但空 inviteCode -> 必须 400（产品 schema 仍必填）
 *
 * 用法：node scripts/tmp/open-registration-test-verify.mjs [apiBase]
 */
const apiBase = (process.argv[2] || process.env.VERIFY_API_BASE || 'https://api.lcppch.top/lanqi-test/api').replace(/\/+$/, '');

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
}

async function req(method, path, body) {
  const res = await fetch(`${apiBase}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, text: text.slice(0, 400), json };
}

function fieldErrors(out) {
  return out?.json?.details?.fieldErrors || null;
}

(async () => {
  console.log(`apiBase=${apiBase}`);

  const cfg = await req('GET', '/auth/wechat-config');
  record(
    'wechat-config.inviteRequired=false',
    cfg.status === 200 && cfg.json?.inviteRequired === false,
    `http=${cfg.status} inviteRequired=${cfg.json?.inviteRequired}`,
  );

  const empty = await req('POST', '/auth/beta-login', { inviteCode: '' });
  const emptySchemaBlocked = empty.status === 400 && !!fieldErrors(empty)?.inviteCode;
  record(
    'beta-login 空邀请码不再被 schema 拦截',
    !emptySchemaBlocked,
    `http=${empty.status} body=${empty.text}`,
  );

  const absent = await req('POST', '/auth/beta-login', {});
  const absentSchemaBlocked = absent.status === 400 && !!fieldErrors(absent)?.inviteCode;
  record(
    'beta-login 缺省邀请码不再被 schema 拦截',
    !absentSchemaBlocked,
    `http=${absent.status} body=${absent.text}`,
  );

  const bogus = await req('POST', '/auth/beta-login', { inviteCode: 'CODE-DOES-NOT-EXIST-0910' });
  record(
    'beta-login 无效邀请码仍被拒绝（邀请制语义保留）',
    bogus.status === 403 && bogus.json?.error === 'invite_code_not_found',
    `http=${bogus.status} body=${bogus.text}`,
  );

  const productBypass = await req('POST', '/auth/beta-login', {
    productCode: 'lanqi',
    inviteCode: '',
  });
  record(
    'beta-login 带 productCode 空邀请码不得放行',
    productBypass.status === 403 && productBypass.json?.error === 'invite_code_required',
    `http=${productBypass.status} body=${productBypass.text}`,
  );

  const productValidate = await req('POST', '/auth/product-invite/validate', {
    productCode: 'lanqi',
    inviteCode: '',
  });
  record(
    'product-invite/validate 空邀请码仍 400 必填',
    productValidate.status === 400,
    `http=${productValidate.status} body=${productValidate.text}`,
  );

  const failed = results.filter((r) => !r.ok);
  console.log(`\nSUMMARY total=${results.length} pass=${results.length - failed.length} fail=${failed.length}`);
  process.exit(failed.length === 0 ? 0 : 1);
})().catch((err) => {
  console.error('VERIFY_ERROR', err?.message || err);
  process.exit(2);
});
