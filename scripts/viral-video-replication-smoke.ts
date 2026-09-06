import assert from "node:assert/strict";
import {
  buildAliyunReplicationRequest,
  validateDirectAssetUrl,
  validateViralReplicationInput
} from "../apps/api/src/services/viral-video-replication.ts";

const authorized = {
  referenceVideoUrl: "https://media.example.cn/authorized-source.mp4",
  portraitImageUrl: "https://media.example.cn/authorized-portrait.jpg",
  model: "aliyun_strict" as const,
  visualRightsConfirmed: true,
  audioRightsConfirmed: true,
  performerConsentConfirmed: true,
  portraitConsentConfirmed: true
};

assert.equal(validateViralReplicationInput(authorized), undefined);
assert.match(validateDirectAssetUrl("https://www.douyin.com/video/123") ?? "", /平台播放页/);
assert.match(validateDirectAssetUrl("https://example.cn/watch?id=1") ?? "", /直接指向/);
assert.match(validateViralReplicationInput({ ...authorized, audioRightsConfirmed: false }) ?? "", /授权/);
assert.match(validateViralReplicationInput({ ...authorized, model: "seedance_creative" }) ?? "", /尚未开放/);
const providerRequest = buildAliyunReplicationRequest(authorized);
assert.equal(providerRequest.model, "wan2.2-animate-mix");
assert.equal((providerRequest.parameters as { mode: string }).mode, "wan-std");
assert.equal((providerRequest.input as { watermark: boolean }).watermark, true);
console.log("VIRAL_VIDEO_REPLICATION_SMOKE_OK");
