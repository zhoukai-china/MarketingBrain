import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { composeBeautyCustomerImage, preflightBeautyImageOverlay, BEAUTY_IMAGE_COMPOSITION_VERSION } from "../apps/api/src/services/beauty-image-compositor.js";
import { buildBeautyImageOverlays } from "../apps/api/src/products/beauty-industry/media-contract.js";

const require = createRequire(import.meta.url);
const { PNG } = require("../apps/api/node_modules/pngjs") as { PNG: new (input: { width: number; height: number }) => { data: Buffer; width: number; height: number; }; sync: { write(value: unknown): Buffer; read(value: Buffer): { width: number; height: number; data: Buffer } } };
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main(): Promise<void> {
const assetRoot = await mkdtemp(path.join(tmpdir(), "beauty-image-composition-p1-"));
process.env.UPLOAD_DIR = assetRoot;
process.env.BEAUTY_MEDIA_ASSET_STORAGE = "local";
const formalOutput = `## 客户可复制成品
### 标题候选
1. 附近女性都在关注的皮肤管理小细节
2. 皮肤管理产品怎么选更稳妥
3. 日常皮肤管理先看这三点
### 正文
日常皮肤管理不必追求夸张承诺，先了解产品边界与自己的真实需求。\n\n从温和、清晰的信息开始，再决定是否进一步咨询。
### 话题标签
#皮肤管理 #附近生活 #女性日常 #护肤思路 #门店服务
### 互动与承接
你更关注使用感还是日常搭配？欢迎留言说说。
## 门店制作说明
### 配图方向一｜封面图
#### 正向视觉提示词
clean skincare still life photography
#### 负向提示词
text, logo
#### 后期叠字
标题后期叠加
#### 视觉参数
3:4
### 配图方向二｜内容图
#### 正向视觉提示词
neutral skincare objects
#### 负向提示词
text, logo
#### 后期叠字
短句后期叠加
#### 视觉参数
3:4
### 配图方向三｜互动承接图
#### 正向视觉提示词
calm botanical detail
#### 负向提示词
text, logo
#### 后期叠字
互动短句后期叠加
#### 视觉参数
3:4
## 质量与合规检查
仅使用已确认事实；不含价格、疗效、案例或联系方式。`;

const selectedTitle = "皮肤管理产品怎么选更稳妥";
const overlays = buildBeautyImageOverlays({ output: formalOutput, selectedTitle });
assert.deepEqual(overlays.map((item) => item.role), ["cover", "content", "engagement"]);
assert.equal(overlays[0]?.text, selectedTitle);
assert.ok(overlays.every((item) => item.text.length > 0));
assert.ok(overlays.every((item) => !/(提示词|Provider|Schema|Eval|待补|核验)/i.test(item.text)));

const champion = {
  assetSha256Short: "2e7b888d…cea52",
  selectedTitle: "附近女性顾客的皮肤管理产品了解面向附近女性顾客",
  observedFailure: "repeated_and_truncated"
} as const;
assert.throws(
  () => preflightBeautyImageOverlay({ role: "cover", overlayText: champion.selectedTitle, width: 768, height: 1024 }),
  /beauty_image_overlay_repeated_segment/,
  "the real failed title distribution must be rejected before credits or Provider work"
);

const layoutCases = [
  { role: "cover" as const, text: "皮肤管理产品怎么选更稳妥" },
  { role: "cover" as const, text: "日常护理：Skin Care 3步看懂" },
  { role: "content" as const, text: "先了解护理边界，再决定下一步" },
  { role: "engagement" as const, text: "你更关注哪一步？" }
];
for (const fixture of layoutCases) {
  for (const dimensions of [{ width: 768, height: 1024 }, { width: 390, height: 520 }]) {
    const layout = preflightBeautyImageOverlay({ role: fixture.role, overlayText: fixture.text, ...dimensions });
    assert.equal(layout.text, fixture.text);
    assert.ok(layout.lines.length >= 1);
    assert.equal(layout.lines.join("").replace(/\s+/g, ""), fixture.text.replace(/\s+/g, ""), "layout must preserve every visible non-space character");
    assert.ok(!layout.lines.some((line) => /…|\.\.\./u.test(line)), "layout must never truncate with an ellipsis");
  }
}

const cleanedPrefix = preflightBeautyImageOverlay({ role: "cover", overlayText: "标题1：皮肤管理产品怎么选更稳妥", width: 390, height: 520 });
assert.equal(cleanedPrefix.text, "皮肤管理产品怎么选更稳妥", "only non-semantic presentation prefixes may be removed");

for (const invalid of [
  "皮肤管理产品怎么选更稳妥皮肤管理产品怎么选更稳妥",
  "这是一个无法在三行安全区域内完整呈现且不允许自动改写的超长小红书封面标题用于验证调用前失败关闭边界",
  "皮肤管理✨从今天开始"
]) {
  assert.throws(
    () => preflightBeautyImageOverlay({ role: "cover", overlayText: invalid, width: 390, height: 520 }),
    /beauty_image_overlay_(?:repeated_segment|too_long|unsupported_symbol)/
  );
}

const source = new PNG({ width: 768, height: 1024 });
for (let y = 0; y < source.height; y += 1) {
  for (let x = 0; x < source.width; x += 1) {
    const offset = (y * source.width + x) * 4;
    source.data[offset] = 205 + Math.round((x / source.width) * 20);
    source.data[offset + 1] = 186 + Math.round((y / source.height) * 25);
    source.data[offset + 2] = 160;
    source.data[offset + 3] = 255;
  }
}
const sourceBytes = PNG.sync.write(source);
const sourceSha = createHash("sha256").update(sourceBytes).digest("hex");
const receipts = [];
try {
  const { persistBeautyCustomerComposite, persistBeautyProviderImage, readBeautyMediaAsset, readBeautyProviderMediaAsset } = await import("../apps/api/src/services/beauty-media-assets.js");
  for (const [index, overlay] of overlays.entries()) {
    const composed = await composeBeautyCustomerImage({ sourceBytes, role: overlay.role, overlayText: overlay.text });
    const decoded = PNG.sync.read(composed.bytes);
    assert.equal(decoded.width, 768);
    assert.equal(decoded.height, 1024);
    assert.equal(composed.receipt.version, BEAUTY_IMAGE_COMPOSITION_VERSION);
    assert.notEqual(composed.receipt.finalSha256, sourceSha);
    assert.equal(composed.receipt.overlayTextHash, createHash("sha256").update(overlay.text).digest("hex"));

    const jobId = `composition-job-${index + 1}`;
    await persistBeautyProviderImage({ tenantId: "tenant-composition-a", jobId, sourceUrl: "https://example.invalid/base.png" }, {
      validateSourceUrl: () => undefined,
      fetchImpl: async () => new Response(sourceBytes, { status: 200, headers: { "content-type": "image/png" } })
    });
    await persistBeautyCustomerComposite({ tenantId: "tenant-composition-a", jobId, bytes: composed.bytes, receipt: composed.receipt });
    const providerAsset = await readBeautyProviderMediaAsset({ tenantId: "tenant-composition-a", jobId });
    const customerAsset = await readBeautyMediaAsset({ tenantId: "tenant-composition-a", jobId });
    assert.equal(createHash("sha256").update(providerAsset.bytes).digest("hex"), sourceSha, "the original Provider asset must remain immutable for audit");
    assert.equal(createHash("sha256").update(customerAsset.bytes).digest("hex"), composed.receipt.finalSha256, "customer download must return the deterministic final composition");
    assert.equal(customerAsset.metadata.customerComposite?.compositionVersion, BEAUTY_IMAGE_COMPOSITION_VERSION);
    assert.equal(customerAsset.metadata.customerComposite?.lineCount, composed.receipt.lineCount);
    assert.equal(customerAsset.metadata.customerComposite?.fontSize, composed.receipt.fontSize);
    assert.ok((customerAsset.metadata.customerComposite?.lineCount ?? 0) <= composed.receipt.maxLines);
    await assert.rejects(() => readBeautyMediaAsset({ tenantId: "tenant-composition-b", jobId }), "another tenant must not read the final composition");
    receipts.push(composed.receipt);
  }
} finally {
  await rm(assetRoot, { recursive: true, force: true });
}
assert.equal(new Set(receipts.map((item) => item.finalSha256)).size, 3, "three roles must produce independently persisted final images");

const route = await readFile(path.join(repoRoot, "apps/api/src/routes/beauty-industry-media.ts"), "utf8");
const assets = await readFile(path.join(repoRoot, "apps/api/src/services/beauty-media-assets.ts"), "utf8");
const workbench = await readFile(path.join(repoRoot, "apps/web/src/components/acquisition/BeautyXhsWorkbench.tsx"), "utf8");
assert.match(route, /compositionRequired:\s*true/);
assert.match(route, /persistBeautyCustomerComposite/);
assert.match(route, /deliveryMode:\s*"real_provider_composed"/);
assert.match(route, /generateBeautyDeterministicVisual/);
assert.match(route, /provider:\s*"aliyun_bailian"/);
assert.match(route, /hasActiveBeautyProductEntitlement/);
assert.match(route, /beauty_image_overlay_repeated_segment/);
assert.match(route, /beauty_image_overlay_too_long/);
assert.ok(route.indexOf("preflightBeautyImageOverlays(overlays)") < route.indexOf("reservation = await reserveCreditsBeforeProvider"), "overlay readability must fail before credit reservation");
assert.ok(route.indexOf("preflightBeautyImageOverlays(overlays)") < route.indexOf("await submitLanqiMedia"), "overlay readability must fail before Provider submission");
assert.ok(route.indexOf("const estimatedProviderCostYuan = directions.length * BEAUTY_IMAGE_PROVIDER_COST_PER_IMAGE_YUAN") < route.indexOf("reservation = await reserveCreditsBeforeProvider"), "real delivery must calculate the bounded Provider cost before credit reservation");
assert.doesNotMatch(route, /BEAUTY_MEDIA_EXECUTION_MODE\s*!==\s*"real"\s*\|\|\s*env\.BEAUTY_MEDIA_REAL_EXECUTION_APPROVED/);
assert.match(assets, /customerComposite/);
assert.match(assets, /\.final\.png/);
assert.match(workbench, /onConfirmImages\(selectedTitle\)/);
assert.doesNotMatch(`${route}\n${assets}\n${workbench}`, /mcp-skills[\\/]candidates|WorkBuddy[\\/]sitong-outsourcing/);

console.log(JSON.stringify({
  ok: true,
  compositionVersion: BEAUTY_IMAGE_COMPOSITION_VERSION,
  roles: overlays.map((item) => item.role),
  finalArtifacts: receipts.length,
  candidateRuntimeReferences: 0,
  providerCalls: 0
}));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
