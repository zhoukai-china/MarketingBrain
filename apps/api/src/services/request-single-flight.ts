interface RequestEntry<T> {
  fingerprint: string;
  promise: Promise<T>;
  expiresAt: number;
}

export class RequestSingleFlight<T> {
  private readonly entries = new Map<string, RequestEntry<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 500,
    private readonly cacheFailures = true
  ) {}

  run(params: {
    key: string;
    fingerprint: string;
    onConflict: () => Error;
    execute: () => Promise<T>;
  }): Promise<T> {
    this.prune();
    const current = this.entries.get(params.key);
    if (current) {
      if (current.fingerprint !== params.fingerprint) return Promise.reject(params.onConflict());
      return current.promise;
    }
    const promise = params.execute();
    this.entries.set(params.key, {
      fingerprint: params.fingerprint,
      promise,
      expiresAt: Date.now() + this.ttlMs
    });
    if (!this.cacheFailures) {
      void promise.catch(() => {
        if (this.entries.get(params.key)?.promise === promise) this.entries.delete(params.key);
      });
    }
    this.prune();
    return promise;
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.entries.delete(oldest);
    }
  }
}
