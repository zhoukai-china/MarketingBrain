/**
 * 手动工具：创建一个「非标准档」的 ¥1 验证订单，并拉起微信 Native 预支付（真实收款通道验证）。
 *
 * 为什么需要它：系统只卖 5 档标准积分包（最小 pack_50 = ¥50），要在不改变对客目录的前提下
 * 用最小金额验证「真实支付」这一条链路（拉起微信 → 用户付款 → 微信回调 → 订单转 paid），
 * 就得有一张非标准金额的订单。
 *
 * 口径（重要）：
 * - 本订单 `creditPackCode = null`。`applyPaidOrder()` 只在 `type=credit_pack && creditPackCode` 时按标准包
 *   发放积分，因此**支付成功后不会发放积分**（避免出现「付 ¥1 拿 1000 积分」的错账）。
 * - 也就是说：本工具验证的是**支付通道**，不是「付款 → 到账」的完整闭环；后者要用标准 pack_50 走一遍。
 * - `credits` 字段仍写 20（1 元 = 20 积分）作为账目备注，但只是记录，不参与发放。
 *
 * 运行（必须在生产/测试实例所在机器上，且已 source 该实例的 env 文件）：
 *   set -a; . /etc/baolu-secrets/baolu-os-v2.env; set +a
 *   cd /opt/baolu-os-v2 && node apps/api/node_modules/tsx/dist/cli.mjs scripts/pay-verify-create-order.ts
 * 可选环境变量：PAY_VERIFY_AMOUNT_CNY（默认 1）、PAY_VERIFY_TENANT_ID、PAY_VERIFY_TENANT_NAME。
 */
import { prisma } from "../apps/api/node_modules/@baolu/db/dist/index.js";
import { createWechatNativePrepay } from "../apps/api/src/services/wechat-pay.js";

const amountCny = Number(process.env.PAY_VERIFY_AMOUNT_CNY ?? 1);
const tenantId = process.env.PAY_VERIFY_TENANT_ID ?? "pay-verify-channel-tenant";
const tenantName = process.env.PAY_VERIFY_TENANT_NAME ?? "支付通道验证工作区";

async function main(): Promise<void> {
  if (!Number.isFinite(amountCny) || amountCny <= 0) throw new Error("PAY_VERIFY_AMOUNT_CNY must be a positive number");

  await prisma.tenant.upsert({
    where: { id: tenantId },
    update: {},
    create: { id: tenantId, name: tenantName, type: "local_business" }
  });

  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  const order = await prisma.billingOrder.create({
    data: {
      tenantId,
      userId: null,
      type: "credit_pack",
      status: "pending",
      creditPackCode: null,
      credits: Math.round(amountCny * 20),
      amountCny,
      provider: "wechat_pay",
      expiresAt,
      metadata: {
        purpose: "real_payment_channel_verification",
        note: "非标准档验证单：支付成功不发放积分（发放逻辑只认标准积分包）"
      }
    }
  });

  const prepay = await createWechatNativePrepay({
    orderId: order.id,
    description: `思潼AI 支付通道验证 ¥${amountCny}`,
    amountCny,
    expiresAt
  });

  const updated = await prisma.billingOrder.update({
    where: { id: order.id },
    data: {
      codeUrl: prepay.codeUrl,
      providerOrderId: prepay.outTradeNo,
      metadata: {
        purpose: "real_payment_channel_verification",
        note: "非标准档验证单：支付成功不发放积分（发放逻辑只认标准积分包）",
        wechatTradeType: "native"
      }
    }
  });

  console.log(JSON.stringify({
    ok: true,
    orderId: updated.id,
    tenantId,
    tenantName,
    amountCny,
    creditsRecordedNotGranted: updated.credits,
    outTradeNo: prepay.outTradeNo,
    codeUrl: prepay.codeUrl,
    expiresAt: expiresAt.toISOString(),
    nextSteps: [
      "用微信扫码 codeUrl 生成的二维码完成付款",
      "付款后：订单应转为 paid，并可在 BillingOrder.paidAt / metadata 中看到微信回调痕迹"
    ]
  }, null, 2));
}

void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().catch(() => undefined));
