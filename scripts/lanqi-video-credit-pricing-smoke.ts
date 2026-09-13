// 兰琪爆款复刻 · 按秒计积分（30 积分/秒，2026-09-13 用户拍板）。
// 纯函数回归：不连网、不调模型、不花钱。
import assert from "node:assert/strict";
import { computeReplicationCreditCost } from "../apps/api/src/services/beauty-video-asset-authorization.js";

// 3 秒 = 72 积分（用户 2026-09-13 拍板：对外 ¥1.2/秒 = 24 积分/秒，成本 ¥0.6/秒）
assert.equal(computeReplicationCreditCost({ durationSeconds: 3, maxOutputSeconds: 16, creditsPerSecond: 24, creditCost: 600 }), 72);
// 5.2 秒向上取整 6 秒 = 180 积分
assert.equal(computeReplicationCreditCost({ durationSeconds: 5.2, maxOutputSeconds: 16, creditsPerSecond: 24, creditCost: 600 }), 144);
// 超过上限封顶：20 秒按 16 秒 = 480 积分
assert.equal(computeReplicationCreditCost({ durationSeconds: 20, maxOutputSeconds: 16, creditsPerSecond: 24, creditCost: 600 }), 384);
// 未配置按秒计价（0 / 缺省）→ 回退固定 creditCost
assert.equal(computeReplicationCreditCost({ durationSeconds: 3, maxOutputSeconds: 16, creditsPerSecond: 0, creditCost: 600 }), 600);
assert.equal(computeReplicationCreditCost({ durationSeconds: 3, maxOutputSeconds: 16, creditCost: 600 }), 600);
// 时长未知时保守按 1 秒起算（避免 0 积分）
assert.equal(computeReplicationCreditCost({ maxOutputSeconds: 16, creditsPerSecond: 24, creditCost: 600 }), 24);

console.log("lanqi_video_credit_pricing_smoke: 6 passed, 0 failed");