import assert from "node:assert/strict";

const pageUrl = process.env.BEAUTY_PRODUCTION_WEB_URL;
assert.ok(pageUrl, "BEAUTY_PRODUCTION_WEB_URL is required");
assert.match(pageUrl, /^https:\/\/[^/]+\/beauty-beta\/login\/beauty-industry\/?$/);

const pageResponse = await fetch(pageUrl, { redirect: "error" });
assert.equal(pageResponse.status, 200, `production page status ${pageResponse.status}`);
const html = await pageResponse.text();
const scriptPath = html.match(/<script[^>]+src="([^"]+index-[^"]+\.js)"/)?.[1];
assert.ok(scriptPath, "production page did not expose a hashed app bundle");
assert.ok(scriptPath.startsWith("/beauty-beta/assets/"), `unexpected bundle path: ${scriptPath}`);

const bundleUrl = new URL(scriptPath, pageUrl);
const bundleResponse = await fetch(bundleUrl, { redirect: "error" });
assert.equal(bundleResponse.status, 200, `production bundle status ${bundleResponse.status}`);
const bundle = await bundleResponse.text();

const chunkPaths = new Set(
  [...bundle.matchAll(/["'](assets\/[A-Za-z0-9_.-]+\.js)["']/g)].map((match) => match[1]),
);
const appBasePath = scriptPath.slice(0, scriptPath.indexOf("assets/"));
const relevantChunkPaths = [...chunkPaths].filter((chunkPath) =>
  /(?:LoginPage|BeautyIndustryAcquisitionPage|BeautyIndustryWorkBuddyPage)-/.test(chunkPath),
);
assert.equal(relevantChunkPaths.length, 3, "production bundle did not expose the three beauty user-flow chunks");
const chunkBodies = await Promise.all(relevantChunkPaths.map(async (chunkPath) => {
  const response = await fetch(new URL(`${appBasePath}${chunkPath}`, pageUrl), { redirect: "error" });
  assert.equal(response.status, 200, `production chunk status ${response.status}: ${chunkPath}`);
  return response.text();
}));
const deployedSource = [bundle, ...chunkBodies].join("\n");

assert.match(deployedSource, /美业经营工作台/, "production bundle is not the current beauty workbench build");
assert.match(deployedSource, /门店\/品牌名称/, "production bundle is missing the beauty login contract");
assert.match(deployedSource, /本次可以使用的真实信息（选填）/, "production bundle is missing the current profile contract");
assert.doesNotMatch(deployedSource, /显式选择的模块会锁定对应能力|模块已锁定|品牌中立/);

process.stdout.write(`${JSON.stringify({ status: "PASS", pageStatus: pageResponse.status, bundleStatus: bundleResponse.status, chunksChecked: chunkBodies.length })}\n`);
