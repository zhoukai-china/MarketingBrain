#!/usr/bin/env node
/**
 * 兰琪私域营销 · 配图资产「作用域一致性」部署实例复验。
 *
 * 与 `scripts/lanqi-moments-asset-scope-smoke.ts` 的分工：
 *  - scope-smoke 在**本机**用假 entitlement 钩子复刻 `server.ts` 的作用域组合，
 *    证明的是「契约本身正确」，不碰任何部署实例；
 *  - 本脚本打**已部署实例**（默认 `https://api.lcppch.top/lanqi-test`），
 *    证明「实例上跑的这份构建确实按修复后的作用域发 URL，且取图真的是 PNG」。
 *
 * 为什么要单独有这一条：
 * 用户报障「AI 配图没有正常生成」（QA-20260910-021），真实现场证据是
 * `POST /lanqi/moments/image 200` 之后紧跟 `GET /beauty-industry/moments/assets/<id> 403`
 * ——生图是好的，取图落错了产品作用域。本机 smoke 过不了这条，因为它看不到
 * 实例上真正注册的路由与真正生效的 entitlement。
 *
 * 做法（不调用任何模型、不产生任何费用）：
 *  1. 用实例的 `POST {base}/api/auth/dev-login` 取两个**不同的兰琪租户**会话；
 *  2. 给租户 A 播一条 1×1 合成 PNG 资产（仅测试实例，脚本结束一定删除）；
 *  3. 断言四条对外可见的契约：
 *       a. 租户 A 打 `{base}/api/lanqi/moments/assets/<id>`            → 200 + image/png + PNG 魔数
 *       b. 租户 A 打 `{base}/api/beauty-industry/moments/assets/<id>` → 403（这就是用户当时看到的破图成因）
 *       c. 租户 B 打 `{base}/api/lanqi/moments/assets/<id>`           → 404（租户隔离）
 *       d. 不带会话打 `{base}/api/lanqi/moments/assets/<id>`          → 401
 *
 * 前置条件：能免登录的**内测实例**（`DIRECT_TEST_LOGIN=true`）；生产没有 dev-login，
 * 本脚本会在第 1 步明确失败而不是给出假结论。
 *
 * 用法：
 *   node scripts/lanqi-moments-asset-deployed-check.mjs
 *   node scripts/lanqi-moments-asset-deployed-check.mjs --base https://api.lcppch.top/lanqi-test
 *   node scripts/lanqi-moments-asset-deployed-check.mjs --keep-asset   # 排查用，保留播下去的合成资产
 *   node scripts/lanqi-moments-asset-deployed-check.mjs --keep-tenants # 排查用，保留一次性租户
 *
 * 收尾：合成资产与 `dev-login` 建出来的两个一次性租户都会在本轮结束前精确回收
 * （只按本轮拿到的 tenantId 删，不碰实例上任何既有租户）。
 */
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  let found = fallback;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === flag && args[i + 1]) found = args[i + 1];
  }
  return found;
}
const hasFlag = (flag) => args.includes(flag);

const base = argValue("--base", "https://api.lcppch.top/lanqi-test").replace(/\/+$/, "");
const sshHost = argValue("--ssh-host", "root@api.lcppch.top");
const sshKey = argValue("--ssh-key", "C:\\Users\\book\\.ssh\\sales_copilot_20260618");
const dbName = argValue("--db", "baolu_os_v2");
const schema = argValue("--schema", "lanqi_test");
const uploadsRoot = argValue("--uploads-root", "/opt/baolu-os-v2-test/uploads");
const assetId = argValue("--asset-id", "lq18-scope-verify-0001");
const keepAsset = hasFlag("--keep-asset");
const keepTenants = hasFlag("--keep-tenants");
if (!/^[A-Za-z0-9_]+$/.test(schema)) throw new Error(`非法 schema：${schema}`);

// 1x1 透明 PNG：只用来证明「取回的是真图片字节」，不含任何客户内容。
const PNG_1X1_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let pass = 0;
let fail = 0;
function assert(name, cond, detail = "") {
  if (cond) {
    pass += 1;
    console.log(`PASS  ${name}${detail ? `  ::  ${detail}` : ""}`);
  } else {
    fail += 1;
    console.error(`FAIL  ${name}${detail ? `  ::  ${detail}` : ""}`);
  }
}

function ssh(script) {
  const result = spawnSync(
    "ssh",
    ["-i", sshKey, "-o", "StrictHostKeyChecking=no", sshHost, script],
    { encoding: "utf8" }
  );
  if (result.error) throw new Error(`ssh 调用失败：${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`远端命令失败（exit ${result.status}）：${(result.stderr ?? "").trim()}`);
  }
  return `${result.stdout ?? ""}`.trim();
}

async function devLogin(tenantName) {
  const response = await fetch(`${base}/api/auth/dev-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productCode: "lanqi", tenantRole: "local_business", tenantName })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.token || !data.tenantId) {
    throw new Error(
      `dev-login 不可用（${response.status}）：${data.message ?? data.error ?? "无 token"}。` +
        "本脚本只支持 DIRECT_TEST_LOGIN=true 的内测实例；生产请另走登录后的人工验收。"
    );
  }
  return { token: data.token, tenantId: data.tenantId, userId: data.userId };
}

async function probe(path, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const response = await fetch(`${base}${path}`, { headers });
  const contentType = response.headers.get("content-type") ?? "";
  let bytes = Buffer.alloc(0);
  if (response.ok) bytes = Buffer.from(await response.arrayBuffer());
  return { status: response.status, contentType, bytes };
}

/** 只接受安全字符集，避免路径 / SQL 注入（id 与租户 id 都是这种形态）。 */
function assertSafe(value) {
  if (!/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new Error(`非法参数（只允许 [A-Za-z0-9._:-]）：${value}`);
  }
  return value;
}

/**
 * 远端 SQL 一律走 heredoc，不写 `psql -c "...$VAR..."`：
 * 后者要同时处理「bash 展开」和「SQL 引号」两层转义，极易把 `'$AID'`
 * 写成裸标识符（本轮就踩过：`values (lq18-scope-...)` → `column "lq18" does not exist`）。
 * heredoc 里变量展开由 shell 负责，SQL 字面量照常写单引号即可。
 */
function sqlScript(tenantId, statements) {
  assertSafe(assetId);
  assertSafe(tenantId);
  return [
    `AID=${assetId}`,
    `TID=${tenantId}`,
    `sudo -u postgres psql -d ${dbName} -q -t -A -v ON_ERROR_STOP=1 <<SQL`,
    `set search_path to ${schema};`,
    ...statements,
    `SQL`,
    `echo sql-ok`
  ].join("\n");
}

function seed(tenantId) {
  const dir = `${uploadsRoot}/moments/${tenantId}`;
  const columns = '"id","tenantId","storeId","requestKey","kind","name","url","status"';
  const script = [
    `set -e`,
    sqlScript(tenantId, [
      `delete from "LanqiMomentAsset" where id='$AID';`,
      `insert into "LanqiMomentAsset" (${columns}) values ('$AID','$TID','lq18-verify-store','moments-image:$TID:lq18-scope-verify','image','LQ18 asset scope verify','/lanqi/moments/assets/$AID','succeeded');`
    ]),
    `D=${JSON.stringify(dir)}`,
    `mkdir -p "$D"`,
    `printf '%s' ${JSON.stringify(PNG_1X1_B64)} | base64 -d > "$D/$AID.png"`,
    `chmod 644 "$D/$AID.png"`,
    `chown admin:admin "$D/$AID.png" 2>/dev/null || true`,
    `echo "seeded $D/$AID.png"`
  ].join("\n");
  return ssh(script);
}

function cleanup(tenantId) {
  const dir = `${uploadsRoot}/moments/${tenantId}`;
  const script = [
    `AID=${assetId}`,
    `D=${JSON.stringify(dir)}`,
    sqlScript(tenantId, [`delete from "LanqiMomentAsset" where id='$AID';`]),
    `rm -f "$D/$AID.png"`,
    `rmdir "$D" 2>/dev/null || true`,
    `echo cleaned`
  ].join("\n");
  return ssh(script);
}

/**
 * `dev-login` 每调一次就**新建一个租户**，跑一遍会在实例上留两个一次性租户。
 * 为了让本脚本可重复执行、不给实例留垃圾，收尾时按本轮拿到的两个 tenantId 精确回收：
 * 反复扫描本 schema 里所有租户维度列（`tenantId` / `*TenantId`），把指向这两个
 * 一次性租户的行删掉，最后删租户本身。删除范围永远限定在「本轮刚创建的两个 id」。
 */
function dropTenants(tenantIds) {
  const idList = tenantIds.map((id) => `'${assertSafe(id)}'`).join(",");
  const idArray = `array[${idList}]::text[]`;
  const script = [
    // 引号版 heredoc：未加引号的 heredoc 里 `$$` 会被远端 shell 换成本身 PID，
    // plpgsql 的 `do $$` 会当场变成 `do 947518`。这里的 id 已内联成 SQL 字面量，
    // 不需要 shell 展开，整段原样交给 psql。
    `sudo -u postgres psql -d ${dbName} -q -t -A -v ON_ERROR_STOP=1 <<'SQL'`,
    `set search_path to ${schema};`,
    `do $$`,
    `declare t record; pass int;`,
    `begin`,
    `  for pass in 1..12 loop`,
    `    for t in`,
    `      select c.table_name, c.column_name`,
    `      from information_schema.columns c`,
    `      join information_schema.tables tb`,
    `        on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'`,
    `      where c.table_schema = '${schema}'`,
    `        and lower(c.column_name) like '%tenantid'`,
    `    loop`,
    `      begin`,
    `        execute format('delete from %I.%I where %I::text = any($1)', '${schema}', t.table_name, t.column_name) using ${idArray};`,
    `      exception when others then null;`,
    `      end;`,
    `    end loop;`,
    `  end loop;`,
    `  delete from "Tenant" where id = any(${idArray});`,
    `end $$;`,
    `select count(*) as remaining from "Tenant" where id = any(${idArray});`,
    `SQL`
  ].join("\n");
  return ssh(script);
}

async function main() {
  console.log(`base=${base}  schema=${schema}  asset=${assetId}`);
  const tenantA = await devLogin("Lanqi Asset Scope Verify A");
  const tenantB = await devLogin("Lanqi Asset Scope Verify B");
  console.log(`租户A=${tenantA.tenantId}  租户B=${tenantB.tenantId}`);

  seed(tenantA.tenantId);
  try {
    const fixed = await probe(`/api/lanqi/moments/assets/${assetId}`, tenantA.token);
    const magic = fixed.bytes.subarray(0, 8).toString("hex");
    assert(
      "兰琪作用域取图 200 + image/png + 真 PNG 字节",
      fixed.status === 200 &&
        fixed.contentType.startsWith("image/png") &&
        magic === "89504e470d0a1a0a" &&
        fixed.bytes.length >= 60,
      `status=${fixed.status} content-type=${fixed.contentType} bytes=${fixed.bytes.length} magic=${magic || "n/a"}`
    );

    const oldScope = await probe(`/api/beauty-industry/moments/assets/${assetId}`, tenantA.token);
    assert(
      "美业单品作用域取图仍 403（用户报障的破图成因）",
      oldScope.status === 403,
      `status=${oldScope.status}`
    );

    const crossTenant = await probe(`/api/lanqi/moments/assets/${assetId}`, tenantB.token);
    assert("租户 B 取租户 A 的配图 404（租户隔离）", crossTenant.status === 404, `status=${crossTenant.status}`);

    const anon = await probe(`/api/lanqi/moments/assets/${assetId}`, null);
    assert("匿名取图 401（鉴权门禁仍在）", anon.status === 401, `status=${anon.status}`);

    const stores = await probe("/api/lanqi/stores", tenantA.token);
    assert("兰琪租户自身作用域可用（/lanqi/stores 200）", stores.status === 200, `status=${stores.status}`);
  } finally {
    if (keepAsset) {
      console.log(`--keep-asset 已指定，保留合成资产 ${assetId}（租户 ${tenantA.tenantId}），请自行清理`);
    } else {
      cleanup(tenantA.tenantId);
    }
    if (keepTenants) {
      console.log(
        `--keep-tenants 已指定，保留本轮一次性租户 ${tenantA.tenantId} / ${tenantB.tenantId}，请自行清理`
      );
    } else {
      const remaining = dropTenants([tenantA.tenantId, tenantB.tenantId]);
      console.log(`一次性租户回收完成（残留 Tenant 行数=${remaining || "0"}）`);
    }
  }

  console.log(`\n合计 ${pass + fail} 项，失败 ${fail} 项`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`部署实例配图作用域复验中止：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
