export type ShutdownStepResult = {
  id: string;
  ok: boolean;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  message: string;
  error?: string;
  timedOut?: boolean;
};

export type ShutdownReport = {
  startedAt: string;
  endedAt: string;
  durationMs: number;
  ok: boolean;
  steps: ShutdownStepResult[];
};

export class ShutdownPipeline {
  private lastReport?: ShutdownReport;

  getLastReport() {
    return this.lastReport;
  }

  async run(steps: Array<{ id: string; timeoutMs: number; run: () => Promise<void> }>): Promise<ShutdownReport> {
    const startedMs = Date.now();
    const startedAt = new Date(startedMs).toISOString();
    const results: ShutdownStepResult[] = [];
    for (const step of steps) {
      const stepStartMs = Date.now();
      const stepStartedAt = new Date(stepStartMs).toISOString();
      const result = await withTimeout(step.run(), step.timeoutMs)
        .then(() => ({
          ok: true,
          message: "completed",
        }))
        .catch((error) => ({
          ok: false,
          message: "运行时诊断关闭超时。",
          error: error instanceof Error ? error.stack ?? error.message : String(error),
          timedOut: error instanceof ShutdownTimeoutError,
        }));
      const endedMs = Date.now();
      results.push({
        id: step.id,
        ok: result.ok,
        startedAt: stepStartedAt,
        endedAt: new Date(endedMs).toISOString(),
        durationMs: endedMs - stepStartMs,
        message: result.message,
        error: "error" in result ? result.error : undefined,
        timedOut: "timedOut" in result ? result.timedOut : undefined,
      });
    }
    const endedMs = Date.now();
    this.lastReport = {
      startedAt,
      endedAt: new Date(endedMs).toISOString(),
      durationMs: endedMs - startedMs,
      ok: results.every((item) => item.ok),
      steps: results,
    };
    return this.lastReport;
  }
}

class ShutdownTimeoutError extends Error {}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new ShutdownTimeoutError(`shutdown step timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
