export type LanqiPreviewStage = "understand" | "compose" | "verify";
export type LanqiPreviewRequestStatus = "running" | "completed" | "cancelled" | "timed_out" | "failed";

export type LanqiPreviewRequestState = {
  id: number;
  status: LanqiPreviewRequestStatus;
  stage: LanqiPreviewStage;
  startedAt: number;
};

type TimerHandle = ReturnType<typeof setTimeout>;

export function stageForElapsedSeconds(elapsedSeconds: number): LanqiPreviewStage {
  if (elapsedSeconds < 10) return "understand";
  if (elapsedSeconds < 25) return "compose";
  return "verify";
}

export function createLanqiPreviewRequestCoordinator(options: {
  timeoutMs: number;
  onState: (state: LanqiPreviewRequestState) => void;
  schedule?: (callback: () => void, timeoutMs: number) => TimerHandle;
  cancelSchedule?: (handle: TimerHandle) => void;
  now?: () => number;
}) {
  const schedule = options.schedule ?? ((callback, timeoutMs) => setTimeout(callback, timeoutMs));
  const cancelSchedule = options.cancelSchedule ?? (handle => clearTimeout(handle));
  const now = options.now ?? Date.now;
  let sequence = 0;
  let current: { id: number; controller: AbortController; timer: TimerHandle; startedAt: number } | undefined;

  const finish = (id: number, status: Exclude<LanqiPreviewRequestStatus, "running">): boolean => {
    if (!current || current.id !== id) return false;
    cancelSchedule(current.timer);
    const finished = current;
    current = undefined;
    options.onState({ id, status, stage: stageForElapsedSeconds(Math.floor((now() - finished.startedAt) / 1000)), startedAt: finished.startedAt });
    return true;
  };

  return {
    begin() {
      if (current) return { id: current.id, signal: current.controller.signal, startedAt: current.startedAt };
      const id = ++sequence;
      const controller = new AbortController();
      const startedAt = now();
      const timer = schedule(() => {
        if (!current || current.id !== id) return;
        controller.abort(new DOMException("image_preview_timeout", "AbortError"));
        finish(id, "timed_out");
      }, options.timeoutMs);
      current = { id, controller, timer, startedAt };
      options.onState({ id, status: "running", stage: "understand", startedAt });
      return { id, signal: controller.signal, startedAt };
    },
    isCurrent(id: number) {
      return current?.id === id;
    },
    updateElapsed(id: number, elapsedSeconds: number) {
      if (!current || current.id !== id) return false;
      options.onState({ id, status: "running", stage: stageForElapsedSeconds(elapsedSeconds), startedAt: current.startedAt });
      return true;
    },
    cancel(id: number) {
      if (!current || current.id !== id) return false;
      current.controller.abort(new DOMException("image_preview_cancelled", "AbortError"));
      return finish(id, "cancelled");
    },
    complete(id: number) {
      return finish(id, "completed");
    },
    fail(id: number) {
      return finish(id, "failed");
    },
  };
}
