-- LQ-18 私域营销 · 合成验收门店（仅本地/测试库使用）
INSERT INTO "Store" ("id", "tenantId", "name", "city", "address", "createdAt", "updatedAt")
VALUES ('st_lq18_demo', 'cmtu0kfge00bzfjgrky3vn4id', '大连总店', '大连', '不破皮肩颈护理', NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;
