// FDE 生态登记接口（2026-10-08 保禄交接单 → 周凯实现）
//
// 页面：delivery-20261008-zhoukai/fde/FDE工程师合作登记页.html（静态页，地址全读 config.js）
//   POST /fde/register  登记提交：中文字段原样存 payload(JSONB)，手机号唯一键 upsert
//   GET  /fde/list      管理后台拉取：分页 + 搜索 + 按创建时间倒序，需管理密钥
// 鉴权：list 走 FDE_ADMIN_KEY（query pwd / x-fde-admin-key / Bearer 三选一匹配）；
//       register 公开（面向 FDE 填写），限 payload 64KB + 手机号格式。
// nginx：ai.lcppch.top/api/* → 3002（剥 /api 前缀），页面 config.js 填 /api/fde/*。
// 注意：SQL 用 $queryRawUnsafe/$executeRawUnsafe 拼接，所有字符串值必须经 esc() 转义。

import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { prisma } from "@baolu/db";

const MAX_PAYLOAD_BYTES = 64 * 1024;

function adminKey(): string {
  return process.env.FDE_ADMIN_KEY || "fde-admin-2026";
}

function esc(v: string): string {
  // standard_conforming_strings=on：单引号翻倍即可
  return "'" + v.replace(/'/g, "''") + "'";
}

function checkAdmin(request: { query: unknown; headers: unknown }): boolean {
  const key = adminKey();
  const q = (request.query ?? {}) as { pwd?: string };
  const headers = (request.headers ?? {}) as Record<string, unknown>;
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

  // 管理后台拉取：分页 + 搜索（姓名/手机号/城市/payload 全文）+ 按创建时间倒序
  app.get("/fde/list", async (request, reply) => {
    if (!checkAdmin(request)) {
      return reply.code(401).send({ ok: false, error: "unauthorized", message: "口令或 token 不正确。" });
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
