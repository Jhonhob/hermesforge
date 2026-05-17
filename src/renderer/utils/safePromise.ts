import { useAppStore } from "../store";

export interface SafeResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`操作超时（${Math.round(ms / 1000)}秒）`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

export async function safePromise<T>(
  promise: Promise<T>,
  options?: {
    errorMessage?: string;
    showNotification?: boolean;
    timeoutMs?: number;
  }
): Promise<SafeResult<T>> {
  const { errorMessage, showNotification = true, timeoutMs } = options ?? {};
  const store = useAppStore.getState();
  const wrapped = timeoutMs ? withTimeout(promise, timeoutMs) : promise;

  try {
    const data = await wrapped;
    return { ok: true, data };
  } catch (error) {
    const message = error instanceof Error && error.message.includes("超时")
      ? error.message
      : errorMessage ?? "操作失败，请重试或导出诊断报告。";

    if (showNotification) {
      store.error(message, undefined);
    }

    console.error("[safePromise] Error:", error);
    return { ok: false, error: message };
  }
}

export async function safePromiseWithFallback<T>(
  promise: Promise<T>,
  fallback: T,
  options?: {
    errorMessage?: string;
    showNotification?: boolean;
    timeoutMs?: number;
  }
): Promise<T> {
  const result = await safePromise(promise, options);
  return result.ok ? result.data! : fallback;
}

export function wrapAsync<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  options?: {
    errorMessage?: string;
    showNotification?: boolean;
  }
): (...args: Parameters<T>) => Promise<SafeResult<Awaited<ReturnType<T>>>> {
  return async (...args: Parameters<T>) => {
    return safePromise(fn(...args) as Promise<Awaited<ReturnType<T>>>, options);
  };
}