import assert from "node:assert/strict";
import { buildBeautyXhsCustomerCopy } from "../apps/web/src/components/acquisition/BeautyXhsWorkbench.tsx";

const delivery = {
  preview: false,
  customerDeliverable: {
    titles: ["标题一", "标题二", "标题三"],
    body: "这是只面向顾客的自然正文。",
    tags: ["#皮肤管理", "附近女性顾客", "#日常护理", "#门店生活", "#小红书图文"],
    engagement: "这是单独展示的互动承接，不进入默认复制包。"
  }
};

assert.equal(buildBeautyXhsCustomerCopy(delivery, 1, "title"), "标题二");
assert.equal(buildBeautyXhsCustomerCopy(delivery, 1, "body"), delivery.customerDeliverable.body);
assert.equal(buildBeautyXhsCustomerCopy(delivery, 1, "tags"), "#皮肤管理 #附近女性顾客 #日常护理 #门店生活 #小红书图文");

const packageCopy = buildBeautyXhsCustomerCopy(delivery, 1, "package");
assert.match(packageCopy, /^标题二\n\n这是只面向顾客的自然正文。\n\n#皮肤管理/);
assert.doesNotMatch(packageCopy, /互动承接|提示词|模型|供应商|费用|质量审核/);
assert.doesNotMatch(packageCopy, /标题一|标题三/);

console.log("Beauty XHS workbench V2 copy contract smoke passed.");
