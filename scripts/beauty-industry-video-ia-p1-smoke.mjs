import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../apps/web/src/pages/BeautyIndustryAcquisitionPage.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../apps/web/src/lib/api.ts", import.meta.url), "utf8");

for (const [path, title] of [
  ["/agents/beauty-industry/acquisition/video/content", "内容系统"],
  ["/agents/beauty-industry/acquisition/video/content-ten", "内容系统"],
  ["/agents/beauty-industry/acquisition/video/review", "复盘系统"],
  ["/agents/beauty-industry/acquisition/video/data-review", "视频数据复盘"],
  ["/agents/beauty-industry/acquisition/video/content-review", "视频内容复盘"],
  ["/agents/beauty-industry/acquisition/video/viral-replication", "爆款复刻"],
  ["/agents/beauty-industry/acquisition/video/text-to-video", "文生视频"],
  ["/agents/beauty-industry/acquisition/video/image-to-video", "图生视频"]
]) {
  assert.match(page, new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\"']?[\\s\\S]{0,180}${title}`), `missing stable route/title:${path}`);
}

assert.match(page, /beautyVideoAcquisitionSixCards/);
assert.match(page, /branchDefinition\.tasks\.filter\(\(task\) => task\.name === "beauty\.topic_ideas" \|\| task\.name === "beauty\.content_ten_pack"\)/);
assert.match(page, /planned\.map\(/);
assert.match(page, /<h2>复盘系统<\/h2>/);
assert.match(page, /<h2>爆款复刻<\/h2>/);
assert.match(page, /function BeautyVideoReviewHomePage/);
assert.match(page, /上传 CSV 或 Excel/);
assert.match(page, /已授权视频、可核验画面与真实转写证据/);
assert.match(page, /当前不会抓取未授权内容、复制他人素材、绕过平台、创建任务、调用 Provider、扣费或展示伪结果/);
assert.match(page, /"beauty\.content_ten_pack": "\/agents\/beauty-industry\/acquisition\/video\/content"/);
assert.match(api, /queryApiBase/);
assert.match(api, /apiBase=\$\{encodeURIComponent\(queryApiBase\)\}/);
assert.doesNotMatch(page, /爆款复刻[\s\S]{0,300}(?:onClick=.*run|预计\d+积分)/, "planning card must not execute or charge");

console.log("beauty_industry_video_ia_p1_smoke:PASS provider=0 cost=0");
