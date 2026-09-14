/**
 * 出片（爆款复刻）是一条**共享能力**：美业单品与兰琪门店工作台都挂同一条
 * `/viral-video-replication/*` 链路（见 `apps/api/src/products/register.ts` 的注册位置说明）。
 *
 * 2026-09-14 之前，这条链路的三处准入（路由 context / 素材授权 scope / 许可 currentAccess）
 * 各自硬编码 `beauty-industry`，而兰琪租户只带 `lanqi` → 兰琪页面一点「先报价，再出片」
 * 必然 403 `product_access_denied`（QA-20260914-004）。同一能力被两个真实产品复用时，
 * 权限边界应当写成**显式清单**，而不是散落的字面量：清单只有一处，三处准入共用同一套
 * 状态 / 生效期 / 到期口径，新增产品必须显式加进来（未知产品码一律拒绝，不落回默认放行）。
 */
export const VIDEO_REPLICATION_PRODUCT_CODES = ["beauty-industry", "lanqi"] as const;

export type VideoReplicationProductCode = (typeof VIDEO_REPLICATION_PRODUCT_CODES)[number];

export function isVideoReplicationProductCode(value: unknown): value is VideoReplicationProductCode {
  return typeof value === "string" && (VIDEO_REPLICATION_PRODUCT_CODES as readonly string[]).includes(value);
}

/**
 * 任一清单内产品权益处于 active、已生效且未过期，即视为该租户可使用出片能力。
 * 返回命中的产品码（写进准入快照，便于事后区分这条成片是哪条产品线买的）。
 */
export async function findVideoReplicationEntitlement(
  db: any,
  tenantId: string,
  now = Date.now()
): Promise<{ productCode: VideoReplicationProductCode } | null> {
  const at = new Date(now);
  const row = await db.tenantProductEntitlement.findFirst({
    where: {
      tenantId,
      productCode: { in: [...VIDEO_REPLICATION_PRODUCT_CODES] },
      status: "active",
      startsAt: { lte: at },
      OR: [{ expiresAt: null }, { expiresAt: { gt: at } }]
    },
    select: { productCode: true }
  });
  return isVideoReplicationProductCode(row?.productCode) ? { productCode: row.productCode } : null;
}
