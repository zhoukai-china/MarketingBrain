type Listener = (...args: unknown[]) => void;

interface ListenerTarget {
  once(event: string, listener: Listener): unknown;
  removeListener(event: string, listener: Listener): unknown;
}

interface ReplyListenerTarget extends ListenerTarget {
  writableEnded: boolean;
}

export interface RequestExecutionScope {
  signal: AbortSignal;
  getAbortCode(): string | undefined;
  dispose(): void;
}

export function createRequestExecutionScope(params: {
  requestRaw: ListenerTarget;
  replyRaw: ReplyListenerTarget;
  timeoutMs: number;
  timeoutCode: string;
}): RequestExecutionScope {
  const controller = new AbortController();
  let abortCode: string | undefined;
  const abort = (code: string) => {
    if (controller.signal.aborted) return;
    abortCode = code;
    controller.abort(new Error(code));
  };
  const abortOnRequest = () => abort("client_disconnected");
  const abortOnReplyClose = () => {
    if (!params.replyRaw.writableEnded) abort("client_disconnected");
  };
  params.requestRaw.once("aborted", abortOnRequest);
  params.replyRaw.once("close", abortOnReplyClose);
  const timer = setTimeout(() => abort(params.timeoutCode), params.timeoutMs);
  timer.unref?.();

  return {
    signal: controller.signal,
    getAbortCode: () => abortCode,
    dispose: () => {
      clearTimeout(timer);
      params.requestRaw.removeListener("aborted", abortOnRequest);
      params.replyRaw.removeListener("close", abortOnReplyClose);
    }
  };
}
