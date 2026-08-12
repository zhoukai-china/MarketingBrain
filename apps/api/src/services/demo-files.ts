import type { StoredUpload } from "./file-storage.js";

export interface DemoFileRecord extends StoredUpload {
  tenantId: string;
  userId?: string;
  createdAt: string;
}

const demoFiles = new Map<string, DemoFileRecord>();

export function saveDemoFile(params: {
  tenantId: string;
  userId?: string;
  upload: StoredUpload;
}): DemoFileRecord {
  const record: DemoFileRecord = {
    ...params.upload,
    tenantId: params.tenantId,
    userId: params.userId,
    createdAt: new Date().toISOString()
  };
  demoFiles.set(record.id, record);
  return record;
}

export function getDemoFile(fileId: string, tenantId: string): DemoFileRecord | undefined {
  const record = demoFiles.get(fileId);
  if (!record || record.tenantId !== tenantId) return undefined;
  return record;
}

export function listDemoFiles(tenantId: string): DemoFileRecord[] {
  return [...demoFiles.values()]
    .filter((record) => record.tenantId === tenantId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

