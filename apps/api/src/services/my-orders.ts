import { prisma } from "@baolu/db";

/**
 * 「我的 · 全部订单」（2026-09-30 用户：全部订单做右侧抽屉、分页、充值也算订单、要有订单详情）。
 *
 * 订单的三个真源（各表结构不同，这里统一成一个「订单视图」）：
 * - `RechargeOrder`：算力充值（¥ → 算力，双桶入账）——用户明确要求充值也要算订单；
 * - `MarketplaceSubscriptionOrder`：货架商品/包月的支付订单；
 * - `ProductBooking`：商城商品上线预约/购物车结算登记（按手机号归到本人名下；
 *   该表没挂 userId，是留资单，匹配不到就不出现，不猜）。
 *
 * 三个源数据量都很小（个人维度），合并后内存排序 + 切片分页即可，不需要三份 count。
 * 详情直接随列表返回（字段都是小文本），抽屉内展开即可看，不用再打一次接口。
 */

export interface MyOrderDetailLine {
  label: string;
  value: string;
}

export interface MyOrderItem {
  id: string;
  /** `recharge` 充值 / `subscription` 商品订单 / `booking` 预约登记 */
  kind: "recharge" | "subscription" | "booking";
  kindLabel: string;
  /** 展示用订单号（截短） */
  orderNo: string;
  title: string;
  /** 实付人民币（分→元由调用方格式化；预约单为 null） */
  amountCny: number | null;
  /** 到账/涉及算力（充值单 = base+bonus；其余 null） */
  credits: number | null;
  status: string;
  statusLabel: string;
  createdAt: string;
  paidAt: string | null;
  /** 订单详情（抽屉展开区逐行展示） */
  detail: MyOrderDetailLine[];
}

export interface MyOrdersView {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  orders: MyOrderItem[];
}

const RECHARGE_STATUS_LABELS: Record<string, string> = {
  created: "待支付",
  paid: "已完成",
  failed: "支付失败",
  refunded: "已退款"
};

const SUB_STATUS_LABELS: Record<string, string> = {
  pending: "待支付",
  paid: "已完成",
  canceled: "已取消",
  expired: "已超时",
  refunded: "已退款"
};

const BOOKING_STATUS_LABELS: Record<string, string> = {
  pending: "待跟进",
  contacted: "已联系",
  done: "已完成",
  closed: "已关闭"
};

function fmtCny(cents: number): string {
  return `¥${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function shortNo(id: string, prefix: string): string {
  return `${prefix}${id.slice(-8).toUpperCase()}`;
}

export async function listMyOrders(
  userId: string,
  options: { page?: number; pageSize?: number; phone?: string | null } = {}
): Promise<MyOrdersView> {
  const page = Math.max(1, Math.trunc(options.page ?? 1) || 1);
  const pageSize = Math.min(50, Math.max(1, Math.trunc(options.pageSize ?? 10) || 10));

  const [recharges, subscriptions, bookings] = await Promise.all([
    prisma.rechargeOrder.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, amountCny: true, basePts: true, bonusPts: true, method: true, status: true, paidAt: true, createdAt: true }
    }),
    prisma.marketplaceSubscriptionOrder.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, priceCny: true, status: true, provider: true, paidAt: true, createdAt: true, sku: { select: { name: true } } }
    }),
    // 预约/留资单没有 userId，按账号手机号归拢（没有手机号就放弃匹配，宁缺勿错）。
    options.phone
      ? prisma.productBooking.findMany({
          where: { phone: options.phone },
          orderBy: { createdAt: "desc" },
          take: 200
        })
      : Promise.resolve([])
  ]);

  const items: MyOrderItem[] = [];

  for (const r of recharges) {
    const totalPts = r.basePts + r.bonusPts;
    items.push({
      id: `recharge:${r.id}`,
      kind: "recharge",
      kindLabel: "算力充值",
      orderNo: shortNo(r.id, "R"),
      title: `算力充值 ${fmtCny(r.amountCny * 100)}`,
      amountCny: r.amountCny,
      credits: totalPts,
      status: r.status,
      statusLabel: RECHARGE_STATUS_LABELS[r.status] ?? r.status,
      createdAt: r.createdAt.toISOString(),
      paidAt: r.paidAt?.toISOString() ?? null,
      detail: [
        { label: "订单编号", value: shortNo(r.id, "R") },
        { label: "充值金额", value: fmtCny(r.amountCny * 100) },
        { label: "到账算力", value: `${r.basePts.toLocaleString("en-US")}${r.bonusPts > 0 ? ` + 赠 ${r.bonusPts.toLocaleString("en-US")}` : ""}` },
        { label: "支付方式", value: r.method === "mock" ? "模拟支付（本机验收）" : "微信支付" },
        { label: "下单时间", value: fmtTime(r.createdAt.toISOString()) },
        { label: "支付时间", value: r.paidAt ? fmtTime(r.paidAt.toISOString()) : "-" }
      ]
    });
  }

  for (const s of subscriptions) {
    items.push({
      id: `subscription:${s.id}`,
      kind: "subscription",
      kindLabel: "商品订单",
      orderNo: shortNo(s.id, "S"),
      title: s.sku.name,
      amountCny: s.priceCny,
      credits: null,
      status: s.status,
      statusLabel: SUB_STATUS_LABELS[s.status] ?? s.status,
      createdAt: s.createdAt.toISOString(),
      paidAt: s.paidAt?.toISOString() ?? null,
      detail: [
        { label: "订单编号", value: shortNo(s.id, "S") },
        { label: "商品", value: s.sku.name },
        { label: "订单金额", value: fmtCny(s.priceCny * 100) },
        { label: "下单时间", value: fmtTime(s.createdAt.toISOString()) },
        { label: "支付时间", value: s.paidAt ? fmtTime(s.paidAt.toISOString()) : "-" }
      ]
    });
  }

  for (const b of bookings) {
    items.push({
      id: `booking:${b.id}`,
      kind: "booking",
      kindLabel: "预约登记",
      orderNo: shortNo(b.id, "B"),
      title: b.productName,
      amountCny: null,
      credits: null,
      status: b.status,
      statusLabel: BOOKING_STATUS_LABELS[b.status] ?? b.status,
      createdAt: b.createdAt.toISOString(),
      paidAt: null,
      detail: [
        { label: "登记编号", value: shortNo(b.id, "B") },
        { label: "商品", value: b.productName },
        { label: "联系电话", value: b.phone.replace(/^(\d{3})\d{4}(\d{4})$/, "$1****$2") },
        ...(b.remark ? [{ label: "备注", value: b.remark }] : []),
        { label: "登记时间", value: fmtTime(b.createdAt.toISOString()) },
        { label: "进度", value: `${BOOKING_STATUS_LABELS[b.status] ?? b.status} · 客服会按登记顺序跟进` }
      ]
    });
  }

  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  return {
    page: safePage,
    pageSize,
    total,
    totalPages,
    orders: items.slice((safePage - 1) * pageSize, safePage * pageSize)
  };
}
