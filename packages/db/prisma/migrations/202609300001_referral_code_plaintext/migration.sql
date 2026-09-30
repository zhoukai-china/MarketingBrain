-- 自助「我的邀请链接」明文回显（2026-09-30 用户：邀请抽屉里二维码/邀请码/链接不能是空的）
-- 旧模型「明文只在签发时返回一次」对后台下发码成立；但自助推荐链接是用户自己的分享物料，
-- 必须随时能取回（否则 GET 永远拿不到 link/qrSvg，抽屉只能空白）。
-- 仅自助签发链路（referral-self-service）写入明文；后台下发码保持 NULL、不受影响。
ALTER TABLE "ReferralCode" ADD COLUMN IF NOT EXISTS "codePlaintext" TEXT;
