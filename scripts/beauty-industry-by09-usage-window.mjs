export function parseBy09ProviderUsageWindow(stdout, startedAt, endedAt) {
  const startMs = startedAt.getTime();
  const endMs = endedAt.getTime();
  return stdout.split(/\r?\n/).flatMap((line) => {
    try {
      const journal = JSON.parse(line);
      const timestampMicros = Number(journal?.__REALTIME_TIMESTAMP);
      if (!Number.isFinite(timestampMicros)) return [];
      const timestampMs = timestampMicros / 1_000;
      if (timestampMs < startMs || timestampMs > endMs) return [];
      const value = JSON.parse(String(journal.MESSAGE ?? ""));
      return value?.event === "domestic_provider_usage" ? [value] : [];
    } catch {
      return [];
    }
  });
}
