export function nextRecurringAutomationRun(payload: unknown, currentRunAt: Date, now = new Date()): Date | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const schedule = (payload as Record<string, unknown>).schedule;
  if (!schedule || typeof schedule !== "object" || Array.isArray(schedule)) return undefined;
  const frequency = (schedule as Record<string, unknown>).frequency;
  const intervalDays = frequency === "daily" ? 1 : frequency === "weekly" ? 7 : 0;
  if (!intervalDays) return undefined;

  const next = new Date(currentRunAt);
  if (Number.isNaN(next.getTime())) return undefined;
  do {
    next.setUTCDate(next.getUTCDate() + intervalDays);
  } while (next.getTime() <= now.getTime());
  return next;
}
