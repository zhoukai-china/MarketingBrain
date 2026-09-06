import { createHash } from "node:crypto";
import { z } from "zod";

/** Internal observation, NOT a charge/quota API. Call only with server-authorized identity.
 * AuditLog is the immutable event store. No additional ledger, balance or pricing policy. */
export const BEAUTY_USAGE_VERSION = "beauty-usage-v1";
export const usageHash = (value: string) => createHash("sha256").update(value).digest("hex");
const code = z.string().regex(/^[A-Za-z0-9_.:-]{1,120}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const decimal = z.string().regex(/^(0|[1-9]\d{0,11})(\.\d{1,6})?$/);
const money = z.string().regex(/^(0|[1-9]\d{0,23})$/);
const measureSchema = z.object({
  unit: z.enum(["token", "image", "video_second"]),
  meter: z.enum(["prompt", "completion", "cache_hit", "cache_miss", "reasoning", "output"]),
  quantity: decimal.nullable(),
  source: z.enum(["unknown", "provider_usage", "measured_asset"]),
  // 1 currency unit = 1,000,000 micro units. Price-derived costs are estimates, not invoices.
  currency: z.enum(["CNY", "USD"]), priceVersion: code.nullable(), unitPriceMicros: money.nullable(),
  observedCostMicros: money.nullable(), billingSource: z.enum(["unknown", "provider_bill"])
}).strict().superRefine((m, ctx) => {
  if ((m.quantity === null) !== (m.source === "unknown") ||
      (m.unit !== "video_second" && m.quantity?.includes(".")) ||
      (m.unit === "token" ? m.meter === "output" : m.meter !== "output") ||
      (m.priceVersion === null) !== (m.unitPriceMicros === null) ||
      (m.observedCostMicros === null) !== (m.billingSource === "unknown")) {
    ctx.addIssue({ code: "custom", message: "usage_measure_evidence_invalid" });
  }
});
export type UsageMeasure = z.infer<typeof measureSchema>;
const eventSchema = z.object({
  version: z.literal(BEAUTY_USAGE_VERSION), traceId: hash, callId: hash,
  storeFingerprint: hash, step: code, attempt: z.number().int().min(1).max(100),
  provider: code, model: code, mode: z.enum(["controlled_mock", "real"]),
  kind: z.enum(["started", "observation"]), status: z.enum(["pending", "unknown", "succeeded", "failed", "cancelled"]),
  providerRequestFingerprint: hash.nullable(), code: code,
  measures: z.array(measureSchema).min(1).max(8)
}).strict();
export type UsageEvent = z.infer<typeof eventSchema>;
export type UsageActor = { tenantId: string; userId: string; storeId: string };
type Call = { step: string; attempt: number; provider: string; model: string; mode: "controlled_mock" | "real" };
type Observation = Pick<UsageEvent, "status" | "code" | "providerRequestFingerprint" | "measures">;
const resource = "beauty_usage_v1";
const eventId = (e: UsageEvent) => usageHash(JSON.stringify([e.traceId, e.callId, e.kind, e.kind === "started" ? "start" : e]));

export function createBeautyUsageMeter(db: any, actor: UsageActor, actionKey: string) {
  if (![actor.tenantId, actor.userId, actor.storeId, actionKey].every(x => typeof x === "string" && x.length > 0 && x.length <= 240)) throw new Error("usage_context_required");
  const traceId = usageHash(JSON.stringify([BEAUTY_USAGE_VERSION, actor.tenantId, actor.userId, actor.storeId, actionKey]));
  const storeFingerprint = usageHash(actor.storeId);
  const base = (call: Call) => ({ ...call, version: BEAUTY_USAGE_VERSION, traceId, storeFingerprint,
    callId: usageHash(JSON.stringify([traceId, call.step, call.attempt])) });
  function parsed(input: unknown) {
    const e = eventSchema.parse(input);
    for (const m of e.measures) if (m.quantity?.includes(".")) m.quantity=m.quantity.replace(/0+$/,"").replace(/\.$/,"");
    e.measures.sort((a,b) => `${a.unit}:${a.meter}`.localeCompare(`${b.unit}:${b.meter}`));
    if (new Set(e.measures.map(m => `${m.unit}:${m.meter}`)).size !== e.measures.length) throw new Error("usage_duplicate_measure");
    return e;
  }
  async function append(e: UsageEvent) {
    const id = eventId(e), detail = JSON.stringify(e);
    try { await db.auditLog.create({ data: { id, tenantId: actor.tenantId, userId: actor.userId,
      action: `beauty_usage.${e.kind}`, resource, resourceId: traceId, detail } }); }
    catch (error: any) {
      if (error?.code !== "P2002") throw error;
      const previous = await db.auditLog.findUnique({ where: { id } });
      if (previous?.tenantId !== actor.tenantId || previous?.userId !== actor.userId || previous?.detail !== detail) throw new Error("usage_event_conflict");
    }
    return e.callId;
  }
  return {
    traceId,
    async begin(call: Call, measures: UsageMeasure[]) {
      return append(parsed({ ...base(call), kind: "started", status: "pending", code: "attempt_committed",
        providerRequestFingerprint: null, measures }));
    },
    async observe(call: Call, observation: Observation) {
      const e = parsed({ ...base(call), kind: "observation", ...observation });
      const startedId = usageHash(JSON.stringify([traceId, e.callId, "started", "start"]));
      const row = await db.auditLog.findUnique({ where: { id: startedId } });
      if (!row || row.tenantId !== actor.tenantId || row.userId !== actor.userId) throw new Error("usage_attempt_not_started");
      const start = eventSchema.parse(JSON.parse(row.detail));
      if (start.provider !== e.provider || start.model !== e.model || start.mode !== e.mode ||
          JSON.stringify(start.measures.map(m=>[m.unit,m.meter,m.currency,m.priceVersion,m.unitPriceMicros])) !==
          JSON.stringify(e.measures.map(m=>[m.unit,m.meter,m.currency,m.priceVersion,m.unitPriceMicros]))) throw new Error("usage_call_binding_conflict");
      return append(e);
    },
    async read() {
      const rows = await db.auditLog.findMany({ where: { tenantId: actor.tenantId, userId: actor.userId, resource, resourceId: traceId }, take: 5001 });
      if (rows.length > 5000) throw new Error("usage_read_limit"); // Never silently omit a billable attempt.
      const events: UsageEvent[] = rows.map((r: any) => {
        const e = parsed(JSON.parse(r.detail));
        if (e.traceId !== traceId || e.storeFingerprint !== storeFingerprint || r.id !== eventId(e)) throw new Error("usage_audit_corrupt");
        return e;
      });
      return { traceId, events, timeline:rows.map((r:any)=>({eventId:r.id,recordedAt:new Date(r.createdAt).toISOString()})), ...summarizeBeautyUsage(events) };
    }
  };
}

function microsQuantity(s: string): bigint { const [whole, fraction = ""] = s.split("."); return BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6,"0")); }
function formatQuantity(n: bigint) { return `${n / 1000000n}.${(n % 1000000n).toString().padStart(6,"0")}`; }
/** Event set fold: idempotent and arrival-order independent. Conflicting evidence stays unknown.
 * Groups are disjoint dimensions, NOT one total. prompt/cache/reasoning may overlap by provider.
 * No billable flag: only the existing logical-action credit transaction decides user charges. */
export function summarizeBeautyUsage(events: UsageEvent[]) {
  const calls = new Map<string, UsageEvent[]>();
  for (const e of events) calls.set(e.callId, [...(calls.get(e.callId) ?? []), e]);
  const groups = new Map<string, { provider:string; model:string; mode:string; unit:string; meter:string; currency:string;
    priceVersion:string|null; unitPriceMicros:string|null; calls:number; unknownCalls:number; quantity:bigint; estimated:bigint; observed:bigint; unknownObserved:number }>();
  let unresolvedCalls = 0, conflictingCalls = 0;
  for (const entries of calls.values()) {
    const start = entries.find(e=>e.kind === "started");
    if (!start) throw new Error("usage_orphan_observation");
    const terminals = new Set(entries.filter(e=>["succeeded","failed","cancelled"].includes(e.status)).map(e=>e.status));
    const ids = new Set(entries.map(e=>e.providerRequestFingerprint).filter(Boolean));
    const conflict = terminals.size > 1 || ids.size > 1 || start.measures.some(initial => {
      const samples=entries.flatMap(e=>e.measures.filter(m=>m.unit===initial.unit&&m.meter===initial.meter));
      return new Set(samples.map(m=>m.quantity).filter(v=>v!==null)).size>1 || new Set(samples.map(m=>m.observedCostMicros).filter(v=>v!==null)).size>1;
    });
    if (!terminals.size) unresolvedCalls++;
    for (const initial of start.measures) {
      const samples = entries.flatMap(e=>e.measures.filter(m=>m.unit === initial.unit && m.meter === initial.meter));
      const values = new Set(samples.map(m=>m.quantity).filter(v=>v !== null));
      const costs = new Set(samples.map(m=>m.observedCostMicros).filter(v=>v !== null));
      const measureConflict = values.size > 1 || costs.size > 1;
      const unknown = conflict || measureConflict || values.size === 0;
      const key = JSON.stringify([start.provider,start.model,start.mode,initial.unit,initial.meter,initial.currency,initial.priceVersion,initial.unitPriceMicros]);
      const g = groups.get(key) ?? {provider:start.provider,model:start.model,mode:start.mode,unit:initial.unit,meter:initial.meter,currency:initial.currency,
        priceVersion:initial.priceVersion,unitPriceMicros:initial.unitPriceMicros,calls:0,unknownCalls:0,quantity:0n,estimated:0n,observed:0n,unknownObserved:0};
      g.calls++;
      if (unknown) g.unknownCalls++;
      else {
        const q = microsQuantity([...values][0]!); g.quantity += q;
        if (initial.unitPriceMicros !== null) g.estimated += (q * BigInt(initial.unitPriceMicros) + 999999n) / 1000000n;
      }
      if (!conflict && costs.size === 1) g.observed += BigInt([...costs][0]!); else g.unknownObserved++;
      groups.set(key,g);
    }
    if (conflict) conflictingCalls++;
  }
  return { callCount:calls.size, unresolvedCalls, conflictingCalls, groups:[...groups.values()].map(g=>({
    provider:g.provider,model:g.model,mode:g.mode,unit:g.unit,meter:g.meter,currency:g.currency,priceVersion:g.priceVersion,unitPriceMicros:g.unitPriceMicros,calls:g.calls,
    knownQuantity:formatQuantity(g.quantity), quantity:g.unknownCalls ? null : formatQuantity(g.quantity), unknownCalls:g.unknownCalls,
    knownEstimatedCostMicros:g.estimated.toString(), estimatedCostMicros:g.unknownCalls || g.priceVersion === null ? null : g.estimated.toString(),
    knownObservedCostMicros:g.observed.toString(), observedCostMicros:g.unknownObserved ? null : g.observed.toString()
  })) };
}

export function beautyUsageMonthWindow(month: string) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("usage_month_invalid");
  const [year, index] = month.split("-").map(Number);
  return {start:new Date(Date.UTC(year,index-1,1)-8*3600000),end:new Date(Date.UTC(year,index,1)-8*3600000),timeZone:"Asia/Shanghai" as const};
}

/** Internal owner-scoped audit read. Month is the call START month, not late receipt month.
 * All observations of selected calls are loaded; no partial late receipt is lost at midnight. */
export async function readBeautyUsageMonth(db:any, actor:UsageActor, month:string) {
  const window=beautyUsageMonthWindow(month);
  const starts=await db.auditLog.findMany({where:{tenantId:actor.tenantId,userId:actor.userId,resource,action:"beauty_usage.started",createdAt:{gte:window.start,lt:window.end}},take:5001});
  if(starts.length>5000)throw new Error("usage_read_limit");
  const owned=starts.filter((r:any)=>eventSchema.parse(JSON.parse(r.detail)).storeFingerprint===usageHash(actor.storeId));
  const ids=[...new Set(owned.map((r:any)=>r.resourceId))];
  if(!ids.length)return {month,timeZone:window.timeZone,actionCount:0,...summarizeBeautyUsage([])};
  const rows=await db.auditLog.findMany({where:{tenantId:actor.tenantId,userId:actor.userId,resource,resourceId:{in:ids}},take:5001});
  if(rows.length>5000)throw new Error("usage_read_limit");
  const selected=new Set(owned.map((r:any)=>eventSchema.parse(JSON.parse(r.detail)).callId));
  const events:UsageEvent[]=rows.map((r:any)=>{const e=eventSchema.parse(JSON.parse(r.detail));if(r.id!==eventId(e)||e.traceId!==r.resourceId||e.storeFingerprint!==usageHash(actor.storeId))throw new Error("usage_audit_corrupt");return e;}).filter((e:UsageEvent)=>selected.has(e.callId));
  return {month,timeZone:window.timeZone,actionCount:ids.length,...summarizeBeautyUsage(events)};
}
