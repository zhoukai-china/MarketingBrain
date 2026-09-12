import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * 兰琪视频「首帧图暂存」回归。
 *
 * 锁的是一条对外可见的安全契约：门店上传的首帧图只落本平台自己的存储，
 * 交给阿里云百炼的是一条「限时 + 租户指纹签名」的 HTTPS 外链，且
 *   · 缺公网基址或缺签名密钥时必须 fail closed（不静默降级成公网裸链）；
 *   · 只认 JPEG / PNG / WebP 的真实容器，改了扩展名的文件不得进模型；
 *   · 外链改过期时间、已过期、换租户指纹一律读不到；
 *   · 跨门店（租户）互相读不到对方的首帧图。
 *
 * 全部用文件系统与内存完成，不需要数据库、不需要任何模型调用。
 */

const uploadDir = mkdtempSync(path.join(tmpdir(), "lanqi-media-staging-"));
process.env.UPLOAD_DIR = uploadDir;
process.env.NODE_ENV = "test";

type Config = typeof import("../apps/api/src/config/env.ts");
type Staging = typeof import("../apps/api/src/services/lanqi-media-staging.ts");
type StageError = { statusCode?: number; publicMessage?: string };

let passed = 0;

async function main(): Promise<void> {
  const { env }: Config = await import("../apps/api/src/config/env.ts");
  const staging: Staging = await import("../apps/api/src/services/lanqi-media-staging.ts");
  const results: string[] = [];
  const group = (label: string) => {
    passed += 1;
    results.push(`PASS ${label}`);
  };

  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(64, 9)]);
  const pngBase64 = png.toString("base64");

  // ── 1. fail closed：没有公网基址 / 签名密钥时不得暂存，也不得签发外链 ──
  env.LANQI_MEDIA_PUBLIC_BASE_URL = undefined;
  env.LANQI_MEDIA_STAGING_SECRET = undefined;
  env.JWT_SECRET = undefined;
  assert.match(staging.lanqiFirstFrameStagingIssue() ?? "", /密钥/);
  await assert.rejects(
    () => staging.stageLanqiFirstFrame({ tenantId: "tenant-a", contentType: "image/png", dataBase64: pngBase64 }),
    (error: StageError) => error.statusCode === 503 && typeof error.publicMessage === "string",
  );
  assert.throws(() => staging.lanqiFirstFramePublicUrl({ tenantId: "tenant-a", firstFrameId: "lanqi-ff-0123456789abcdef" }));
  group("未配置公网基址 / 签名密钥时 fail closed");

  // ── 2. 非 HTTPS 公网基址被拒绝；补齐后才就绪 ──
  env.LANQI_MEDIA_STAGING_SECRET = "staging-secret-for-smoke-test";
  env.LANQI_MEDIA_PUBLIC_BASE_URL = "http://example.com/os-v2/api";
  assert.match(staging.lanqiFirstFrameStagingIssue() ?? "", /HTTPS/);
  env.LANQI_MEDIA_PUBLIC_BASE_URL = "https://example.com/os-v2/api";
  assert.equal(staging.lanqiFirstFrameStagingIssue(), undefined);
  group("非 HTTPS 公网基址被拒绝");

  // ── 3. 只收真实容器；改了扩展名的文件不得进模型 ──
  await assert.rejects(
    () => staging.stageLanqiFirstFrame({ tenantId: "tenant-a", contentType: "image/png", dataBase64: jpeg.toString("base64") }),
    (error: StageError) => error.statusCode === 400 && /不一致/.test(error.publicMessage ?? ""),
  );
  await assert.rejects(
    () => staging.stageLanqiFirstFrame({ tenantId: "tenant-a", contentType: "image/gif", dataBase64: pngBase64 }),
    (error: StageError) => error.statusCode === 400,
  );
  group("容器魔数不符 / 不支持的图片类型被拒绝");

  // ── 4. 超过体积上限的首帧图被拒绝（默认 6MB）──
  const huge = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(7 * 1024 * 1024, 3)]);
  await assert.rejects(
    () => staging.stageLanqiFirstFrame({ tenantId: "tenant-a", contentType: "image/jpeg", dataBase64: huge.toString("base64") }),
    (error: StageError) => error.statusCode === 413,
  );
  group("超过体积上限的首帧图被拒绝");

  // ── 5. 正常暂存 + 同一张图复用同一 ID（不堆副本）──
  const first = await staging.stageLanqiFirstFrame({ tenantId: "tenant-a", contentType: "image/png", dataBase64: pngBase64 });
  assert.match(first.firstFrameId, /^lanqi-ff-[a-f0-9]{32}$/);
  assert.equal(first.retention, "tenant_owned");
  assert.equal(first.source, "store_upload");
  const again = await staging.stageLanqiFirstFrame({ tenantId: "tenant-a", contentType: "image/png", dataBase64: pngBase64 });
  assert.equal(again.firstFrameId, first.firstFrameId);
  group("同一张图重复上传复用同一个暂存 ID");

  // ── 6. 签名外链：可用、改过期时间即失效、已过期即失效 ──
  const url = staging.lanqiFirstFramePublicUrl({ tenantId: "tenant-a", firstFrameId: first.firstFrameId });
  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, `https://example.com/os-v2/api/lanqi/media/first-frame/${first.firstFrameId}`);
  const tenantKeyA = parsed.searchParams.get("k")!;
  const expiresA = parsed.searchParams.get("e")!;
  const tokenA = parsed.searchParams.get("t")!;
  assert.equal(
    (await staging.readLanqiFirstFrameBySignature({ firstFrameId: first.firstFrameId, tenantKey: tenantKeyA, expiresAt: expiresA, token: tokenA }))?.bytes.length,
    png.length,
  );
  assert.equal(
    await staging.readLanqiFirstFrameBySignature({ firstFrameId: first.firstFrameId, tenantKey: tenantKeyA, expiresAt: String(Number(expiresA) + 3600), token: tokenA }),
    undefined,
  );
  assert.equal(
    await staging.readLanqiFirstFrameBySignature({ firstFrameId: first.firstFrameId, tenantKey: tenantKeyA, expiresAt: "1", token: tokenA }),
    undefined,
  );
  group("签名外链可用；改过期时间 / 已过期一律读不到");

  // ── 7. 跨门店（租户）互相读不到对方的首帧图 ──
  // 7a. 同内容图：两个门店各自暂存，ID 相同（按内容寻址），但只能读到自己那一份。
  assert.equal(await staging.readLanqiFirstFrame({ tenantId: "tenant-b", firstFrameId: first.firstFrameId }), undefined);
  const tenantBCopy = await staging.stageLanqiFirstFrame({ tenantId: "tenant-b", contentType: "image/png", dataBase64: pngBase64 });
  assert.notEqual(tenantBCopy.tenantKey, first.tenantKey);
  assert.equal(tenantBCopy.firstFrameId, first.firstFrameId);
  const urlBCopy = new URL(staging.lanqiFirstFramePublicUrl({ tenantId: "tenant-b", firstFrameId: tenantBCopy.firstFrameId }));
  assert.equal(
    (await staging.readLanqiFirstFrameBySignature({
      firstFrameId: tenantBCopy.firstFrameId,
      tenantKey: urlBCopy.searchParams.get("k")!,
      expiresAt: urlBCopy.searchParams.get("e")!,
      token: urlBCopy.searchParams.get("t")!,
    }))?.metadata.tenantKey,
    tenantBCopy.tenantKey,
  );
  // 7b. 不同内容的图：A 门店的签名对外门店的图一律无效。
  const tenantBCard = await staging.stageLanqiFirstFrame({ tenantId: "tenant-b", contentType: "image/jpeg", dataBase64: jpeg.toString("base64") });
  assert.notEqual(tenantBCard.firstFrameId, first.firstFrameId);
  assert.equal(
    await staging.readLanqiFirstFrameBySignature({ firstFrameId: tenantBCard.firstFrameId, tenantKey: tenantKeyA, expiresAt: expiresA, token: tokenA }),
    undefined,
  );
  assert.equal(await staging.readLanqiFirstFrame({ tenantId: "tenant-a", firstFrameId: tenantBCard.firstFrameId }), undefined);
  const urlBCard = new URL(staging.lanqiFirstFramePublicUrl({ tenantId: "tenant-b", firstFrameId: tenantBCard.firstFrameId }));
  assert.equal(
    (await staging.readLanqiFirstFrameBySignature({
      firstFrameId: tenantBCard.firstFrameId,
      tenantKey: urlBCard.searchParams.get("k")!,
      expiresAt: urlBCard.searchParams.get("e")!,
      token: urlBCard.searchParams.get("t")!,
    }))?.bytes.length,
    jpeg.length,
  );
  // 两个门店的暂存目录在磁盘上必须分开，互不覆盖。
  const tenantDirs = readdirSync(path.join(uploadDir, "lanqi-media", "staging"));
  assert.equal(tenantDirs.length, 2);
  assert.ok(tenantDirs.includes(first.tenantKey) && tenantDirs.includes(tenantBCopy.tenantKey));
  group("跨租户首帧图不可读（租户指纹 + 租户目录双重隔离）");

  // ── 8. 传给媒体路由的解析：图生视频落到签名外链，其它类型不受影响 ──
  const resolved = await staging.resolveLanqiFirstFrameInput({ tenantId: "tenant-a", kind: "image_to_video", firstFrameId: first.firstFrameId });
  assert.equal(resolved.ok, true);
  if (resolved.ok) {
    assert.equal(resolved.firstFrameId, first.firstFrameId);
    assert.match(resolved.imageUrl ?? "", /^https:\/\/example\.com\/os-v2\/api\/lanqi\/media\/first-frame\/lanqi-ff-/);
  }
  const unknown = await staging.resolveLanqiFirstFrameInput({ tenantId: "tenant-a", kind: "image_to_video", firstFrameId: "lanqi-ff-ffffffffffffffffffffffffffffffff" });
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.statusCode, 422);
  // tenant-c 从未暂存过这张图：即便拿到了 ID，也不能拿别的门店的素材去生成。
  assert.equal((await staging.resolveLanqiFirstFrameInput({ tenantId: "tenant-c", kind: "image_to_video", firstFrameId: first.firstFrameId })).ok, false);
  assert.deepEqual(await staging.resolveLanqiFirstFrameInput({ tenantId: "tenant-a", kind: "image" }), { ok: true, imageUrl: undefined });
  group("首帧图解析只作用于图生视频，且拒绝不存在的 / 别的门店的图");

  // ── 9. 幂等口径：用「稳定的暂存 ID」当指纹，不随签名里的过期时间漂移 ──
  assert.equal(staging.lanqiFirstFrameRequestFingerprint({ kind: "image_to_video", firstFrameId: first.firstFrameId }), first.firstFrameId);
  assert.equal(staging.lanqiFirstFrameRequestFingerprint({ kind: "image_to_video", firstFrameId: first.firstFrameId, imageUrl: url }), first.firstFrameId);
  assert.equal(staging.lanqiFirstFrameRequestFingerprint({ kind: "image", previewId: "lanqi-image-abcdefghijklmnop" }), undefined);
  assert.equal(staging.lanqiFirstFrameRequestFingerprint({ kind: "image_to_video", imageUrl: "https://example.com/raw.jpg" }), "https://example.com/raw.jpg");
  group("幂等指纹用稳定 ID，不随签名过期时间漂移");

  for (const line of results) console.log(line);
  console.log(`Lanqi media first-frame staging smoke passed (${passed} groups).`);
}

void main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    rmSync(uploadDir, { recursive: true, force: true });
  });
