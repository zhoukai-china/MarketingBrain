import { randomUUID } from "node:crypto";
import { nextRecurringAutomationRun } from "./automation-schedule.js";

export type AutomationTaskType =
  | "daily_business_advice"
  | "weekly_topic_push"
  | "moments_push"
  | "inactive_user_wakeup"
  | "profile_completion"
  | "subscription_expiry"
  | "file_analysis_followup"
  | "audio_card_analysis"
  | "local_push_ad_plan"
  | "local_push_ad_adjustment"
  | "video_publish_plan"
  | "video_publish_execution"
  | "ceo_action_order";

export interface DemoAutomationTask {
  id: string;
  tenantId: string;
  userId?: string;
  deviceId?: string;
  type: AutomationTaskType;
  payload: unknown;
  status: string;
  confirmationRequired: boolean;
  confirmationStatus: string;
  lockedAt?: string;
  runAt: string;
  createdAt: string;
}

export interface DemoDesktopDevice {
  id: string;
  tenantId: string;
  userId?: string;
  deviceName: string;
  platform: string;
  appVersion?: string;
  deviceToken: string;
  lastSeenAt: string;
  createdAt: string;
}

const tasks = new Map<string, DemoAutomationTask>();
const devices = new Map<string, DemoDesktopDevice>();

export function createDemoAutomationTask(params: {
  tenantId: string;
  userId?: string;
  type: AutomationTaskType;
  payload: unknown;
  runAt: Date;
}): DemoAutomationTask {
  const id = randomUUID();
  const task: DemoAutomationTask = {
    id,
    tenantId: params.tenantId,
    userId: params.userId,
    type: params.type,
    payload: params.payload,
    status: "draft",
    confirmationRequired: taskRequiresConfirmation(params.type),
    confirmationStatus: taskRequiresConfirmation(params.type) ? "required" : "not_required",
    runAt: params.runAt.toISOString(),
    createdAt: new Date().toISOString()
  };
  tasks.set(id, task);
  return task;
}

export function saveDemoDesktopDevice(params: {
  tenantId: string;
  userId?: string;
  deviceName: string;
  platform: string;
  appVersion?: string;
  deviceToken: string;
}): DemoDesktopDevice {
  const device: DemoDesktopDevice = {
    id: randomUUID(),
    tenantId: params.tenantId,
    userId: params.userId,
    deviceName: params.deviceName,
    platform: params.platform,
    appVersion: params.appVersion,
    deviceToken: params.deviceToken,
    lastSeenAt: new Date().toISOString(),
    createdAt: new Date().toISOString()
  };
  devices.set(device.id, device);
  return device;
}

export function getDemoDesktopDeviceByToken(token: string): DemoDesktopDevice | undefined {
  return [...devices.values()].find((device) => device.deviceToken === token);
}

export function claimDemoAutomationTasks(params: {
  tenantId: string;
  deviceId: string;
  limit: number;
}): DemoAutomationTask[] {
  const now = new Date().toISOString();
  const candidates = [...tasks.values()]
    .filter((task) => task.tenantId === params.tenantId)
    .filter((task) => ["draft", "pending"].includes(task.status))
    .filter((task) => task.runAt <= now)
    .sort((a, b) => a.runAt.localeCompare(b.runAt))
    .slice(0, params.limit);

  for (const task of candidates) {
    task.deviceId = params.deviceId;
    task.status = task.confirmationRequired ? "requires_user_confirm" : "claimed";
    task.lockedAt = now;
  }

  return candidates;
}

export function updateDemoAutomationTask(params: {
  tenantId: string;
  deviceId: string;
  taskId: string;
  status: string;
  confirmationStatus?: string;
}): DemoAutomationTask | undefined {
  const task = tasks.get(params.taskId);
  if (!task || task.tenantId !== params.tenantId || task.deviceId !== params.deviceId) {
    return undefined;
  }
  const nextRun = params.status === "succeeded"
    ? nextRecurringAutomationRun(task.payload, new Date(task.runAt))
    : undefined;
  task.status = nextRun ? "pending" : params.status;
  if (nextRun) {
    task.runAt = nextRun.toISOString();
    task.deviceId = undefined;
    task.lockedAt = undefined;
    task.confirmationStatus = task.confirmationRequired ? "required" : "not_required";
  }
  if (params.confirmationStatus) {
    task.confirmationStatus = params.confirmationStatus;
  }
  return task;
}

export function updateDemoAutomationTaskByOwner(params: {
  tenantId: string;
  taskId: string;
  status: string;
  confirmationStatus?: string;
  payload?: unknown;
  runAt?: Date;
  resetClaim?: boolean;
}): DemoAutomationTask | undefined {
  const task = tasks.get(params.taskId);
  if (!task || task.tenantId !== params.tenantId) return undefined;
  task.status = params.status;
  if (params.confirmationStatus) task.confirmationStatus = params.confirmationStatus;
  if (params.payload !== undefined) task.payload = params.payload;
  if (params.runAt) task.runAt = params.runAt.toISOString();
  if (params.resetClaim) {
    task.deviceId = undefined;
    task.lockedAt = undefined;
  }
  return task;
}

export function taskRequiresConfirmation(type: AutomationTaskType): boolean {
  return [
    "local_push_ad_plan",
    "local_push_ad_adjustment",
    "video_publish_execution",
    "ceo_action_order"
  ].includes(type);
}

export function listDemoAutomationTasks(tenantId: string): DemoAutomationTask[] {
  return [...tasks.values()]
    .filter((task) => task.tenantId === tenantId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
