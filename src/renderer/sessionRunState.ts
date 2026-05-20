import type { TaskRunProjection } from "../shared/types";

export type RunningTaskStateInput = {
  activeSessionId?: string;
  runningTaskRunId?: string;
  sessions?: Array<{ id: string; title?: string }>;
  taskRunProjectionsById: Record<string, TaskRunProjection>;
};

export function resolveRunningTaskState(input: RunningTaskStateInput) {
  const runningRun = input.runningTaskRunId ? input.taskRunProjectionsById[input.runningTaskRunId] : undefined;
  const runningOwnerSessionId = runningRun?.workSessionId;
  const activeSessionRunningTaskRunId = runningOwnerSessionId && runningOwnerSessionId === input.activeSessionId
    ? input.runningTaskRunId
    : undefined;
  const runningOwnerTitle = runningOwnerSessionId
    ? input.sessions?.find((session) => session.id === runningOwnerSessionId)?.title
    : undefined;

  return {
    globalRunningTaskRunId: input.runningTaskRunId,
    runningOwnerSessionId,
    runningOwnerTitle,
    activeSessionRunningTaskRunId,
    isAnyTaskRunning: Boolean(input.runningTaskRunId),
    isActiveSessionRunning: Boolean(activeSessionRunningTaskRunId),
    isAnotherSessionRunning: Boolean(input.runningTaskRunId && !activeSessionRunningTaskRunId),
  };
}

export function runningSessionLabel(input: Pick<ReturnType<typeof resolveRunningTaskState>, "runningOwnerTitle" | "runningOwnerSessionId">) {
  return input.runningOwnerTitle?.trim() || input.runningOwnerSessionId || "另一个会话";
}
