#!/usr/bin/env node
/**
 * 生成平台管理后台的密码 hash（PLAT-39）。
 *
 * 用法：
 *   node scripts/hash-admin-password.mjs '你的密码'
 *
 * 输出形如 `scrypt$<salt>$<hash>`，把它写进服务器环境变量：
 *   ADMIN_LOGIN_USERNAME=admin
 *   ADMIN_LOGIN_PASSWORD_HASH=scrypt$....
 *   ADMIN_SESSION_SECRET=<32 字节以上随机串>   # 可选，不配则用 ADMIN_TOKEN 签名
 *
 * 说明：明文不要写进仓库、不要贴聊天；服务器 env 文件权限保持 root 600。
 */
import { randomBytes, scryptSync } from "node:crypto";

const password = process.argv[2];
if (!password || password.length < 8) {
  console.error("用法：node scripts/hash-admin-password.mjs '<至少 8 位的密码>'");
  process.exit(2);
}
const salt = randomBytes(16).toString("hex");
const derived = scryptSync(password, salt, 32).toString("hex");
console.log(`scrypt$${salt}$${derived}`);
console.log(`# 同时建议生成会话密钥：${randomBytes(32).toString("base64url")}`);
