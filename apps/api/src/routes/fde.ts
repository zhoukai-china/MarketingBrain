// FDE 生态登记接口（2026-10-08 保禄交接单 → 周凯实现）
//
// 页面：delivery-20261008-zhoukai/fde/FDE工程师合作登记页.html（静态页，地址全读 config.js）
//   POST /fde/register   登记提交：中文字段原样存 payload(JSONB)，手机号唯一键 upsert
//   POST /fde/save       分步草稿保存（jsonb 浅合并，status=进行中·第X步）
//   POST /fde/login      管理后台登录：手机号白名单 + TOTP 双因子（都过才发会话 token）
//   GET  /fde/2fa/setup  绑定二维码：otpauth URI，enroll token + 24h 窗口双重限制
//   GET  /fde/list       管理后台拉取：分页 + 搜索 + 创建时间倒序，需会话 token 或运维密钥
//
// 鉴权（2026-10-08 用户口径：静态密钥只是换皮密码 → 升级双因子）：
//   - 登录仅限白名单手机号（15794099431 / 13322285527）+ Authenticator 动态码（TOTP，30s 步长，±1 步容差），
//     校验全部在服务端；成功签发当日有效的会话 token（HMAC，无需存库，重启不失效）。
//   - list 接受 x-fde-token: <会话token>（推荐）或 FDE_ADMIN_KEY（运维后门，query pwd / x-fde-admin-key / Bearer）。
//   - FDE_TOTP_SECRET / FDE_ENROLL_TOKEN / FDE_ENROLL_UNTIL 配在生产 env，缺 secret 时登录禁用。
// nginx：ai.lcppch.top/api/* → 3002（剥 /api 前缀），页面 config.js 填 /api/fde/*。
// 注意：SQL 用 $queryRawUnsafe/$executeRawUnsafe 拼接，所有字符串值必须经 esc() 转义。

import type { FastifyInstance } from "fastify";
import { randomUUID, createHmac } from "node:crypto";
import { prisma } from "@baolu/db";

const MAX_PAYLOAD_BYTES = 64 * 1024;
const ALLOWED_PHONES = ["15794099431", "13322285527"];

function adminKey(): string {
  return process.env.FDE_ADMIN_KEY || "fde-admin-2026";
}

function esc(v: string): string {
  // standard_conforming_strings=on：单引号翻倍即可
  return "'" + v.replace(/'/g, "''") + "'";
}

/* ---------------- TOTP（RFC 6238，SHA-1 / 6 位 / 30s，兼容 Google Authenticator） ---------------- */

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(s: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of s.replace(/=+$/, "").toUpperCase().replace(/\s+/g, "")) {
    const idx = B32.indexOf(c);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totpCode(secretB32: string, atMs: number): string {
  const counter = Math.floor(atMs / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const h = createHmac("sha1", base32Decode(secretB32)).update(buf).digest();
  const off = h[h.length - 1] & 0xf;
  const code = (((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3]) % 10 ** 6;
  return String(code).padStart(6, "0");
}

/** 校验动态码：当前 ±1 步（30s）容差，防手输时跨步。 */
function totpVerify(secretB32: string, code: string): boolean {
  const c = String(code ?? "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(c)) return false;
  const now = Date.now();
  return [-1, 0, 1].some((d) => totpCode(secretB32, now + d * 30_000) === c);
}

/** 当日会话 token（无状态：服务端按 手机号+日期 重算比对，跨日自动失效）。 */
function sessionToken(phone: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return createHmac("sha256", process.env.FDE_TOTP_SECRET || "").update("fde-session|" + phone + "|" + day).digest("hex");
}

function checkAdmin(request: { query: unknown; headers: unknown }): boolean {
  const headers = (request.headers ?? {}) as Record<string, unknown>;
  // ① 双因子会话 token（推荐路径）
  const tok = String(headers["x-fde-token"] ?? "");
  if (tok && process.env.FDE_TOTP_SECRET && ALLOWED_PHONES.some((p) => tok === sessionToken(p))) return true;
  // ② 运维后门（静态 key，curl/冒烟用）
  const key = adminKey();
  const q = (request.query ?? {}) as { pwd?: string };
  const bearer = String(headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  return q.pwd === key || headers["x-fde-admin-key"] === key || bearer === key;
}

interface FdeRow {
  id: string;
  phone: string;
  name: string | null;
  city: string | null;
  status: string;
  payload: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export async function registerFdeRoutes(app: FastifyInstance): Promise<void> {
  // 登记提交（公开）：中文键原样接收，手机号 upsert，重复提交=更新不新增
  app.post("/fde/register", async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const raw = JSON.stringify(body);
    if (raw.length > MAX_PAYLOAD_BYTES) {
      return reply.code(400).send({ ok: false, error: "payload_too_large", message: "登记内容过大，请精简后重试。" });
    }
    const phone = String(body["手机号"] ?? "").replace(/\s+/g, "");
    if (!/^1\d{10}$/.test(phone)) {
      return reply.code(400).send({ ok: false, error: "phone_invalid", message: "手机号格式不正确，请填写 11 位大陆手机号。" });
    }
    const name = String(body["姓名"] ?? "").trim().slice(0, 60);
    const city = String(body["城市"] ?? "").trim().slice(0, 60);
    const now = new Date().toISOString();
    const payload = esc(JSON.stringify(body));
    const sql =
      'INSERT INTO "FdeRegistration" (id, phone, name, city, status, payload, "createdAt", "updatedAt")' +
      " VALUES (" + esc(randomUUID()) + ", " + esc(phone) + ", " + esc(name) + ", " + esc(city) + ", '已建档', " + payload + "::jsonb, " + esc(now) + ", " + esc(now) + ")" +
      " ON CONFLICT (phone) DO UPDATE SET payload = " + payload + "::jsonb, name = " + esc(name) + ", city = " + esc(city) + ", status = '已建档', \"updatedAt\" = " + esc(now);
    await prisma.$executeRawUnsafe(sql);
    return { ok: true };
  });

  // 分步草稿保存（2026-10-08 用户口径）：每点一次「下一步」存一次当前已填内容，
  // 管理后台 status 能看到进行到第几步；payload 用 jsonb 浅合并（保留之前步骤的键）。
  // 最终提交仍走 /fde/register（全量覆盖，status=已建档）。
  app.post("/fde/save", async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const raw = JSON.stringify(body);
    if (raw.length > MAX_PAYLOAD_BYTES) {
      return reply.code(400).send({ ok: false, error: "payload_too_large", message: "内容过大，请精简后重试。" });
    }
    const phone = String(body["手机号"] ?? "").replace(/\s+/g, "");
    if (!/^1\d{10}$/.test(phone)) return reply.code(400).send({ ok: false, error: "phone_invalid" });
    const stepRaw = parseInt(String(body.__step ?? "1"), 10);
    const step = Math.min(9, Math.max(1, Number.isFinite(stepRaw) ? stepRaw : 1));
    const now = new Date().toISOString();
    const status = "进行中 · 第 " + step + " 步";
    const payload = esc(JSON.stringify(body));
    const mergeSql =
      'INSERT INTO "FdeRegistration" (id, phone, name, city, status, payload, "createdAt", "updatedAt")' +
      " VALUES (" + esc(randomUUID()) + ", " + esc(phone) +
      ", " + esc(String(body["姓名"] ?? "").trim().slice(0, 60)) +
      ", " + esc(String(body["城市"] ?? "").trim().slice(0, 60)) +
      ", " + esc(status) + ", " + payload + "::jsonb, " + esc(now) + ", " + esc(now) + ")" +
      ' ON CONFLICT (phone) DO UPDATE SET payload = "FdeRegistration".payload || ' + payload + "::jsonb" +
      ", status = " + esc(status) + ', "updatedAt" = ' + esc(now);
    await prisma.$executeRawUnsafe(mergeSql);
    return { ok: true };
  });

  // 双因子登录：手机号白名单 + TOTP 动态码，全部服务端校验，都过才发当日会话 token
  app.post("/fde/login", async (request, reply) => {
    const secret = process.env.FDE_TOTP_SECRET;
    if (!secret) return reply.code(503).send({ ok: false, error: "totp_not_configured", message: "双因子未配置，请联系管理员。" });
    const body = (request.body ?? {}) as { phone?: string; code?: string };
    const phone = String(body.phone ?? "").replace(/\s+/g, "");
    if (!ALLOWED_PHONES.includes(phone)) {
      return reply.code(401).send({ ok: false, error: "phone_not_allowed", message: "该手机号不在授权名单内。" });
    }
    if (!totpVerify(secret, String(body.code ?? ""))) {
      return reply.code(401).send({ ok: false, error: "code_invalid", message: "动态码不正确或已过期，请输入 Authenticator 当前 6 位数字。" });
    }
    return { ok: true, token: sessionToken(phone), phone, expiresAt: new Date().toISOString().slice(0, 10) + "T24:00 (当日有效)" };
  });

  // 绑定二维码：enroll token + 24h 窗口双重限制（过期后不再出码，防密钥被长期拖走）
  app.get("/fde/2fa/setup", async (request, reply) => {
    const enroll = (request.query ?? {}) as { enroll?: string };
    const until = Date.parse(process.env.FDE_ENROLL_UNTIL || "");
    if (!process.env.FDE_ENROLL_TOKEN || !Number.isFinite(until) || Date.now() > until) {
      return reply.code(410).send({ ok: false, error: "enroll_expired", message: "绑定窗口已关闭（24 小时）。需要重绑请由管理员更新 FDE_ENROLL_TOKEN / FDE_ENROLL_UNTIL。" });
    }
    if (String(enroll.enroll ?? "") !== process.env.FDE_ENROLL_TOKEN) {
      return reply.code(401).send({ ok: false, error: "enroll_invalid" });
    }
    const secret = process.env.FDE_TOTP_SECRET || "";
    const label = encodeURIComponent("FDE资源池管理后台");
    const otpauth = "otpauth://totp/" + label + "?secret=" + secret + "&issuer=FDE&algorithm=SHA1&digits=6&period=30";
    return { ok: true, otpauth, until: process.env.FDE_ENROLL_UNTIL };
  });


  // 管理后台拉取：分页 + 搜索（姓名/手机号/城市/payload 全文）+ 按创建时间倒序
  app.get("/fde/list", async (request, reply) => {
    if (!checkAdmin(request)) {
      return reply.code(401).send({ ok: false, error: "unauthorized", message: "请先登录（手机号 + 双因子动态码）。" });
    }
    const q = (request.query ?? {}) as { page?: string; pageSize?: string; q?: string };
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize) || 20));
    const search = (q.q ?? "").trim().slice(0, 60);
    const offset = (page - 1) * pageSize;

    const whereSql = search
      ? "WHERE name ILIKE " + esc("%" + search + "%") +
        " OR city ILIKE " + esc("%" + search + "%") +
        " OR phone ILIKE " + esc("%" + search + "%") +
        " OR payload::text ILIKE " + esc("%" + search + "%")
      : "";
    const rows = await prisma.$queryRawUnsafe<FdeRow[]>(
      'SELECT id, phone, name, city, status, payload, "createdAt", "updatedAt" FROM "FdeRegistration" ' +
      whereSql + ' ORDER BY "createdAt" DESC LIMIT ' + pageSize + " OFFSET " + offset
    );
    const countRows = await prisma.$queryRawUnsafe<{ count: number }[]>(
      'SELECT count(*)::int AS count FROM "FdeRegistration" ' + whereSql
    );
    const total = Number(countRows[0]?.count ?? 0);

    return {
      items: rows.map((r) => ({
        id: r.id,
        phone: r.phone,
        name: r.name,
        city: r.city,
        status: r.status,
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
        updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
        payload: r.payload
      })),
      total,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(total / pageSize))
    };
  });
}
