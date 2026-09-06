import { randomUUID } from "node:crypto";

/** Test-only Prisma-shaped transactional fixture. Never imported by runtime. */
export function replicationMemoryDb() {
  const tables: Record<string, any[]> = { viralVideoReplicationJob: [], creditAccount: [], creditTransaction: [], creditReservation: [],tenant:[],user:[],membership:[],store:[],tenantProductEntitlement:[],uploadedFile:[],beautyVideoAssetAuthorization:[],beautyVideoStagingLease:[],beautyVideoExecutionPermit:[],auditLog:[] };
  function matches(row: any, where: any): boolean {
    return Object.entries(where ?? {}).every(([key, value]: any) => {
      if(key==="OR")return value.some((v:any)=>matches(row,v));
      if(key==="AND")return value.every((v:any)=>matches(row,v));
      if(value&&typeof value==="object"&&"path" in value)return value.path.reduce((v:any,k:string)=>v?.[k],row[key])===value.equals;
      if(value&&typeof value==="object"&&"array_contains" in value)return Array.isArray(row[key])&&value.array_contains.every((expected:any)=>row[key].some((actual:any)=>Object.entries(expected).every(([k,v])=>actual[k]===v)));
      if (value && typeof value === "object" && !(value instanceof Date)) return Object.entries(value).every(([op,v]:any)=>op==="gte"?row[key]>=v:op==="gt"?row[key]>v:op==="lte"?row[key]<=v:op==="lt"?row[key]<v:op==="not"?row[key]!==v:op==="in"?v.includes(row[key]):false);
      return value instanceof Date ? +row[key] === +value : row[key] === value;
    });
  }
  function update(row: any, data: any) {
    for (const [k,v] of Object.entries(data) as any) row[k] = v && typeof v === "object" && !(v instanceof Date) && ("increment" in v || "decrement" in v) ? row[k] + (v.increment ?? -v.decrement) : structuredClone(v);
    if (!("updatedAt" in data)) row.updatedAt = new Date();
    return structuredClone(row);
  }
  const db: any = {};
  for (const name of Object.keys(tables)) db[name] = {
    findFirst: async ({ where }: any) => structuredClone(tables[name].find(r => matches(r, where)) ?? null),
    findUnique: async ({ where }: any) => structuredClone(tables[name].find(r => matches(r, where)) ?? null),
    findMany: async ({ where }: any = {}) => structuredClone(tables[name].filter(r => matches(r, where))),
    count: async ({ where }: any = {}) => tables[name].filter(r => matches(r, where)).length,
    create: async ({ data }: any) => {
      if(name==="auditLog"&&data.id&&tables[name].some(r=>r.id===data.id))throw Object.assign(new Error("duplicate"),{code:"P2002"});
      if (name === "creditReservation" && tables[name].some(r => r.requestId === data.requestId)) throw Object.assign(new Error("duplicate"), { code: "P2002" });
      if(name==="beautyVideoAssetAuthorization"&&tables[name].some(r=>r.fileId===data.fileId||(r.tenantId===data.tenantId&&(r.requestKey===data.requestKey||(r.storeId===data.storeId&&r.fileSha256===data.fileSha256)))))throw Object.assign(new Error("duplicate"),{code:"P2002"});
      if(name==="beautyVideoStagingLease"&&tables[name].some(r=>r.tenantId===data.tenantId&&r.requestHash===data.requestHash))throw Object.assign(new Error("duplicate"),{code:"P2002"});
      if(name==="beautyVideoExecutionPermit"&&tables[name].some(r=>r.id===data.id||(r.tenantId===data.tenantId&&r.userId===data.userId&&r.requestKey===data.requestKey)))throw Object.assign(new Error("duplicate"),{code:"P2002"});
      const defaults=name==="beautyVideoAssetAuthorization"?{version:1,contractVersion:"beauty-video-asset-authorization-v1",assurance:"user_declared_not_independently_verified",revokedAt:null}:name==="membership"?{isActive:true,storeId:null}:name==="tenantProductEntitlement"?{status:"active",startsAt:new Date(),expiresAt:null}:{};
      const row = { id: randomUUID(), createdAt: new Date(), updatedAt: new Date(), status: name === "creditReservation" ? "reserved" : name==="beautyVideoStagingLease"?"creating":"queued",...defaults, ...(name==="beautyVideoExecutionPermit"?{status:"approved",revokedAt:null,claimedAt:null,submitCount:0,pollCount:0,storageCount:0,downloadCount:0,committedCostFen:0}:{}),...structuredClone(data) };
      tables[name].push(row); return structuredClone(row);
    },
    updateMany: async ({ where, data }: any) => { let count = 0; for (const r of tables[name]) if (matches(r, where)) { update(r, data); count++; } return { count }; },
    update: async ({ where, data }: any) => { const r = tables[name].find(r => matches(r, where)); if (!r) throw new Error("not_found"); return update(r, data); }
  };
  let lock = Promise.resolve();
  db.$transaction = async (fn: any) => {
    const previous = lock; let done!: () => void;
    lock = new Promise<void>(resolve => { done = resolve; }); await previous;
    const before = structuredClone(tables);
    try { return await fn(db); } catch (e) { for (const k of Object.keys(tables)) tables[k] = before[k]; throw e; } finally { done(); }
  };
  return db;
}
