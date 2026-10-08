// 抖音分享链接 → 无水印视频入库（2026-10-08，移植自 qa-ip-pos/douyin-resolve.mjs 2026-10-06 实测版）
//
// 链路：短链 302 拿 item_id → 带 ttwid 请求分享页（SSR HTML 含 video_id/desc）
//       → aweme/v1/play 拿无水印直链 → 下载 → storeBuffer 入租户目录 + UploadedFile 落库。
// 纯 HTTP 无浏览器依赖；失败码统一走 safeError 的 friendly 文案（douyin_*）。

import { prisma } from "@baolu/db";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";
import { ReplicationError } from "./viral-video-replication-runtime.js";

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const MAX_BYTES = 200 * 1024 * 1024;

async function getTtwid(): Promise<string> {
  const res = await fetch("https://ttwid.bytedance.com/ttwid/union/register/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ region: "cn", aid: 1768, needFid: false, service: "www.ixigua.com", migrate_info: { ticket: "", source: "node" }, cbUrlProtocol: "https", union: true })
  });
  const sc = res.headers.getSetCookie().find((c) => c.startsWith("ttwid="));
  if (!sc) throw new ReplicationError("douyin_fetch_failed", 502);
  return sc.split(";")[0].split("=")[1];
}

async function resolveShare(shareText: string): Promise<{ itemId: string; videoId: string; desc: string }> {
  const short = shareText.match(/https?:\/\/v\.douyin\.com\/[A-Za-z0-9_-]+\/?/)?.[0];
  if (!short) throw new ReplicationError("douyin_link_invalid", 400);
  const res = await fetch(short, { headers: { "User-Agent": UA }, redirect: "manual" });
  const target = res.headers.get("location") ?? "";
  const itemId = target.match(/\/share\/video\/(\d+)/)?.[1] ?? target.match(/\/video\/(\d+)/)?.[1];
  if (!itemId) throw new ReplicationError("douyin_link_invalid", 400);
  const ttwid = await getTtwid();
  const page = await fetch(`https://www.iesdouyin.com/share/video/${itemId}/`, {
    headers: { "User-Agent": UA, Cookie: `ttwid=${ttwid}` }
  }).then((r) => r.text());
  const videoId = page.match(/video_id=([a-z0-9]+)/)?.[1];
  const desc = page.match(/"desc":"([^"]{1,200})/)?.[1]?.replace(/\\u002F/g, "/") ?? "";
  if (!videoId) throw new ReplicationError("douyin_fetch_failed", 502);
  return { itemId, videoId, desc };
}

export interface DouyinImportResult {
  file: { id: string; filename: string; mimeType: string; byteSize: number };
  desc: string;
}

export async function importDouyinVideo(actor: { tenantId: string; userId: string }, shareText: string): Promise<DouyinImportResult> {
  const { itemId, videoId, desc } = await resolveShare(shareText.slice(0, 2000));
  const noWm = `https://www.iesdouyin.com/aweme/v1/play/?video_id=${videoId}&ratio=720p&line=0`;
  const bin = await fetch(noWm, { headers: { "User-Agent": UA, Referer: "https://www.douyin.com/" } });
  const buffer = Buffer.from(await bin.arrayBuffer());
  // 太小多半是风控页 / 跳转页，不是 mp4；超过 200MB 超出产品上限
  if (buffer.length < 100_000 || buffer.toString("ascii", 4, 8) !== "ftyp") throw new ReplicationError("douyin_fetch_failed", 502);
  if (buffer.length > MAX_BYTES) throw new ReplicationError("douyin_too_large", 400);

  const id = randomUUID();
  const safeTitle = (desc || itemId).replace(/[\\/:*?"<>|\s]+/g, "").slice(0, 24) || itemId;
  const filename = `抖音-${safeTitle}.mp4`;
  const tenantDir = path.resolve(env.UPLOAD_DIR, actor.tenantId);
  await mkdir(tenantDir, { recursive: true });
  const storagePath = path.join(tenantDir, `${id}-${filename}`);
  await writeFile(storagePath, buffer);

  const record = await prisma.uploadedFile.create({
    data: {
      id,
      tenantId: actor.tenantId,
      userId: actor.userId,
      filename,
      mimeType: "video/mp4",
      byteSize: buffer.byteLength,
      storagePath,
      sha256: createHash("sha256").update(buffer).digest("hex")
    }
  });
  return { file: { id: record.id, filename: record.filename, mimeType: record.mimeType, byteSize: record.byteSize }, desc };
}
