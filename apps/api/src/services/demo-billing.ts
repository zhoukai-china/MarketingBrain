import { randomUUID } from "node:crypto";
import type { CreditPackCode, PlanCode, ProjectPackageCode } from "@baolu/shared";

export interface DemoBillingOrder {
  id: string;
  tenantId: string;
  userId?: string;
  type: "subscription" | "credit_pack" | "project_package" | "agent_offer";
  status: "pending" | "paid" | "canceled" | "expired" | "refunded";
  amountCny: number;
  planCode?: PlanCode;
  billingPeriod?: "monthly" | "yearly";
  creditPackCode?: CreditPackCode;
  projectPackageCode?: ProjectPackageCode;
  offerId?: string;
  channelId?: string;
  eventId?: string;
  commissionRate?: number;
  credits: number;
  provider: string;
  codeUrl: string;
  paidAt?: string;
  expiresAt: string;
  createdAt: string;
}

const orders = new Map<string, DemoBillingOrder>();

export function createDemoBillingOrder(params: Omit<DemoBillingOrder, "id" | "status" | "provider" | "codeUrl" | "createdAt">): DemoBillingOrder {
  const id = randomUUID();
  const order: DemoBillingOrder = {
    ...params,
    id,
    status: "pending",
    provider: "wechat_pay",
    codeUrl: `weixin://wxpay/mock/${id}`,
    createdAt: new Date().toISOString()
  };
  orders.set(id, order);
  return order;
}

export function listDemoBillingOrders(tenantId: string): DemoBillingOrder[] {
  return [...orders.values()]
    .filter((order) => order.tenantId === tenantId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function payDemoBillingOrder(orderId: string, tenantId: string): DemoBillingOrder | undefined {
  const order = orders.get(orderId);
  if (!order || order.tenantId !== tenantId) return undefined;
  order.status = "paid";
  order.paidAt = new Date().toISOString();
  return order;
}
