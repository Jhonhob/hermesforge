type PerfDetail = Record<string, unknown>;

const perfStarts = new Map<string, number>();

export function markPerfStart(name: string) {
  if (!shouldLogPerf()) return;
  perfStarts.set(name, now());
  logPerf(name, { phase: "start" });
}

export function markPerfEnd(name: string, detail?: PerfDetail) {
  if (!shouldLogPerf()) return;
  const startedAt = perfStarts.get(name);
  perfStarts.delete(name);
  logPerf(name, {
    phase: "end",
    durationMs: typeof startedAt === "number" ? Math.round(now() - startedAt) : undefined,
    ...detail,
  });
}

export function markPerf(name: string, detail?: PerfDetail) {
  if (!shouldLogPerf()) return;
  logPerf(name, detail);
}

function shouldLogPerf() {
  if (typeof window === "undefined") return false;
  try {
    return Boolean(import.meta.env.DEV || window.localStorage.getItem("hermes.perf") === "1");
  } catch {
    return Boolean(import.meta.env.DEV);
  }
}

function now() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function logPerf(name: string, detail?: PerfDetail) {
  console.debug("[HermesPerf]", name, detail ?? {});
}
